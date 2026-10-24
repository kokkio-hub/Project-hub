import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';

/** Small JSON values the server keeps between restarts (backup status, last cleanup...). */
export function getState<T>(db: DB, key: string): T | null {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function setState(db: DB, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}
