import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations, type Migration } from './migrations.js';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db, { backupDir: file === ':memory:' ? null : path.join(path.dirname(file), 'backups') });
  return db;
}

/**
 * Applies pending schema migrations. The schema version is kept in SQLite's
 * built-in `user_version` pragma; each migration runs in its own transaction.
 *
 * Before an existing database is upgraded, a copy of it is saved in `backupDir`
 * (next to the database), so an upgrade can always be undone.
 */
export function migrate(db: DB, options: { backupDir?: string | null } = {}): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= migrations.length) return;

  if (current > 0 && options.backupDir) {
    fs.mkdirSync(options.backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const target = path.join(options.backupDir, `before-upgrade-v${current}-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log(`Database upgrade: saved a copy of the current database to ${target}`);
  }

  for (let version = current; version < migrations.length; version++) {
    const entry = migrations[version]!;
    const migration: Migration = typeof entry === 'string' ? { sql: entry } : entry;
    // PRAGMA foreign_keys has no effect inside a transaction, so it is switched around it.
    if (migration.foreignKeysOff) db.pragma('foreign_keys = OFF');
    try {
      const apply = db.transaction(() => {
        db.exec(migration.sql);
        if (migration.foreignKeysOff) {
          const problems = db.pragma('foreign_key_check') as unknown[];
          if (problems.length > 0) throw new Error(`Migration ${version + 1} left ${problems.length} broken references.`);
        }
        db.pragma(`user_version = ${version + 1}`);
      });
      apply();
    } finally {
      if (migration.foreignKeysOff) db.pragma('foreign_keys = ON');
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
