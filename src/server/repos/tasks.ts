import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { Task, TaskPriority, TaskStatus } from '../../shared/types.js';

export interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: number | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  comment_count: number;
}

const SELECT_TASK = `
  SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count
    FROM tasks t`;

const STATUS_ORDER = `CASE t.status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'review' THEN 2 ELSE 3 END`;

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    startDate: row.start_date,
    dueDate: row.due_date,
    position: row.position,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    commentCount: row.comment_count,
  };
}

export interface TaskFilter {
  projectId?: number;
  assigneeId?: number;
  statuses?: TaskStatus[];
  /** Include tasks that belong to archived projects. */
  includeArchived?: boolean;
}

export function listTasks(db: DB, filter: TaskFilter = {}): Task[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.projectId !== undefined) {
    where.push('t.project_id = @projectId');
    params.projectId = filter.projectId;
  }
  if (filter.assigneeId !== undefined) {
    where.push('t.assignee_id = @assigneeId');
    params.assigneeId = filter.assigneeId;
  }
  if (filter.statuses && filter.statuses.length > 0) {
    const names = filter.statuses.map((s, i) => {
      params[`status${i}`] = s;
      return `@status${i}`;
    });
    where.push(`t.status IN (${names.join(', ')})`);
  }
  if (!filter.includeArchived && filter.projectId === undefined) {
    where.push("t.project_id IN (SELECT id FROM projects WHERE status != 'archived')");
  }
  const sql = `${SELECT_TASK} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.project_id, ${STATUS_ORDER}, t.position, t.id`;
  return (db.prepare(sql).all(params) as TaskRow[]).map(toTask);
}

/** Open tasks assigned to a user in active or on-hold projects, soonest due first. */
export function listOpenTasksFor(db: DB, userId: number, limit: number): Task[] {
  const rows = db
    .prepare(
      `${SELECT_TASK}
        WHERE t.assignee_id = ? AND t.status != 'done'
          AND t.project_id IN (SELECT id FROM projects WHERE status IN ('active', 'on_hold'))
        ORDER BY t.due_date IS NULL, t.due_date,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 t.id
        LIMIT ?`,
    )
    .all(userId, limit) as TaskRow[];
  return rows.map(toTask);
}

export function getTaskRow(db: DB, id: number): TaskRow | undefined {
  return db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id) as TaskRow | undefined;
}

export function getTask(db: DB, id: number): Task | undefined {
  const row = getTaskRow(db, id);
  return row ? toTask(row) : undefined;
}

function nextPosition(db: DB, projectId: number, status: TaskStatus): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE project_id = ? AND status = ?')
    .get(projectId, status) as { pos: number };
  return row.pos;
}

export interface TaskInput {
  projectId: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: number | null;
  startDate: string | null;
  dueDate: string | null;
  createdBy: number | null;
}

export function insertTask(db: DB, input: TaskInput): Task {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, start_date, due_date,
                          position, created_by, created_at, updated_at, completed_at)
       VALUES (@projectId, @title, @description, @status, @priority, @assigneeId, @startDate, @dueDate,
               @position, @createdBy, @now, @now, @completedAt)`,
    )
    .run({
      ...input,
      position: nextPosition(db, input.projectId, input.status),
      now,
      completedAt: input.status === 'done' ? now : null,
    });
  return getTask(db, Number(result.lastInsertRowid))!;
}

export type TaskPatch = Partial<Omit<TaskInput, 'createdBy'>>;

const TASK_COLUMNS: Record<keyof TaskPatch, string> = {
  projectId: 'project_id',
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee_id',
  startDate: 'start_date',
  dueDate: 'due_date',
};

/**
 * Applies a partial update. Changing the status or project moves the task to the
 * bottom of its new column and keeps `completed_at` in sync with the done state.
 */
export function updateTask(db: DB, current: TaskRow, patch: TaskPatch): Task {
  const values: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(TASK_COLUMNS)) {
    const value = patch[key as keyof TaskPatch];
    if (value !== undefined) values[column] = value;
  }
  const status = patch.status ?? current.status;
  const projectId = patch.projectId ?? current.project_id;
  if (status !== current.status || projectId !== current.project_id) {
    values.position = nextPosition(db, projectId, status);
  }
  if (status !== current.status) {
    values.completed_at = status === 'done' ? nowIso() : null;
  }
  if (Object.keys(values).length > 0) {
    values.updated_at = nowIso();
    const assignments = Object.keys(values).map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE tasks SET ${assignments} WHERE id = @id`).run({ ...values, id: current.id });
  }
  return getTask(db, current.id)!;
}

/**
 * Moves a task to `status`, directly after `afterId` (or to the top when null),
 * and renumbers the destination column. Runs in a transaction.
 */
export function moveTask(db: DB, current: TaskRow, status: TaskStatus, afterId: number | null): Task {
  const run = db.transaction(() => {
    const column = (
      db
        .prepare('SELECT id FROM tasks WHERE project_id = ? AND status = ? AND id != ? ORDER BY position, id')
        .all(current.project_id, status, current.id) as { id: number }[]
    ).map((r) => r.id);

    let index = 0;
    if (afterId !== null) {
      const at = column.indexOf(afterId);
      index = at === -1 ? column.length : at + 1;
    }
    column.splice(index, 0, current.id);

    const setPosition = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    column.forEach((id, position) => setPosition.run(position, id));

    const now = nowIso();
    if (status !== current.status) {
      db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
        status,
        status === 'done' ? now : null,
        now,
        current.id,
      );
    } else {
      db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, current.id);
    }
  });
  run();
  return getTask(db, current.id)!;
}

export function deleteTask(db: DB, id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
