import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import { addDays, diffDays } from '../../shared/dates.js';
import type { ColorName, TaskStatus } from '../../shared/types.js';
import type { ColumnRow } from '../repos/columns.js';
import { insertColumn, listColumnRows } from '../repos/columns.js';
import { insertLabel, listLabelRows } from '../repos/labels.js';
import { copyFieldValues, insertField, listFieldRows, toField } from '../repos/fields.js';
import { insertMilestone, listMilestoneRows } from '../repos/milestones.js';
import { addMember, insertProject, listMemberIds, type ProjectRow } from '../repos/projects.js';
import type { TaskRow } from '../repos/tasks.js';
import { getUserById } from '../repos/users.js';

export interface CopyOptions {
  name: string;
  /** New start date; every date in the copy moves by the same number of days. Null keeps the dates. */
  startDate: string | null;
  includeTasks: boolean;
  keepAssignees: boolean;
  /** Put every task back in the first column and untick all checklists. */
  resetProgress: boolean;
  asTemplate: boolean;
  ownerId: number | null;
  color: ColorName;
  createdBy: number;
}

/** The date the source project's schedule is measured from. */
function anchorDate(db: DB, source: ProjectRow): string | null {
  if (source.start_date) return source.start_date;
  const row = db
    .prepare(
      `SELECT MIN(COALESCE(start_date, due_date)) AS d FROM tasks
        WHERE project_id = ? AND deleted_at IS NULL AND COALESCE(start_date, due_date) IS NOT NULL`,
    )
    .get(source.id) as { d: string | null };
  return row.d ?? source.due_date;
}

/**
 * Copies a project: its columns, labels and (optionally) tasks with their
 * labels, checklists and dependencies. Used to duplicate a project, to save one
 * as a template, and to start a new project from a template.
 */
