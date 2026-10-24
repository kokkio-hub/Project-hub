import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

/**
 * Applies pending schema migrations. The schema version is kept in SQLite's
 * built-in `user_version` pragma; each migration runs in its own transaction.
 */
export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < migrations.length; version++) {
    const apply = db.transaction(() => {
      db.exec(migrations[version]!);
      db.pragma(`user_version = ${version + 1}`);
    });
    apply();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
