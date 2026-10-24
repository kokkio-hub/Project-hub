import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { BackupStatus } from '../../shared/types.js';
import { S3Client, type ListedObject } from '../lib/s3.js';
import { getState, setState } from '../repos/appState.js';
import { attachmentsNotBackedUp, markBackedUp } from '../repos/attachments.js';
import { attachmentPath } from './storage.js';

/**
 * Off-site backups. Every night the database is copied (consistently, while
 * the app keeps running), compressed and uploaded to an S3-compatible bucket.
 * Attached files are uploaded once each, as they never change. Database copies
 * older than BACKUP_KEEP_DAYS are removed, but the newest seven always stay.
 */

const STATE_KEY = 'backup.status';
const ALWAYS_KEEP = 7;

interface StoredStatus {
  lastSuccessAt: string | null;
  lastFile: string | null;
  lastSize: number | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastAttemptAt: string | null;
}

const EMPTY: StoredStatus = {
  lastSuccessAt: null,
  lastFile: null,
  lastSize: null,
  lastErrorAt: null,
  lastError: null,
  lastAttemptAt: null,
};

export interface BackupResult {
  key: string;
  size: number;
  attachments: number;
  removed: number;
}

export class Backups {
  private running: Promise<BackupResult> | null = null;
  readonly client: S3Client | null;

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    options: { fetch?: typeof fetch } = {},
  ) {
    this.client = config.backup ? new S3Client(config.backup, options) : null;
  }

  private stored(): StoredStatus {
    return { ...EMPTY, ...(getState<StoredStatus>(this.db, STATE_KEY) ?? {}) };
  }

  status(): BackupStatus {
    const s = this.stored();
    return {
      configured: this.client !== null,
      target: this.client?.description ?? null,
      running: this.running !== null,
      lastSuccessAt: s.lastSuccessAt,
      lastFile: s.lastFile,
      lastSize: s.lastSize,
      lastErrorAt: s.lastErrorAt,
      lastError: s.lastError,
      hourUtc: this.config.backupHourUtc,
      keepDays: this.config.backupKeepDays,
    };
  }

  /** True when the nightly backup is due: after the backup hour, not yet done today, and not retried within the hour. */
  isDue(now = new Date()): boolean {
    if (!this.client || this.running) return false;
    if (now.getUTCHours() < this.config.backupHourUtc) return false;
    const s = this.stored();
    const today = now.toISOString().slice(0, 10);
    if (s.lastSuccessAt && s.lastSuccessAt.slice(0, 10) === today) return false;
    if (s.lastAttemptAt && now.getTime() - Date.parse(s.lastAttemptAt) < 60 * 60_000) return false;
    return true;
  }

  /** Runs a backup now. If one is already running, waits for that one. */
  run(): Promise<BackupResult> {
    if (!this.client) return Promise.reject(new Error('Backups are not set up. Set the BACKUP_S3_* variables first.'));
    if (!this.running) {
      this.running = this.perform(this.client).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async perform(client: S3Client): Promise<BackupResult> {
    const started = new Date().toISOString();
    setState(this.db, STATE_KEY, { ...this.stored(), lastAttemptAt: started });
    const prefix = this.config.backup!.prefix;
    const workDir = this.config.databasePath === ':memory:' ? path.resolve('data', 'tmp') : path.join(path.dirname(this.config.databasePath), 'tmp');
    fs.mkdirSync(workDir, { recursive: true });
    const stamp = started.slice(0, 19).replace(/[:T]/g, '-');
    const copy = path.join(workDir, `backup-${stamp}.db`);
    const gz = `${copy}.gz`;
    try {
      await this.db.backup(copy);
      await pipeline(fs.createReadStream(copy), createGzip({ level: 9 }), fs.createWriteStream(gz));
      const body = fs.readFileSync(gz);
      const key = `${prefix}database/project-hub-${stamp}.db.gz`;
      await client.put(key, body, 'application/gzip');

      const attachments = await this.uploadAttachments(client, prefix);
      const removed = await this.prune(client, prefix);

      setState(this.db, STATE_KEY, {
        ...this.stored(),
        lastSuccessAt: new Date().toISOString(),
        lastFile: key,
        lastSize: body.length,
        lastError: null,
        lastErrorAt: null,
      });
      return { key, size: body.length, attachments, removed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(this.db, STATE_KEY, { ...this.stored(), lastError: message, lastErrorAt: new Date().toISOString() });
      throw error;
    } finally {
      fs.rmSync(copy, { force: true });
      fs.rmSync(gz, { force: true });
    }
  }

  /** Uploads attachments that aren't in the bucket yet. */
  private async uploadAttachments(client: S3Client, prefix: string): Promise<number> {
    let count = 0;
    for (let round = 0; round < 100; round++) {
      const batch = attachmentsNotBackedUp(this.db, 50);
      if (batch.length === 0) break;
      for (const a of batch) {
        let body: Buffer;
        try {
          body = fs.readFileSync(attachmentPath(this.config.attachmentsDir, a.stored_name));
        } catch {
          console.warn(`Backup: attachment file for "${a.filename}" (#${a.id}) is missing; skipping it.`);
          markBackedUp(this.db, a.id);
          continue;
        }
        await client.put(`${prefix}attachments/${a.stored_name}`, body, a.mime_type);
        markBackedUp(this.db, a.id);
        count++;
      }
    }
    return count;
  }

  /** Removes database copies older than the retention period, always keeping the newest few. */
  private async prune(client: S3Client, prefix: string): Promise<number> {
    const copies = await this.listDatabaseCopies(client, prefix);
    const cutoff = Date.now() - this.config.backupKeepDays * 86_400_000;
    let removed = 0;
    for (const [index, copy] of copies.entries()) {
      if (index < ALWAYS_KEEP) continue;
      const when = Date.parse(copy.lastModified);
      if (Number.isFinite(when) && when < cutoff) {
        await client.delete(copy.key);
        removed++;
      }
    }
    return removed;
  }

  /** Database copies in the bucket, newest first. */
  async listDatabaseCopies(client = this.client, prefix = this.config.backup?.prefix ?? ''): Promise<ListedObject[]> {
    if (!client) return [];
    const objects = await client.list(`${prefix}database/`);
    return objects.filter((o) => o.key.endsWith('.db.gz')).sort((a, b) => b.key.localeCompare(a.key));
  }
}