export function copyProject(db: DB, source: ProjectRow, options: CopyOptions): number {
  const anchor = anchorDate(db, source);
  const offset = options.startDate && anchor ? diffDays(options.startDate, anchor) : 0;
  const shift = (date: string | null) => (date ? addDays(date, offset) : null);

  const projectId = insertProject(
    db,
    {
      name: options.name,
      description: source.description,
      color: options.color,
      status: 'active',
      visibility: source.visibility,
      isTemplate: options.asTemplate,
      startDate: options.startDate ?? shift(source.start_date),
      dueDate: shift(source.due_date),
      ownerId: options.ownerId,
      createdBy: options.createdBy,
    },
    { withColumns: false },
  );
  if (source.visibility === 'private') {
    for (const id of listMemberIds(db, source.id)) addMember(db, projectId, id, options.createdBy);
    addMember(db, projectId, options.createdBy, options.createdBy);
  }

  const columnMap = new Map<number, ColumnRow>();
  const columns = listColumnRows(db, source.id);
  for (const c of columns) columnMap.set(c.id, insertColumn(db, projectId, c.name, c.stage, c.position));
  const firstOpen = [...columnMap.values()].find((c) => c.stage !== 'done') ?? [...columnMap.values()][0]!;

  const labelMap = new Map<number, number>();
  for (const l of listLabelRows(db, source.id)) labelMap.set(l.id, insertLabel(db, projectId, l.name, l.color).id);

  // Milestones move with the dates; custom fields keep their choices (and choice ids).
  const milestoneMap = new Map<number, number>();
  for (const m of listMilestoneRows(db, source.id)) {
    const reached = options.resetProgress || options.asTemplate ? null : m.reached_at;
    milestoneMap.set(m.id, insertMilestone(db, projectId, { name: m.name, date: shift(m.date)!, description: m.description }, options.createdBy, reached).id);
  }
  const fieldMap = new Map<number, number>();
  for (const f of listFieldRows(db, source.id)) {
    const field = toField(f);
    fieldMap.set(f.id, insertField(db, projectId, { name: field.name, type: field.type, options: field.options, showOnCard: field.showOnCard }, f.position).id);
  }

  if (!options.includeTasks) return projectId;

  const tasks = db
    .prepare(
      `SELECT t.* FROM tasks t LEFT JOIN project_columns c ON c.id = t.column_id
        WHERE t.project_id = ? AND t.deleted_at IS NULL ORDER BY t.parent_id IS NOT NULL, c.position, t.position, t.id`,
    )
    .all(source.id) as TaskRow[];
  const now = nowIso();
  const taskMap = new Map<number, number>();
  const positions = new Map<number, number>();
  const insertTask = db.prepare(
    `INSERT INTO tasks (project_id, column_id, title, description, status, priority, assignee_id, start_date, due_date,
                        position, created_by, created_at, updated_at, completed_at, recurrence, recurrence_interval,
                        parent_id, milestone_id)
     VALUES (@projectId, @columnId, @title, @description, @status, @priority, @assigneeId, @startDate, @dueDate,
             @position, @createdBy, @now, @now, @completedAt, @recurrence, @interval, @parentId, @milestoneId)`,
  );
  for (const task of tasks) {
    const column = options.resetProgress ? firstOpen : ((task.column_id ? columnMap.get(task.column_id) : undefined) ?? firstOpen);
    const status: TaskStatus = column.stage;
    const position = positions.get(column.id) ?? 0;
    positions.set(column.id, position + 1);
    const assignee = options.keepAssignees && task.assignee_id ? getUserById(db, task.assignee_id) : undefined;
    const result = insertTask.run({
      projectId,
      columnId: column.id,
      title: task.title,
      description: task.description,
      status,
      priority: task.priority,
      assigneeId: assignee && assignee.is_active && assignee.role !== 'guest' ? assignee.id : null,
      startDate: shift(task.start_date),
      dueDate: shift(task.due_date),
      position,
      createdBy: options.createdBy,
      now,
      completedAt: status === 'done' ? (task.completed_at ?? now) : null,
      recurrence: task.recurrence,
      interval: task.recurrence_interval,
      // Main tasks come first in the query, so a subtask's parent is always copied already.
      parentId: task.parent_id !== null ? (taskMap.get(task.parent_id) ?? null) : null,
      milestoneId: task.milestone_id !== null ? (milestoneMap.get(task.milestone_id) ?? null) : null,
    });
    taskMap.set(task.id, Number(result.lastInsertRowid));
  }
  for (const [from, to] of taskMap) copyFieldValues(db, from, to, fieldMap);

  const ids = JSON.stringify([...taskMap.keys()]);
  const labels = db
    .prepare('SELECT task_id, label_id FROM task_labels WHERE task_id IN (SELECT value FROM json_each(?))')
    .all(ids) as { task_id: number; label_id: number }[];
  const addLabel = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)');
  for (const l of labels) {
    const label = labelMap.get(l.label_id);
    if (label) addLabel.run(taskMap.get(l.task_id), label);
  }

  const items = db
    .prepare('SELECT * FROM checklist_items WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY task_id, position, id')
    .all(ids) as { task_id: number; body: string; done: number; position: number }[];
  const addItem = db.prepare(
    `INSERT INTO checklist_items (task_id, body, done, position, created_by, created_at, completed_at, completed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of items) {
    const done = options.resetProgress ? 0 : item.done;
    addItem.run(taskMap.get(item.task_id), item.body, done, item.position, options.createdBy, now, done ? now : null, done ? options.createdBy : null);
  }

  const deps = db
    .prepare(
      `SELECT blocker_id, blocked_id FROM task_dependencies
        WHERE blocker_id IN (SELECT value FROM json_each(@ids)) AND blocked_id IN (SELECT value FROM json_each(@ids))`,
    )
    .all({ ids }) as { blocker_id: number; blocked_id: number }[];
  const addDep = db.prepare('INSERT OR IGNORE INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, ?, ?)');
  for (const d of deps) addDep.run(taskMap.get(d.blocker_id), taskMap.get(d.blocked_id), options.createdBy, now);

  return projectId;
}
