import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { Notification, NotificationType } from '../../shared/types.js';
import { visibleProjectSql } from '../services/permissions.js';

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  actor_id: number | null;
  project_id: number | null;
  task_id: number | null;
  data: string;
  dedupe_key: string | null;
  created_at: string;
  read_at: string | null;
  emailed_at: string | null;
}

export function toNotification(row: NotificationRow): Notification {
  let data: Notification['data'] = {};
  try {
    data = JSON.parse(row.data) as Notification['data'];
  } catch {
    // keep empty
  }
  return {
    id: row.id,
    type: row.type,
    actorId: row.actor_id,
    projectId: row.project_id,
    taskId: row.task_id,
    data,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export interface NewNotification {
  userId: number;
  type: NotificationType;
  actorId: number | null;
  projectId: number | null;
  taskId: number | null;
  data: Notification['data'];
  dedupeKey?: string;
}

/** Returns false when a notification with the same dedupe key already exists. */
export function insertNotification(db: DB, n: NewNotification): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO notifications (user_id, type, actor_id, project_id, task_id, data, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(n.userId, n.type, n.actorId, n.projectId, n.taskId, JSON.stringify(n.data), n.dedupeKey ?? null, nowIso());
  return result.changes > 0;
}

/**
 * A person's recent notifications. Ones about tasks or projects they can no
 * longer see (deleted, made private, removed from) are left out.
 */
const STILL_VISIBLE = `(n.project_id IS NULL OR n.project_id IN (
  SELECT p.id FROM projects p WHERE ${visibleProjectSql('p')}
)) AND (n.task_id IS NULL OR n.task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL))`;

function params(userId: number, role: string) {
  return { userId, viewerId: userId, viewerAdmin: role === 'admin' ? 1 : 0, viewerGuest: role === 'guest' ? 1 : 0 };
}

export function listNotifications(db: DB, user: { id: number; role: string }, limit: number): Notification[] {
  const rows = db
    .prepare(
      `SELECT n.* FROM notifications n
        WHERE n.user_id = @userId AND ${STILL_VISIBLE}
        ORDER BY n.created_at DESC, n.id DESC LIMIT @limit`,
    )
    .all({ ...params(user.id, user.role), limit }) as NotificationRow[];
  return rows.map(toNotification);
}

export function countUnread(db: DB, user: { id: number; role: string }): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM notifications n WHERE n.user_id = @userId AND n.read_at IS NULL AND ${STILL_VISIBLE}`)
      .get(params(user.id, user.role)) as { n: number }
  ).n;
}

export function markRead(db: DB, userId: number, ids: number[] | 'all'): number {
  const now = nowIso();
  if (ids === 'all') {
    return db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId).changes;
  }
  return db
    .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))')
    .run(now, userId, JSON.stringify(ids)).changes;
}

/** Marks a person's notifications about a task as read (they opened it). */
export function markTaskRead(db: DB, userId: number, taskId: number): number {
  return db
    .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND task_id = ? AND read_at IS NULL')
    .run(nowIso(), userId, taskId).changes;
}

/** Unread notifications that haven't been emailed, still visible, oldest first. */
export function pendingEmailFor(db: DB, user: { id: number; role: string }, createdBefore: string): NotificationRow[] {
  return db
    .prepare(
      `SELECT n.* FROM notifications n
        WHERE n.user_id = @userId AND n.read_at IS NULL AND n.emailed_at IS NULL AND n.created_at <= @before
          AND ${STILL_VISIBLE}
        ORDER BY n.created_at, n.id
        LIMIT 50`,
    )
    .all({ ...params(user.id, user.role), before: createdBefore }) as NotificationRow[];
}

export function markEmailed(db: DB, ids: number[]): void {
  if (ids.length === 0) return;
  db.prepare('UPDATE notifications SET emailed_at = ? WHERE id IN (SELECT value FROM json_each(?))').run(nowIso(), JSON.stringify(ids));
}

/** Old notifications are cleaned up after 90 days. */
export function purgeOldNotifications(db: DB): number {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  return db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff).changes;
}
