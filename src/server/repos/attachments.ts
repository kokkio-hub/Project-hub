import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { Attachment } from '../../shared/types.js';

export interface AttachmentRow {
  id: number;
  task_id: number;
  user_id: number | null;
  filename: string;
  stored_name: string;
  mime_type: string;
  size: number;
  created_at: string;
  backed_up_at: string | null;
}

/** Image types that are safe to show inline. SVG is left out on purpose: it can carry scripts. */
export const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
    isImage: INLINE_IMAGE_TYPES.has(row.mime_type),
  };
}

export function listAttachments(db: DB, taskId: number): Attachment[] {
  const rows = db.prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at, id').all(taskId) as AttachmentRow[];
  return rows.map(toAttachment);
}

export function getAttachmentRow(db: DB, id: number): AttachmentRow | undefined {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
}

export function insertAttachment(
  db: DB,
  input: { taskId: number; userId: number; filename: string; storedName: string; mimeType: string; size: number },
): AttachmentRow {
  const result = db
    .prepare(
      `INSERT INTO attachments (task_id, user_id, filename, stored_name, mime_type, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.taskId, input.userId, input.filename, input.storedName, input.mimeType, input.size, nowIso());
  return getAttachmentRow(db, Number(result.lastInsertRowid))!;
}

export function deleteAttachmentRow(db: DB, id: number): void {
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
}

export function attachmentTotals(db: DB): { count: number; bytes: number } {
  const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM attachments').get() as {
    count: number;
    bytes: number;
  };
  return row;
}

/** Stored file names of every attachment on these tasks (before they're removed for good). */
export function storedNamesForTasks(db: DB, taskIds: number[]): string[] {
  if (taskIds.length === 0) return [];
  return (
    db
      .prepare('SELECT stored_name FROM attachments WHERE task_id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(taskIds)) as { stored_name: string }[]
  ).map((r) => r.stored_name);
}

export function attachmentsNotBackedUp(db: DB, limit: number): AttachmentRow[] {
  return db
    .prepare('SELECT * FROM attachments WHERE backed_up_at IS NULL ORDER BY id LIMIT ?')
    .all(limit) as AttachmentRow[];
}

export function markBackedUp(db: DB, id: number): void {
  db.prepare('UPDATE attachments SET backed_up_at = ? WHERE id = ?').run(nowIso(), id);
}
