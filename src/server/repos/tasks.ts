import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { Recurrence, RecurrenceFrequency, Task, TaskPriority, TaskRef, TaskStatus } from '../../shared/types.js';
import { viewerParams, visibleTaskSql, WORK_PROJECT_IDS, type Viewer } from '../services/permissions.js';
import { columnForStage, getColumnRow, type ColumnRow } from './columns.js';

export interface TaskRow {
  id: number;
  project_id: number;
  column_id: number | null;
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
  deleted_at: string | null;
  deleted_by: number | null;
  recurrence: RecurrenceFrequency | null;
  recurrence_interval: number | null;
  next_task_id: number | null;
  comment_count: number;
  checklist_total: number;
  checklist_done: number;
  attachment_count: number;
  label_ids: string | null;
  blocked_by_ids: string | null;
  open_blockers: number;
}

/** Blockers only count while they exist outside the trash. */
const LIVE_BLOCKER = `b.deleted_at IS NULL AND b.project_id NOT IN (SELECT id FROM projects WHERE deleted_at IS NOT NULL)`;

const SELECT_TASK = `
  SELECT t.*,
         (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id)                           AS comment_count,
         (SELECT COUNT(*) FROM checklist_items ci WHERE ci.task_id = t.id)                  AS checklist_total,
         (SELECT COUNT(*) FROM checklist_items ci WHERE ci.task_id = t.id AND ci.done = 1)  AS checklist_done,
         (SELECT COUNT(*) FROM attachments a WHERE a.task_id = t.id)                        AS attachment_count,
         (SELECT group_concat(tl.label_id) FROM task_labels tl WHERE tl.task_id = t.id)     AS label_ids,
         (SELECT group_concat(d.blocker_id) FROM task_dependencies d JOIN tasks b ON b.id = d.blocker_id
           WHERE d.blocked_id = t.id AND ${LIVE_BLOCKER})                                   AS blocked_by_ids,
         (SELECT COUNT(*) FROM task_dependencies d JOIN tasks b ON b.id = d.blocker_id
           WHERE d.blocked_id = t.id AND b.status != 'done' AND ${LIVE_BLOCKER})            AS open_blockers
    FROM tasks t`;

const BOARD_ORDER = `t.project_id, (SELECT pc.position FROM project_columns pc WHERE pc.id = t.column_id), t.position, t.id`;

function idList(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

export function recurrenceOf(row: Pick<TaskRow, 'recurrence' | 'recurrence_interval'>): Recurrence | null {
  return row.recurrence ? { freq: row.recurrence, interval: row.recurrence_interval ?? 1 } : null;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    columnId: row.column_id,
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
    labelIds: idList(row.label_ids),
    checklistTotal: row.checklist_total,
    checklistDone: row.checklist_done,
    attachmentCount: row.attachment_count,
    blockedByIds: idList(row.blocked_by_ids),
    openBlockerCount: row.open_blockers,
    recurrence: recurrenceOf(row),
  };
}

export function toTaskRef(row: Pick<TaskRow, 'id' | 'project_id' | 'title' | 'status' | 'start_date' | 'due_date' | 'assignee_id'>): TaskRef {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date,
    assigneeId: row.assignee_id,
  };
}

export interface TaskFilter {
  projectId?: number;
  assigneeId?: number;
  statuses?: TaskStatus[];
  /** Include tasks that belong to archived projects. */
  includeArchived?: boolean;
}

/**
 * Tasks the viewer can see. Without a project, tasks in archived projects and
 * in templates are left out (they aren't current work).
 */
export function listTasks(db: DB, viewer: Viewer, filter: TaskFilter = {}): Task[] {
  const where: string[] = [visibleTaskSql('t')];
  const params: Record<string, unknown> = { ...viewerParams(viewer) };
  if (filter.projectId !== undefined) {
    where.push('t.project_id = @projectId');
    params.projectId = filter.projectId;
  } else {
    where.push(`t.project_id IN (${WORK_PROJECT_IDS})`);
    if (!filter.includeArchived) where.push("t.project_id IN (SELECT id FROM projects WHERE status != 'archived')");
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
  const sql = `${SELECT_TASK} WHERE ${where.join(' AND ')} ORDER BY ${BOARD_ORDER}`;
  return (db.prepare(sql).all(params) as TaskRow[]).map(toTask);
}

/** Open tasks assigned to a user in active or on-hold projects they can see, soonest due first. */
export function listOpenTasksFor(db: DB, viewer: Viewer, limit: number): Task[] {
  const rows = db
    .prepare(
      `${SELECT_TASK}
        WHERE t.assignee_id = @viewerId AND t.status != 'done' AND ${visibleTaskSql('t')}
          AND t.project_id IN (${WORK_PROJECT_IDS})
          AND t.project_id IN (SELECT id FROM projects WHERE status IN ('active', 'on_hold'))
        ORDER BY t.due_date IS NULL, t.due_date,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 t.id
        LIMIT @limit`,
    )
    .all({ ...viewerParams(viewer), limit }) as TaskRow[];
  return rows.map(toTask);
}

/** A task by id, including tasks in the trash. Callers check access. */
export function getTaskRow(db: DB, id: number): TaskRow | undefined {
  return db.prepare(`${SELECT_TASK} WHERE t.id = ?`).get(id) as TaskRow | undefined;
}

export function getTask(db: DB, id: number): Task | undefined {
  const row = getTaskRow(db, id);
  return row ? toTask(row) : undefined;
}

function nextPosition(db: DB, columnId: number): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE column_id = ? AND deleted_at IS NULL')
    .get(columnId) as { pos: number };
  return row.pos;
}

