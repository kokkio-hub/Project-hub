import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { InviteStatus } from '../../shared/types.js';

/**
 * Single-use tokens for invitation and password reset links. Like session
 * tokens, only a SHA-256 hash is stored, so the database alone can't be used to
 * accept an invitation or reset a password.
 */
export type TokenPurpose = 'invite' | 'reset';

export interface TokenRow {
  id: string;
  user_id: number;
  purpose: TokenPurpose;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  emailed_at: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a new link token. Any earlier token of the same kind for this person stops working. */
export function issueToken(
  db: DB,
  input: { userId: number; purpose: TokenPurpose; ttlMs: number; createdBy: number | null },
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM user_tokens WHERE user_id = ? AND purpose = ?').run(input.userId, input.purpose);
    db.prepare(
      `INSERT INTO user_tokens (id, user_id, purpose, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(hashToken(token), input.userId, input.purpose, input.createdBy, now.toISOString(), expiresAt);
  })();
  return { token, expiresAt };
}

export function markTokenEmailed(db: DB, token: string): void {
  db.prepare('UPDATE user_tokens SET emailed_at = ? WHERE id = ?').run(nowIso(), hashToken(token));
}

export function deleteToken(db: DB, token: string): void {
  db.prepare('DELETE FROM user_tokens WHERE id = ?').run(hashToken(token));
}

/** The token row if the token exists, is of the right kind and hasn't expired. */
export function findValidToken(db: DB, token: unknown, purpose: TokenPurpose): TokenRow | undefined {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return undefined;
  return db
    .prepare('SELECT * FROM user_tokens WHERE id = ? AND purpose = ? AND expires_at > ?')
    .get(hashToken(token), purpose, nowIso()) as TokenRow | undefined;
}

/** The newest token of a kind for a person, valid or not. */
export function latestToken(db: DB, userId: number, purpose: TokenPurpose): TokenRow | undefined {
  return db
    .prepare('SELECT * FROM user_tokens WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId, purpose) as TokenRow | undefined;
}

/** Makes a person's outstanding links stop working (all kinds, or one kind). */
export function deleteUserTokens(db: DB, userId: number, purpose?: TokenPurpose): void {
  if (purpose) db.prepare('DELETE FROM user_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  else db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(userId);
}

/** Invitation links that still work, by person. */
export function inviteStatuses(db: DB, userId?: number): Map<number, InviteStatus> {
  const rows = db
    .prepare(
      `SELECT * FROM user_tokens
        WHERE purpose = 'invite' AND expires_at > @now AND (@userId IS NULL OR user_id = @userId)`,
    )
    .all({ now: nowIso(), userId: userId ?? null }) as TokenRow[];
  return new Map(rows.map((r) => [r.user_id, { createdAt: r.created_at, expiresAt: r.expires_at, emailedAt: r.emailed_at }]));
}

export function purgeExpiredTokens(db: DB): number {
  return db.prepare('DELETE FROM user_tokens WHERE expires_at <= ?').run(nowIso()).changes;
}
