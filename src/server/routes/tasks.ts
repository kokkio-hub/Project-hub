import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden } from '../lib/errors.js';
import {
  assertDateOrder,
  parse,
  zIdRef,
  zNullableDate,
  zTaskPriority,
  zTaskStatus,
} from '../lib/validation.js';
import { logActivity } from '../repos/activity.js';
import { columnForStage, getColumnRow, type ColumnRow } from '../repos/columns.js';
import { listLabelRows, remapTaskLabels, setTaskLabels } from '../repos/labels.js';
import { getProjectRow, type ProjectRow } from '../repos/projects.js';
import {
  getTask,
  getTaskRow,
  insertTask,
  listTasks,
  moveTask,
  trashTask,
  updateTask,
  type TaskPatch,
  type TaskRow,
} from '../repos/tasks.js';
import { getUserById } from '../repos/users.js';
import { RECURRENCE_FREQUENCIES, TASK_STATUSES, type Task, type TaskStatus } from '../../shared/types.js';
import { requireAuth } from '../auth/middleware.js';
import { notify } from '../services/notify.js';
import { canManageProject, canSeeProject } from '../services/permissions.js';
import { afterStatusChange } from '../services/taskEvents.js';
import { assertCanChange, loadTask } from './guards.js';

const zTaskTitle = z.string().trim().min(1, 'Give the task a title').max(200, 'Use at most 200 characters');
const zDescription = z.string().max(20_000, 'Use at most 20,000 characters');
const zRecurrence = z
  .object({
    freq: z.enum(RECURRENCE_FREQUENCIES, 'Choose daily, weekly, monthly or yearly'),
    interval: z.number().int().min(1, 'At least 1').max(365, 'At most 365'),
  })
  .nullable();
const zLabelIds = z.array(zIdRef).max(30, 'Use at most 30 labels');

const createSchema = z.object({
  projectId: zIdRef,
  title: zTaskTitle,
  description: zDescription.default(''),
  /** The board column; when left out, the first column of `status`. */
  columnId: zIdRef.optional(),
  status: zTaskStatus.default('todo'),
  priority: zTaskPriority.default('medium'),
  assigneeId: zIdRef.nullable().default(null),
  startDate: zNullableDate.default(null),
  dueDate: zNullableDate.default(null),
  labelIds: zLabelIds.default([]),
  recurrence: zRecurrence.default(null),
});

const updateSchema = z.object({
  projectId: zIdRef.optional(),
  title: zTaskTitle.optional(),
  description: zDescription.optional(),
  columnId: zIdRef.optional(),
  status: zTaskStatus.optional(),
  priority: zTaskPriority.optional(),
  assigneeId: zIdRef.nullable().optional(),
  startDate: zNullableDate.optional(),
  dueDate: zNullableDate.optional(),
  labelIds: zLabelIds.optional(),
  recurrence: zRecurrence.optional(),
});

const moveSchema = z
  .object({
    columnId: zIdRef.optional(),
    /** Older clients move by stage; the task goes to the first column of that stage. */
    status: zTaskStatus.optional(),
    /** Place the task directly after this one; null puts it at the top of the column. */
    afterId: zIdRef.nullable(),
  })
  .refine((v) => v.columnId !== undefined || v.status !== undefined, 'Say which column to move the task to');

const listQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  assigneeId: z.union([z.literal('me'), z.coerce.number().int().positive()]).optional(),
  status: z
    .string()
    .optional()
    .transform((value, issue) => {
      if (!value) return undefined;
      const statuses = value.split(',').map((s) => s.trim());
      const unknown = statuses.find((s) => !(TASK_STATUSES as readonly string[]).includes(s));
      if (unknown) {
        issue.addIssue({ code: 'custom', message: `Unknown status "${unknown}"` });
        return z.NEVER;
      }
      return statuses as TaskStatus[];
    }),
  includeArchived: z.enum(['true', 'false', '1', '0']).optional(),
});

/** Fields whose edits are recorded in the activity feed as a generic "updated". */
const TRACKED_FIELDS = ['title', 'description', 'priority', 'startDate', 'dueDate', 'projectId', 'labelIds', 'recurrence'] as const;

