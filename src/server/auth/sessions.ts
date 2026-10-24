import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import { english, type Translator } from '../../shared/i18n/core.js';
import type { UserRow } from '../repos/users.js';

export const SESSION_COOKIE = 'ph_session';

/** Sessions are extended at most this often, to avoid a database write per request. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  last_active_at: string | null;
  user_agent: string;
  ip: string;
}

/** "Last active" on the devices page is updated at most this often. */
const ACTIVE_INTERVAL_MS = 10 * 60 * 1000;

export interface ActiveSession {
  id: string;
  user: UserRow;
  expiresAt: string;
  /** True when the expiry was pushed back and the cookie should be re-sent. */
  refreshed: boolean;
}

/** Only a hash of the token is stored, so a leaked database can't be used to hijack sessions. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(
  db: DB,
  userId: number,
  ttlDays: number,
  meta: { userAgent?: string; ip?: string } = {},
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, last_active_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    userId,
    now.toISOString(),
    expiresAt,
    now.toISOString(),
    now.toISOString(),
    (meta.userAgent ?? '').slice(0, 300),
    meta.ip ?? '',
  );
  return { token, expiresAt };
}

/** Looks up a session by cookie token. Expired sessions and deactivated users yield null. */
export function resolveSession(db: DB, token: string, ttlDays: number, meta: { ip?: string } = {}): ActiveSession | null {
  const id = hashToken(token);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as UserRow | undefined;
  if (!user || !user.is_active) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }

  // Sliding expiry: keep active users signed in, refreshed at most once a day.
  let expiresAt = row.expires_at;
  let refreshed = false;
  if (now - Date.parse(row.last_seen_at) > REFRESH_INTERVAL_MS) {
    expiresAt = new Date(now + ttlDays * 86_400_000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(nowIso(), expiresAt, id);
    refreshed = true;
  }
  if (!row.last_active_at || now - Date.parse(row.last_active_at) > ACTIVE_INTERVAL_MS || (meta.ip && meta.ip !== row.ip)) {
    db.prepare('UPDATE sessions SET last_active_at = ?, ip = ? WHERE id = ?').run(nowIso(), meta.ip || row.ip, id);
  }
  return { id, user, expiresAt, refreshed };
}

export function deleteSessionByToken(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

/** Signs a user out everywhere, optionally keeping one session (the current one). */
export function deleteUserSessions(db: DB, userId: number, exceptSessionId?: string): void {
  if (exceptSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

export function purgeExpiredSessions(db: DB): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

export function listUserSessions(db: DB, userId: number): SessionRow[] {
  return db
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_active_at, last_seen_at) DESC')
    .all(userId, nowIso()) as SessionRow[];
}

export function deleteUserSession(db: DB, userId: number, sessionId: string): boolean {
  return db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
}

/** "Chrome on Windows", "Safari on iPhone"... from a browser's user agent. */
export function describeDevice(userAgent: string, tr: Translator = english): string {
  const ua = userAgent;
  if (!ua) return tr.t('Unknown device');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  if (browser && os) return tr.t('{browser} on {os}', { browser, os });
  return browser ?? os ?? ua.slice(0, 60);
}