export interface TaskInput {
  projectId: number;
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: number | null;
  startDate: string | null;
  dueDate: string | null;
  createdBy: number | null;
  recurrence?: Recurrence | null;
}

/** Adds a task at the bottom of `column`. */
export function insertTask(db: DB, input: TaskInput, column: ColumnRow): Task {
  const now = nowIso();
  const result = db
    .prepare(
      `INSERT INTO tasks (project_id, column_id, title, description, status, priority, assignee_id, start_date, due_date,
                          position, created_by, created_at, updated_at, completed_at, recurrence, recurrence_interval)
       VALUES (@projectId, @columnId, @title, @description, @status, @priority, @assigneeId, @startDate, @dueDate,
               @position, @createdBy, @now, @now, @completedAt, @recurrence, @recurrenceInterval)`,
    )
    .run({
      projectId: input.projectId,
      columnId: column.id,
      title: input.title,
      description: input.description,
      status: column.stage,
      priority: input.priority,
      assigneeId: input.assigneeId,
      startDate: input.startDate,
      dueDate: input.dueDate,
      position: nextPosition(db, column.id),
      createdBy: input.createdBy,
      now,
      completedAt: column.stage === 'done' ? now : null,
      recurrence: input.recurrence?.freq ?? null,
      recurrenceInterval: input.recurrence ? input.recurrence.interval : null,
    });
  return getTask(db, Number(result.lastInsertRowid))!;
}

export interface TaskPatch {
  projectId?: number;
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  recurrence?: Recurrence | null;
}

const TASK_COLUMNS: Record<Exclude<keyof TaskPatch, 'recurrence'>, string> = {
  projectId: 'project_id',
  title: 'title',
  description: 'description',
  priority: 'priority',
  assigneeId: 'assignee_id',
  startDate: 'start_date',
  dueDate: 'due_date',
};

/**
 * Applies a partial update. Moving the task to another column (`column`, which
 * may be in another project) puts it at the bottom of that column and keeps
 * its status and `completed_at` in sync with the column's stage.
 */
export function updateTask(db: DB, current: TaskRow, patch: TaskPatch, column: ColumnRow | null): Task {
  const values: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(TASK_COLUMNS)) {
    const value = patch[key as keyof typeof TASK_COLUMNS];
    if (value !== undefined) values[col] = value;
  }
  if (patch.recurrence !== undefined) {
    values.recurrence = patch.recurrence?.freq ?? null;
    values.recurrence_interval = patch.recurrence ? patch.recurrence.interval : null;
  }
  if (column && column.id !== current.column_id) {
    values.column_id = column.id;
    values.position = nextPosition(db, column.id);
    if (column.stage !== current.status) {
      values.status = column.stage;
      values.completed_at = column.stage === 'done' ? nowIso() : null;
    }
  }
  if (Object.keys(values).length > 0) {
    values.updated_at = nowIso();
    const assignments = Object.keys(values).map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE tasks SET ${assignments} WHERE id = @id`).run({ ...values, id: current.id });
  }
  return getTask(db, current.id)!;
}

/**
 * Moves a task into `column`, directly after `afterId` (or to the top when
 * null), and renumbers that column. Runs in a transaction.
 */
export function moveTask(db: DB, current: TaskRow, column: ColumnRow, afterId: number | null): Task {
  const run = db.transaction(() => {
    const ids = (
      db
        .prepare('SELECT id FROM tasks WHERE column_id = ? AND id != ? AND deleted_at IS NULL ORDER BY position, id')
        .all(column.id, current.id) as { id: number }[]
    ).map((r) => r.id);

    let index = 0;
    if (afterId !== null) {
      const at = ids.indexOf(afterId);
      index = at === -1 ? ids.length : at + 1;
    }
    ids.splice(index, 0, current.id);

    const setPosition = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    ids.forEach((id, position) => setPosition.run(position, id));

    const now = nowIso();
    if (column.stage !== current.status) {
      db.prepare('UPDATE tasks SET column_id = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
        column.id,
        column.stage,
        column.stage === 'done' ? now : null,
        now,
        current.id,
      );
    } else {
      db.prepare('UPDATE tasks SET column_id = ?, updated_at = ? WHERE id = ?').run(column.id, now, current.id);
    }
  });
  run();
  return getTask(db, current.id)!;
}

/** Moves a task to the trash. */
export function trashTask(db: DB, id: number, userId: number): void {
  db.prepare('UPDATE tasks SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(nowIso(), userId, id);
}

/** Brings a task back from the trash, at the bottom of its column (or a column of the same stage). */
export function restoreTask(db: DB, current: TaskRow): Task {
  const column =
    (current.column_id !== null ? getColumnRow(db, current.column_id) : undefined) ?? columnForStage(db, current.project_id, current.status);
  db.prepare(
    'UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, column_id = ?, status = ?, position = ?, updated_at = ? WHERE id = ?',
  ).run(column.id, column.stage, nextPosition(db, column.id), nowIso(), current.id);
  return getTask(db, current.id)!;
}

/** Removes a task for good. */
export function deleteTask(db: DB, id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}