export function tasksRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const loadWritableProject = (req: Request, projectId: number): ProjectRow => {
    const project = getProjectRow(db, projectId);
    if (!project || !canSeeProject(db, req.user!, project)) {
      throw badRequest('That project does not exist.', { projectId: 'Unknown project' });
    }
    assertCanChange(req, project);
    return project;
  };

  /** Work can go to active team members who can see the project (not to guests). */
  const assertAssignee = (assigneeId: number | null | undefined, project: ProjectRow) => {
    if (assigneeId === null || assigneeId === undefined) return;
    const user = getUserById(db, assigneeId);
    if (!user || !user.is_active || user.role === 'guest') {
      throw badRequest('Tasks can only be assigned to active team members.', { assigneeId: 'Unknown user' });
    }
    if (!canSeeProject(db, user, project)) {
      throw badRequest(`${user.name} isn’t on this private project. Add them to the project first.`, {
        assigneeId: 'Not on this project',
      });
    }
  };

  const assertLabels = (labelIds: number[] | undefined, projectId: number) => {
    if (!labelIds || labelIds.length === 0) return;
    const valid = new Set(listLabelRows(db, projectId).map((l) => l.id));
    if (!labelIds.every((id) => valid.has(id))) {
      throw badRequest('Labels must belong to the task’s project.', { labelIds: 'Unknown label' });
    }
  };

  const columnIn = (columnId: number, projectId: number): ColumnRow => {
    const column = getColumnRow(db, columnId);
    if (!column || column.project_id !== projectId) {
      throw badRequest('That column isn’t on this project’s board.', { columnId: 'Unknown column' });
    }
    return column;
  };

  const broadcast = (action: 'created' | 'updated' | 'deleted', task: { id: number; projectId: number }, actorId: number) =>
    events.broadcast({ entity: 'task', action, id: task.id, projectId: task.projectId, actorId });

  router.get('/', (req, res) => {
    const query = parse(listQuerySchema, req.query);
    const tasks = listTasks(db, req.user!, {
      projectId: query.projectId,
      assigneeId: query.assigneeId === 'me' ? req.user!.id : query.assigneeId,
      statuses: query.status,
      includeArchived: query.includeArchived === 'true' || query.includeArchived === '1',
    });
    res.json({ tasks });
  });

  router.post('/', (req, res) => {
    const input = parse(createSchema, req.body);
    const project = loadWritableProject(req, input.projectId);
    assertAssignee(input.assigneeId, project);
    assertDateOrder(input.startDate, input.dueDate);
    assertLabels(input.labelIds, project.id);
    const column = input.columnId !== undefined ? columnIn(input.columnId, project.id) : columnForStage(db, project.id, input.status);

    const task = db.transaction(() => {
      const created = insertTask(db, { ...input, createdBy: req.user!.id }, column);
      if (input.labelIds.length > 0) setTaskLabels(db, created.id, input.labelIds);
      logActivity(db, {
        type: 'task.created',
        userId: req.user!.id,
        projectId: project.id,
        taskId: created.id,
        data: { taskTitle: created.title, projectName: project.name },
      });
      notify(ctx, { type: 'assigned', recipients: [created.assigneeId], actorId: req.user!.id, task: getTaskRow(db, created.id)!, project });
      return getTask(db, created.id)!;
    })();

    broadcast('created', task, req.user!.id);
    res.status(201).json({ task });
  });

  router.get('/:id', (req, res) => {
    const { task } = loadTask(ctx, req, req.params.id);
    res.json({ task: getTask(db, task.id) });
  });

  /** Works out which column an edit puts the task in (null: it stays put). */
  const targetColumn = (current: TaskRow, input: z.infer<typeof updateSchema>, projectId: number): ColumnRow | null => {
    if (projectId !== current.project_id) {
      if (input.columnId !== undefined) return columnIn(input.columnId, projectId);
      return columnForStage(db, projectId, input.status ?? current.status);
    }
    if (input.columnId !== undefined) return columnIn(input.columnId, projectId);
    if (input.status !== undefined && input.status !== current.status) return columnForStage(db, projectId, input.status);
    return null;
  };

  router.patch('/:id', (req, res) => {
    const { task: current, project: oldProject } = loadTask(ctx, req, req.params.id);
    const input = parse(updateSchema, req.body);
    assertCanChange(req, oldProject);
    const project = input.projectId !== undefined && input.projectId !== current.project_id ? loadWritableProject(req, input.projectId) : oldProject;
    if (input.assigneeId !== undefined && input.assigneeId !== current.assignee_id) assertAssignee(input.assigneeId, project);
    else if (project.id !== current.project_id && current.assignee_id) assertAssignee(current.assignee_id, project);
    assertDateOrder(
      input.startDate === undefined ? current.start_date : input.startDate,
      input.dueDate === undefined ? current.due_date : input.dueDate,
    );
    if (input.labelIds !== undefined) assertLabels(input.labelIds, project.id);
    const column = targetColumn(current, input, project.id);

    const { task, spawned } = db.transaction(() => {
      const patch: TaskPatch = {
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: input.assigneeId,
        startDate: input.startDate,
        dueDate: input.dueDate,
        recurrence: input.recurrence,
      };
      let updated = updateTask(db, current, patch, column);
      if (input.labelIds !== undefined) setTaskLabels(db, current.id, input.labelIds);
      else if (project.id !== current.project_id) remapTaskLabels(db, current.id, project.id);
      updated = getTask(db, current.id)!;

      const base = { userId: req.user!.id, projectId: updated.projectId, taskId: updated.id };
      const snapshot = { taskTitle: updated.title, projectName: project.name };
      if (updated.status !== current.status) {
        logActivity(db, { ...base, type: 'task.status', data: { ...snapshot, from: current.status, to: updated.status } });
      }
      if (input.assigneeId !== undefined && input.assigneeId !== current.assignee_id) {
        logActivity(db, { ...base, type: 'task.assigned', data: { ...snapshot, assigneeId: input.assigneeId } });
        notify(ctx, { type: 'assigned', recipients: [input.assigneeId], actorId: req.user!.id, task: current, project });
      }
      const before: Record<(typeof TRACKED_FIELDS)[number], unknown> = {
        title: current.title,
        description: current.description,
        priority: current.priority,
        startDate: current.start_date,
        dueDate: current.due_date,
        projectId: current.project_id,
        labelIds: null,
        recurrence: null,
      };
      const fields = TRACKED_FIELDS.filter((f) => {
        if (input[f] === undefined) return false;
        if (f === 'labelIds') return input.labelIds!.slice().sort().join() !== [...(current.label_ids?.split(',') ?? [])].map(Number).sort().join();
        if (f === 'recurrence') {
          const was = current.recurrence ? `${current.recurrence}/${current.recurrence_interval}` : '';
          return (input.recurrence ? `${input.recurrence.freq}/${input.recurrence.interval}` : '') !== was;
        }
        return input[f] !== before[f];
      });
      if (fields.length > 0) {
        logActivity(db, { ...base, type: 'task.updated', data: { ...snapshot, fields: [...fields] } });
      }
      const next = afterStatusChange(ctx, { before: current, after: updated, project, actorId: req.user!.id, today: req.clientToday });
      return { task: getTask(db, current.id)!, spawned: next };
    })();

    broadcast('updated', task, req.user!.id);
    if (task.projectId !== current.project_id) {
      // Let viewers of the old project's board know the card left.
      events.broadcast({ entity: 'task', action: 'updated', id: task.id, projectId: current.project_id, actorId: req.user!.id });
    }
    if (spawned) broadcast('created', spawned, req.user!.id);
    res.json({ task, ...(spawned ? { next: spawned } : {}) });
  });

  /** Drag-and-drop: change column and/or position within a column. */
  router.post('/:id/move', (req, res) => {
    const { task: current, project } = loadTask(ctx, req, req.params.id);
    assertCanChange(req, project);
    const input = parse(moveSchema, req.body);
    const column = input.columnId !== undefined ? columnIn(input.columnId, project.id) : columnForStage(db, project.id, input.status!);

    const { task, spawned } = db.transaction(() => {
      const moved = moveTask(db, current, column, input.afterId);
      let next: Task | null = null;
      if (moved.status !== current.status) {
        logActivity(db, {
          type: 'task.status',
          userId: req.user!.id,
          projectId: current.project_id,
          taskId: current.id,
          data: { taskTitle: current.title, projectName: project.name, from: current.status, to: moved.status },
        });
        next = afterStatusChange(ctx, { before: current, after: moved, project, actorId: req.user!.id, today: req.clientToday });
      }
      return { task: moved, spawned: next };
    })();

    broadcast('updated', task, req.user!.id);
    if (spawned) broadcast('created', spawned, req.user!.id);
    res.json({ task, ...(spawned ? { next: spawned } : {}) });
  });

  /** Moves a task to the trash. */
  router.delete('/:id', (req, res) => {
    const { task: current, project } = loadTask(ctx, req, req.params.id);
    if (req.user!.role === 'guest') throw forbidden('Guests can’t delete tasks.');
    const allowed = canManageProject(req.user!, project) || current.created_by === req.user!.id;
    if (!allowed) throw forbidden('Only the person who created this task, the project owner or an admin can delete it.');
    if (project.status === 'archived') throw badRequest('This project is archived. Restore it before changing its tasks.');

    db.transaction(() => {
      trashTask(db, current.id, req.user!.id);
      logActivity(db, {
        type: 'task.deleted',
        userId: req.user!.id,
        projectId: current.project_id,
        taskId: current.id,
        data: { taskTitle: current.title, projectName: project.name },
      });
    })();

    broadcast('deleted', { id: current.id, projectId: current.project_id }, req.user!.id);
    res.status(204).end();
  });

  return router;
}
