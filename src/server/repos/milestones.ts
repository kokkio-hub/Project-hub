import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { Milestone } from '../../shared/types.js';

export interface MilestoneRow {
  id: number;
  project_id: number;
  name: string;
  date: string;
  description: string;
  reached_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface MilestoneWithCounts extends MilestoneRow {
  task_count: number;
  done_count: number;
}

const SELECT = `
  SELECT m.*,
         (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.deleted_at IS NULL)                        AS task_count,
         (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.deleted_at IS NULL AND t.status = 'done') AS done_count
    FROM milestones m`;

function toMilestone(row: MilestoneWithCounts): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    date: row.date,
    description: row.description,
    reachedAt: row.reached_at,
    taskCount: row.task_count,
    doneCount: row.done_count,
  };
}

export function milestonesByProject(db: DB, projectIds: number[]): Map<number, Milestone[]> {
  const map = new Map<number, Milestone[]>();
  if (projectIds.length === 0) return map;
  const rows = db
    .prepare(`${SELECT} WHERE m.project_id IN (SELECT value FROM json_each(?)) ORDER BY m.date, m.id`)
    .all(JSON.stringify(projectIds)) as MilestoneWithCounts[];
  for (const row of rows) {
    const list = map.get(row.project_id) ?? [];
    list.push(toMilestone(row));
    map.set(row.project_id, list);
  }
  return map;
}

export function getMilestoneRow(db: DB, id: number): MilestoneRow | undefined {
  return db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as MilestoneRow | undefined;
}

export function listMilestoneRows(db: DB, projectId: number): MilestoneRow[] {
  return db.prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY date, id').all(projectId) as MilestoneRow[];
}

export function countMilestones(db: DB, projectId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM milestones WHERE project_id = ?').get(projectId) as { n: number }).n;
}

export interface MilestoneInput {
  name: string;
  date: string;
  description: string;
}

export function insertMilestone(db: DB, projectId: number, input: MilestoneInput, createdBy: number | null, reachedAt: string | null = null): MilestoneRow {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO milestones (project_id, name, date, description, reached_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(projectId, input.name.trim(), input.date, input.description.trim(), reachedAt, createdBy, now, now);
  return getMilestoneRow(db, Number(result.lastInsertRowid))!;
}

export function updateMilestone(db: DB, id: number, patch: Partial<MilestoneInput> & { reached?: boolean }): MilestoneRow {
  const current = getMilestoneRow(db, id)!;
  const reachedAt = patch.reached === undefined ? current.reached_at : patch.reached ? (current.reached_at ?? nowIso()) : null;
  db.prepare('UPDATE milestones SET name = ?, date = ?, description = ?, reached_at = ?, updated_at = ? WHERE id = ?').run(
    patch.name?.trim() ?? current.name,
    patch.date ?? current.date,
    patch.description?.trim() ?? current.description,
    reachedAt,
    nowIso(),
    id,
  );
  return getMilestoneRow(db, id)!;
}

/** Deletes a milestone. Its tasks stay, without a milestone. */
export function deleteMilestone(db: DB, id: number): void {
  db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
}
