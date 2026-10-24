import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import { COLOR_NAMES, type ColorName, type InviteStatus, type User, type UserRole } from '../../shared/types.js';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  title: string;
  password_hash: string;
  role: UserRole;
  color: ColorName;
  is_active: 0 | 1;
  must_change_password: 0 | 1;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

/** Invited people who haven't accepted yet have no password. */
export function isPending(row: Pick<UserRow, 'password_hash'>): boolean {
  return row.password_hash === '';
}

export function toUser(row: UserRow, options: { includePrivate?: boolean; invite?: InviteStatus | null } = {}): User {
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title,
    role: row.role,
    color: row.color,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    invitePending: isPending(row),
    createdAt: row.created_at,
  };
  if (options.includePrivate) {
    user.lastLoginAt = row.last_login_at;
    user.invite = options.invite ?? null;
  }
  return user;
}

export function getUserById(db: DB, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim()) as UserRow | undefined;
}

export function listUsers(db: DB): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY is_active DESC, name COLLATE NOCASE').all() as UserRow[];
}

export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/** Admins who can actually sign in: active, and not still waiting to accept an invitation. */
export function countActiveAdmins(db: DB): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND password_hash != ''").get() as {
      n: number;
    }
  ).n;
}

/** Only used to cancel invitations nobody accepted; everyone else is deactivated instead. */
export function deleteUser(db: DB, id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

/** The least-used identity colour, ties broken by the fixed palette order. */
export function nextColor(db: DB, table: 'users' | 'projects'): ColorName {
  const where = table === 'projects' ? "WHERE status != 'archived'" : 'WHERE is_active = 1';
  const rows = db.prepare(`SELECT color, COUNT(*) AS n FROM ${table} ${where} GROUP BY color`).all() as {
    color: string;
    n: number;
  }[];
  const usage = new Map(rows.map((r) => [r.color, r.n]));
  let best: ColorName = COLOR_NAMES[0];
  let bestCount = Infinity;
  for (const color of COLOR_NAMES) {
    const n = usage.get(color) ?? 0;
    if (n < bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best;
}

export interface NewUser {
  email: string;
  name: string;
  title?: string;
  role: UserRole;
  color?: ColorName;
  passwordHash: string;
  mustChangePassword: boolean;
}

export function insertUser(db: DB, input: NewUser): UserRow {
  const now = nowIso();
  const color = input.color ?? nextColor(db, 'users');
  const result = db
    .prepare(
      `INSERT INTO users (email, name, title, password_hash, role, color, is_active, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      input.email.trim().toLowerCase(),
      input.name.trim(),
      input.title?.trim() ?? '',
      input.passwordHash,
      input.role,
      color,
      input.mustChangePassword ? 1 : 0,
      now,
      now,
    );
  return getUserById(db, Number(result.lastInsertRowid))!;
}

export interface UserPatch {
  email?: string;
  name?: string;
  title?: string;
  role?: UserRole;
  color?: ColorName;
  isActive?: boolean;
  passwordHash?: string;
  mustChangePassword?: boolean;
  lastLoginAt?: string;
}

export function updateUser(db: DB, id: number, patch: UserPatch): UserRow {
  const columns: Record<string, string | number | null> = {};
  if (patch.email !== undefined) columns.email = patch.email.trim().toLowerCase();
  if (patch.name !== undefined) columns.name = patch.name.trim();
  if (patch.title !== undefined) columns.title = patch.title.trim();
  if (patch.role !== undefined) columns.role = patch.role;
  if (patch.color !== undefined) columns.color = patch.color;
  if (patch.isActive !== undefined) columns.is_active = patch.isActive ? 1 : 0;
  if (patch.passwordHash !== undefined) columns.password_hash = patch.passwordHash;
  if (patch.mustChangePassword !== undefined) columns.must_change_password = patch.mustChangePassword ? 1 : 0;
  if (patch.lastLoginAt !== undefined) columns.last_login_at = patch.lastLoginAt;

  const keys = Object.keys(columns);
  if (keys.length > 0) {
    // last_login_at alone shouldn't count as a profile edit.
    if (!(keys.length === 1 && keys[0] === 'last_login_at')) columns.updated_at = nowIso();
    const assignments = Object.keys(columns).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE users SET ${assignments} WHERE id = @id`).run({ ...columns, id });
  }
  return getUserById(db, id)!;
}
