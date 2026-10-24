import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ColorName, Label } from '../../shared/types.js';

export interface LabelRow {
  id: number;
  project_id: number;
  name: string;
  color: ColorName;
  created_at: string;
}

export function toLabel(row: LabelRow): Label {
  return { id: row.id, projectId: row.project_id, name: row.name, color: row.color };
}

export function labelsByProject(db: DB, projectIds: number[]): Map<number, Label[]> {
  const map = new Map<number, Label[]>();
  if (projectIds.length === 0) return map;
  const rows = db
    .prepare('SELECT * FROM labels WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY name COLLATE NOCASE, id')
    .all(JSON.stringify(projectIds)) as LabelRow[];
  for (const row of rows) {
    const list = map.get(row.project_id) ?? [];
    list.push(toLabel(row));
    map.set(row.project_id, list);
  }
  return map;
}

export function listLabelRows(db: DB, projectId: number): LabelRow[] {
  return db.prepare('SELECT * FROM labels WHERE project_id = ? ORDER BY name COLLATE NOCASE, id').all(projectId) as LabelRow[];
}

export function getLabelRow(db: DB, id: number): LabelRow | undefined {
  return db.prepare('SELECT * FROM labels WHERE id = ?').get(id) as LabelRow | undefined;
}

export function findLabelByName(db: DB, projectId: number, name: string): LabelRow | undefined {
  return db
    .prepare('SELECT * FROM labels WHERE project_id = ? AND name = ? COLLATE NOCASE')
    .get(projectId, name.trim()) as LabelRow | undefined;
}

export function insertLabel(db: DB, projectId: number, name: string, color: ColorName): LabelRow {
  const result = db
    .prepare('INSERT INTO labels (project_id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(projectId, name.trim(), color, nowIso());
  return getLabelRow(db, Number(result.lastInsertRowid))!;
}

export function updateLabel(db: DB, id: number, patch: { name?: string; color?: ColorName }): LabelRow {
  const current = getLabelRow(db, id)!;
  db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(
    patch.name?.trim() ?? current.name,
    patch.color ?? current.color,
    id,
  );
  return getLabelRow(db, id)!;
}

export function deleteLabel(db: DB, id: number): void {
  db.prepare('DELETE FROM labels WHERE id = ?').run(id);
}

/** Replaces the labels on a task. */
export function setTaskLabels(db: DB, taskId: number, labelIds: number[]): void {
  db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
  const add = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)');
  for (const id of labelIds) add.run(taskId, id);
}

/**
 * When a task moves to another project, keep the labels whose names exist
 * there too (matched without regard to case) and drop the rest.
 */
export function remapTaskLabels(db: DB, taskId: number, toProjectId: number): void {
  const names = db
    .prepare('SELECT l.name FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = ?')
    .all(taskId) as { name: string }[];
  const ids = names.map((n) => findLabelByName(db, toProjectId, n.name)?.id).filter((id): id is number => id !== undefined);
  setTaskLabels(db, taskId, ids);
}
