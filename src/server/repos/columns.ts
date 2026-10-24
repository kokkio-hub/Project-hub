import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { BoardColumn, TaskStatus } from '../../shared/types.js';

export interface ColumnRow {
  id: number;
  project_id: number;
  name: string;
  stage: TaskStatus;
  position: number;
  created_at: string;
}

export const DEFAULT_COLUMNS: { name: string; stage: TaskStatus }[] = [
  { name: 'To do', stage: 'todo' },
  { name: 'In progress', stage: 'in_progress' },
  { name: 'In review', stage: 'review' },
  { name: 'Done', stage: 'done' },
];

export function toColumn(row: ColumnRow): BoardColumn {
  return { id: row.id, projectId: row.project_id, name: row.name, stage: row.stage, position: row.position };
}

export function listColumnRows(db: DB, projectId: number): ColumnRow[] {
  return db.prepare('SELECT * FROM project_columns WHERE project_id = ? ORDER BY position, id').all(projectId) as ColumnRow[];
}

/** Columns of several projects at once, keyed by project id. */
export function columnsByProject(db: DB, projectIds: number[]): Map<number, BoardColumn[]> {
  const map = new Map<number, BoardColumn[]>();
  if (projectIds.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT * FROM project_columns WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY project_id, position, id`,
    )
    .all(JSON.stringify(projectIds)) as ColumnRow[];
  for (const row of rows) {
    const list = map.get(row.project_id) ?? [];
    list.push(toColumn(row));
    map.set(row.project_id, list);
  }
  return map;
}

export function getColumnRow(db: DB, id: number): ColumnRow | undefined {
  return db.prepare('SELECT * FROM project_columns WHERE id = ?').get(id) as ColumnRow | undefined;
}

export function insertColumn(db: DB, projectId: number, name: string, stage: TaskStatus, position?: number): ColumnRow {
  const pos =
    position ??
    (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM project_columns WHERE project_id = ?').get(projectId) as {
      pos: number;
    }).pos;
  const result = db
    .prepare('INSERT INTO project_columns (project_id, name, stage, position, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, name.trim(), stage, pos, nowIso());
  return getColumnRow(db, Number(result.lastInsertRowid))!;
}

export function insertDefaultColumns(db: DB, projectId: number): void {
  DEFAULT_COLUMNS.forEach((c, i) => insertColumn(db, projectId, c.name, c.stage, i));
}

/**
 * The column a task with this stage goes to: the first column of that stage,
 * else (for unfinished stages) the first column that isn't a "done" column.
 */
export function columnForStage(db: DB, projectId: number, stage: TaskStatus): ColumnRow {
  const columns = listColumnRows(db, projectId);
  const exact = columns.find((c) => c.stage === stage);
  if (exact) return exact;
  const fallback = stage === 'done' ? columns.find((c) => c.stage === 'done') : columns.find((c) => c.stage !== 'done');
  const any = fallback ?? columns[0];
  if (!any) throw new Error(`Project ${projectId} has no board columns.`);
  return any;
}

export function updateColumn(db: DB, id: number, patch: { name?: string; stage?: TaskStatus }): ColumnRow {
  const current = getColumnRow(db, id)!;
  const name = patch.name?.trim() ?? current.name;
  const stage = patch.stage ?? current.stage;
  const now = nowIso();
  db.prepare('UPDATE project_columns SET name = ?, stage = ? WHERE id = ?').run(name, stage, id);
  if (stage !== current.stage) {
    // Tasks follow their column's stage, so "done" keeps meaning done everywhere.
    db.prepare(
      `UPDATE tasks
          SET status = @stage,
              completed_at = CASE WHEN @stage = 'done' THEN COALESCE(completed_at, @now) ELSE NULL END,
              updated_at = @now
        WHERE column_id = @id`,
    ).run({ stage, now, id });
  }
  return getColumnRow(db, id)!;
}

/** Puts a project's columns in the given order. `ids` must list every column once. */
export function reorderColumns(db: DB, projectId: number, ids: number[]): void {
  const set = db.prepare('UPDATE project_columns SET position = ? WHERE id = ? AND project_id = ?');
  ids.forEach((id, position) => set.run(position, id, projectId));
}

/** Deletes a column after moving its tasks to the bottom of `moveToId`. */
export function deleteColumn(db: DB, id: number, moveToId: number): void {
  const target = getColumnRow(db, moveToId)!;
  const start = (
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE column_id = ?').get(moveToId) as { pos: number }
  ).pos;
  const tasks = db.prepare('SELECT id FROM tasks WHERE column_id = ? ORDER BY position, id').all(id) as { id: number }[];
  const now = nowIso();
  const move = db.prepare(
    `UPDATE tasks
        SET column_id = @column, status = @stage, position = @position, updated_at = @now,
            completed_at = CASE WHEN @stage = 'done' THEN COALESCE(completed_at, @now) ELSE NULL END
      WHERE id = @id`,
  );
  tasks.forEach((t, i) => move.run({ column: moveToId, stage: target.stage, position: start + i, now, id: t.id }));
  db.prepare('DELETE FROM project_columns WHERE id = ?').run(id);
}
