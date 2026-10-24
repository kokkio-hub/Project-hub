import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ColorName, Project, ProjectStatus } from '../../shared/types.js';

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  color: ColorName;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
  owner_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface ProjectWithCountsRow extends ProjectRow {
  c_total: number;
  c_todo: number;
  c_in_progress: number;
  c_review: number;
  c_done: number;
  c_overdue: number;
}

const SELECT_WITH_COUNTS = `
  SELECT p.*,
         COUNT(t.id)                                                              AS c_total,
         COALESCE(SUM(t.status = 'todo'), 0)                                      AS c_todo,
         COALESCE(SUM(t.status = 'in_progress'), 0)                               AS c_in_progress,
         COALESCE(SUM(t.status = 'review'), 0)                                    AS c_review,
         COALESCE(SUM(t.status = 'done'), 0)                                      AS c_done,
         COALESCE(SUM(t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < @today), 0) AS c_overdue
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id`;

const STATUS_ORDER = `CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END`;

function toProject(row: ProjectWithCountsRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    counts: {
      total: row.c_total,
      todo: row.c_todo,
      in_progress: row.c_in_progress,
      review: row.c_review,
      done: row.c_done,
      overdue: row.c_overdue,
    },
  };
}

export function listProjects(db: DB, options: { today: string; includeArchived?: boolean }): Project[] {
  const rows = db
    .prepare(
      `${SELECT_WITH_COUNTS}
        WHERE (@includeArchived = 1 OR p.status != 'archived')
        GROUP BY p.id
        ORDER BY ${STATUS_ORDER}, p.name COLLATE NOCASE`,
    )
    .all({ today: options.today, includeArchived: options.includeArchived ? 1 : 0 }) as ProjectWithCountsRow[];
  return rows.map(toProject);
}

export function getProject(db: DB, id: number, today: string): Project | undefined {
  const row = db
    .prepare(`${SELECT_WITH_COUNTS} WHERE p.id = @id GROUP BY p.id`)
    .get({ id, today }) as ProjectWithCountsRow | undefined;
  return row ? toProject(row) : undefined;
}

export function getProjectRow(db: DB, id: number): ProjectRow | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}

export interface ProjectInput {
  name: string;
  description: string;
  color: ColorName;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  ownerId: number | null;
  createdBy: number | null;
}

export function insertProject(db: DB, input: ProjectInput): number {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO projects (name, description, color, status, start_date, due_date, owner_id, created_by, created_at, updated_at)
       VALUES (@name, @description, @color, @status, @startDate, @dueDate, @ownerId, @createdBy, @now, @now)`,
    )
    .run({ ...input, now });
  return Number(result.lastInsertRowid);
}

export type ProjectPatch = Partial<Omit<ProjectInput, 'createdBy'>>;

const PROJECT_COLUMNS: Record<keyof ProjectPatch, string> = {
  name: 'name',
  description: 'description',
  color: 'color',
  status: 'status',
  startDate: 'start_date',
  dueDate: 'due_date',
  ownerId: 'owner_id',
};

export function updateProject(db: DB, id: number, patch: ProjectPatch): void {
  const values: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(PROJECT_COLUMNS)) {
    const value = patch[key as keyof ProjectPatch];
    if (value !== undefined) values[column] = value;
  }
  if (Object.keys(values).length === 0) return;
  values.updated_at = nowIso();
  const assignments = Object.keys(values).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE projects SET ${assignments} WHERE id = @id`).run({ ...values, id });
}

export function deleteProject(db: DB, id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
