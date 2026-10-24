import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { Comment } from '../../shared/types.js';

export interface CommentRow {
  id: number;
  task_id: number;
  user_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listComments(db: DB, taskId: number): Comment[] {
  const rows = db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, id').all(taskId) as CommentRow[];
  return rows.map(toComment);
}

export function getCommentRow(db: DB, id: number): CommentRow | undefined {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow | undefined;
}

export function insertComment(db: DB, taskId: number, userId: number, body: string): Comment {
  const now = nowIso();
  const result = db
    .prepare('INSERT INTO comments (task_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(taskId, userId, body, now, now);
  return toComment(getCommentRow(db, Number(result.lastInsertRowid))!);
}

export function updateComment(db: DB, id: number, body: string): Comment {
  db.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(body, nowIso(), id);
  return toComment(getCommentRow(db, id)!);
}

export function deleteComment(db: DB, id: number): void {
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
}
