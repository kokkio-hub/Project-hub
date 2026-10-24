import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ChecklistItem } from '../../shared/types.js';

export interface ChecklistRow {
  id: number;
  task_id: number;
  body: string;
  done: 0 | 1;
  position: number;
  created_by: number | null;
  created_at: string;
  completed_at: string | null;
  completed_by: number | null;
}

export const MAX_CHECKLIST_ITEMS = 200;

export function toChecklistItem(row: ChecklistRow): ChecklistItem {
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    done: row.done === 1,
    position: row.position,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  };
}

export function listChecklist(db: DB, taskId: number): ChecklistItem[] {
  const rows = db.prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id').all(taskId) as ChecklistRow[];
  return rows.map(toChecklistItem);
}

export function countChecklist(db: DB, taskId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM checklist_items WHERE task_id = ?').get(taskId) as { n: number }).n;
}

export function getChecklistRow(db: DB, id: number): ChecklistRow | undefined {
  return db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(id) as ChecklistRow | undefined;
}

export function insertChecklistItem(db: DB, taskId: number, body: string, userId: number | null, done = false): ChecklistItem {
  const pos = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM checklist_items WHERE task_id = ?').get(taskId) as { pos: number }
  ).pos;
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO checklist_items (task_id, body, done, position, created_by, created_at, completed_at, completed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(taskId, body.trim(), done ? 1 : 0, pos, userId, now, done ? now : null, done ? userId : null);
  return toChecklistItem(getChecklistRow(db, Number(result.lastInsertRowid))!);
}

export function updateChecklistItem(
  db: DB,
  current: ChecklistRow,
  patch: { body?: string; done?: boolean },
  userId: number,
): ChecklistItem {
  const body = patch.body?.trim() ?? current.body;
  const done = patch.done ?? current.done === 1;
  const changedDone = done !== (current.done === 1);
  db.prepare('UPDATE checklist_items SET body = ?, done = ?, completed_at = ?, completed_by = ? WHERE id = ?').run(
    body,
    done ? 1 : 0,
    changedDone ? (done ? nowIso() : null) : current.completed_at,
    changedDone ? (done ? userId : null) : current.completed_by,
    current.id,
  );
  return toChecklistItem(getChecklistRow(db, current.id)!);
}

export function reorderChecklist(db: DB, taskId: number, ids: number[]): void {
  const set = db.prepare('UPDATE checklist_items SET position = ? WHERE id = ? AND task_id = ?');
  ids.forEach((id, position) => set.run(position, id, taskId));
}

export function deleteChecklistItem(db: DB, id: number): void {
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(id);
}
