import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ColorName, Project, ProjectStatus, ProjectVisibility } from '../../shared/types.js';
import { viewerParams, visibleProjectSql, type Viewer } from '../services/permissions.js';
import { columnsByProject, insertDefaultColumns } from './columns.js';
import type { Translator } from '../../shared/i18n/core.js';
import { labelsByProject } from './labels.js';
import { fieldsByProject } from './fields.js';
import { milestonesByProject } from './milestones.js';

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  color: ColorName;
  status: ProjectStatus;
  visibility: ProjectVisibility;
  is_template: 0 | 1;
  start_date: string | null;
  due_date: string | null;
  owner_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: number | null;
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
    LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL`;

const STATUS_ORDER = `CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END`;

function hydrate(db: DB, rows: ProjectWithCountsRow[]): Project[] {
  const ids = rows.map((r) => r.id);
  const columns = columnsByProject(db, ids);
  const labels = labelsByProject(db, ids);
  const members = membersByProject(db, ids);
  const milestones = milestonesByProject(db, ids);
  const fields = fieldsByProject(db, ids);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    status: row.status,
    visibility: row.visibility,
    isTemplate: row.is_template === 1,
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
    columns: columns.get(row.id) ?? [],
    labels: labels.get(row.id) ?? [],
    memberIds: members.get(row.id) ?? [],
    milestones: milestones.get(row.id) ?? [],
    fields: fields.get(row.id) ?? [],
  }));
}

export interface ListProjectsOptions {
  today: string;
  includeArchived?: boolean;
  /** Templates are left out unless asked for. */
  templates?: 'exclude' | 'only' | 'include';
}

/** The projects a viewer can see. */
export function listProjects(db: DB, viewer: Viewer, options: ListProjectsOptions): Project[] {
  const templates = options.templates ?? 'exclude';
  const rows = db
    .prepare(
      `${SELECT_WITH_COUNTS}
        WHERE ${visibleProjectSql('p')}
          AND (@includeArchived = 1 OR p.status != 'archived')
          AND (@templates = 'include' OR (@templates = 'only' AND p.is_template = 1) OR (@templates = 'exclude' AND p.is_template = 0))
        GROUP BY p.id
        ORDER BY ${STATUS_ORDER}, p.name COLLATE NOCASE`,
    )
    .all({
      ...viewerParams(viewer),
      today: options.today,
      includeArchived: options.includeArchived ? 1 : 0,
      templates,
    }) as ProjectWithCountsRow[];
  return hydrate(db, rows);
}

/** One project, whoever is asking (check access first). */
export function getProject(db: DB, id: number, today: string): Project | undefined {
  const row = db
    .prepare(`${SELECT_WITH_COUNTS} WHERE p.id = @id GROUP BY p.id`)
    .get({ id, today }) as ProjectWithCountsRow | undefined;
  return row ? hydrate(db, [row])[0] : undefined;
}

export function getProjectRow(db: DB, id: number): ProjectRow | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}

export interface ProjectInput {
  name: string;
  description: string;
  color: ColorName;
  status: ProjectStatus;
  visibility?: ProjectVisibility;
  isTemplate?: boolean;
  startDate: string | null;
  dueDate: string | null;
  ownerId: number | null;
  createdBy: number | null;
}

/** Creates a project with the standard four board columns (unless `withColumns` is false). */
export function insertProject(db: DB, input: ProjectInput, options: { withColumns?: boolean; tr?: Translator } = {}): number {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO projects (name, description, color, status, visibility, is_template, start_date, due_date,
                             owner_id, created_by, created_at, updated_at)
       VALUES (@name, @description, @color, @status, @visibility, @isTemplate, @startDate, @dueDate,
               @ownerId, @createdBy, @now, @now)`,
    )
    .run({
      name: input.name,
      description: input.description,
      color: input.color,
      status: input.status,
      visibility: input.visibility ?? 'team',
      isTemplate: input.isTemplate ? 1 : 0,
      startDate: input.startDate,
      dueDate: input.dueDate,
      ownerId: input.ownerId,
      createdBy: input.createdBy,
      now,
    });
  const id = Number(result.lastInsertRowid);
  if (options.withColumns !== false) insertDefaultColumns(db, id, options.tr);
  return id;
}

export type ProjectPatch = Partial<Omit<ProjectInput, 'createdBy'>>;

const PROJECT_COLUMNS: Record<keyof ProjectPatch, string> = {
  name: 'name',
  description: 'description',
  color: 'color',
  status: 'status',
  visibility: 'visibility',
  isTemplate: 'is_template',
  startDate: 'start_date',
  dueDate: 'due_date',
  ownerId: 'owner_id',
};

export function updateProject(db: DB, id: number, patch: ProjectPatch): void {
  const values: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(PROJECT_COLUMNS)) {
    const value = patch[key as keyof ProjectPatch];
    if (value !== undefined) values[column] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
  if (Object.keys(values).length === 0) return;
  values.updated_at = nowIso();
  const assignments = Object.keys(values).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE projects SET ${assignments} WHERE id = @id`).run({ ...values, id });
}

/** Moves a project to the trash. Its tasks go with it and come back with it. */
export function trashProject(db: DB, id: number, userId: number): void {
  db.prepare('UPDATE projects SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(nowIso(), userId, id);
}

export function restoreProject(db: DB, id: number): void {
  db.prepare('UPDATE projects SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
}

/** Removes a project and everything in it for good. */
export function deleteProject(db: DB, id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function membersByProject(db: DB, projectIds: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  if (projectIds.length === 0) return map;
  const rows = db
    .prepare(
      `SELECT pm.project_id, pm.user_id FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id IN (SELECT value FROM json_each(?))
        ORDER BY u.name COLLATE NOCASE`,
    )
    .all(JSON.stringify(projectIds)) as { project_id: number; user_id: number }[];
  for (const row of rows) {
    const list = map.get(row.project_id) ?? [];
    list.push(row.user_id);
    map.set(row.project_id, list);
  }
  return map;
}

export function listMemberIds(db: DB, projectId: number): number[] {
  return membersByProject(db, [projectId]).get(projectId) ?? [];
}

/** Replaces a project's member list. Returns who was added. */
export function setMembers(db: DB, projectId: number, userIds: number[], addedBy: number): number[] {
  const before = new Set(listMemberIds(db, projectId));
  const after = new Set(userIds);
  const remove = db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?');
  const add = db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)');
  const now = nowIso();
  for (const id of before) if (!after.has(id)) remove.run(projectId, id);
  const added: number[] = [];
  for (const id of after) {
    if (!before.has(id)) {
      add.run(projectId, id, addedBy, now);
      added.push(id);
    }
  }
  return added;
}

export function addMember(db: DB, projectId: number, userId: number, addedBy: number | null): void {
  db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?)').run(
    projectId,
    userId,
    addedBy,
    nowIso(),
  );
}
