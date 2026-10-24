import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import {
  assertDateOrder,
  parse,
  parseId,
  zIdRef,
  zNullableDate,
  zTaskPriority,
  zTaskStatus,
} from '../lib/validation.js';
import { logActivity } from '../repos/activity.js';
import { getProjectRow, type ProjectRow } from '../repos/projects.js';
import {
  deleteTask,
  getTask,
  getTaskRow,
  insertTask,
  listTasks,
  moveTask,
  updateTask,
  type TaskPatch,
  type TaskRow,
} from '../repos/tasks.js';
import { getUserById } from '../repos/users.js';
import { TASK_STATUSES, type TaskStatus } from '../../shared/types.js';
import { requireAuth } from '../auth/middleware.js';

const zTaskTitle = z.string().trim().min(1, 'Give the task a title').max(200, 'Use at most 200 characters');
const zDescription = z.string().max(20_000, 'Use at most 20,000 characters');

const createSchema = z.object({
  projectId: zIdRef,
  title: zTaskTitle,
  description: zDescription.default(''),
  status: zTaskStatus.default('todo'),
  priority: zTaskPriority.default('medium'),
  assigneeId: zIdRef.nullable().default(null),
  startDate: zNullableDate.default(null),
  dueDate: zNullableDate.default(null),
});

const updateSchema = z.object({
  projectId: zIdRef.optional(),
  title: zTaskTitle.optional(),
  description: zDescription.optional(),
  status: zTaskStatus.optional(),
  priority: zTaskPriority.optional(),
  assigneeId: zIdRef.nullable().optional(),
  startDate: zNullableDate.optional(),
  dueDate: zNullableDate.optional(),
});

const moveSchema = z.object({
  status: zTaskStatus,
  /** Place the task directly after this one; null puts it at the top of the column. */
  afterId: zIdRef.nullable(),
});

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
const TRACKED_FIELDS = ['title', 'description', 'priority', 'startDate', 'dueDate', 'projectId'] as const;

export function tasksRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const loadTask = (rawId: unknown): TaskRow => {
    const task = getTaskRow(db, parseId(rawId, 'task id'));
    if (!task) throw notFound('Task');
    return task;
  };

  const loadWritableProject = (projectId: number): ProjectRow => {
    const project = getProjectRow(db, projectId);
    if (!project) throw badRequest('That project does not exist.', { projectId: 'Unknown project' });
    if (project.status === 'archived') {
      throw badRequest('This project is archived. Restore it before changing its tasks.');
    }
    return project;
  };

  const assertAssignee = (assigneeId: number | null | undefined) => {
    if (assigneeId === null || assigneeId === undefined) return;
    const user = getUserById(db, assigneeId);
    if (!user || !user.is_active) {
      throw badRequest('Tasks can only be assigned to active team members.', { assigneeId: 'Unknown user' });
    }
  };

  const broadcast = (action: 'created' | 'updated' | 'deleted', task: { id: number; projectId: number }, actorId: number) =>
    events.broadcast({ entity: 'task', action, id: task.id, projectId: task.projectId, actorId });

  router.get('/', (req, res) => {
    const query = parse(listQuerySchema, req.query);
    const tasks = listTasks(db, {
      projectId: query.projectId,
      assigneeId: query.assigneeId === 'me' ? req.user!.id : query.assigneeId,
      statuses: query.status,
      includeArchived: query.includeArchived === 'true' || query.includeArchived === '1',
    });
    res.json({ tasks });
  });

  router.post('/', (req, res) => {
    const input = parse(createSchema, req.body);
    const project = loadWritableProject(input.projectId);
    assertAssignee(input.assigneeId);
    assertDateOrder(input.startDate, input.dueDate);

    const task = db.transaction(() => {
      const created = insertTask(db, { ...input, createdBy: req.user!.id });
      logActivity(db, {
        type: 'task.created',
        userId: req.user!.id,
        projectId: project.id,
        taskId: created.id,
        data: { taskTitle: created.title, projectName: project.name },
      });
      return created;
    })();

    broadcast('created', task, req.user!.id);
    res.status(201).json({ task });
  });

  router.get('/:id', (req, res) => {
    const task = loadTask(req.params.id);
    res.json({ task: getTask(db, task.id) });
  });

  router.patch('/:id', (req, res) => {
    const current = loadTask(req.params.id);
    const input: TaskPatch = parse(updateSchema, req.body);
    const project = loadWritableProject(input.projectId ?? current.project_id);
    if (input.projectId !== undefined && input.projectId !== current.project_id) {
      loadWritableProject(current.project_id);
    }
    if (input.assigneeId !== undefined && input.assigneeId !== current.assignee_id) assertAssignee(input.assigneeId);
    assertDateOrder(
      input.startDate === undefined ? current.start_date : input.startDate,
      input.dueDate === undefined ? current.due_date : input.dueDate,
    );

    const task = db.transaction(() => {
      const updated = updateTask(db, current, input);
      const base = {
        userId: req.user!.id,
        projectId: updated.projectId,
        taskId: updated.id,
      };
      const snapshot = { taskTitle: updated.title, projectName: project.name };

      if (input.status !== undefined && input.status !== current.status) {
        logActivity(db, { ...base, type: 'task.status', data: { ...snapshot, from: current.status, to: input.status } });
      }
      if (input.assigneeId !== undefined && input.assigneeId !== current.assignee_id) {
        logActivity(db, { ...base, type: 'task.assigned', data: { ...snapshot, assigneeId: input.assigneeId } });
      }
      const before: Record<(typeof TRACKED_FIELDS)[number], unknown> = {
        title: current.title,
        description: current.description,
        priority: current.priority,
        startDate: current.start_date,
        dueDate: current.due_date,
        projectId: current.project_id,
      };
      const fields = TRACKED_FIELDS.filter((f) => input[f] !== undefined && input[f] !== before[f]);
      if (fields.length > 0) {
        logActivity(db, { ...base, type: 'task.updated', data: { ...snapshot, fields: [...fields] } });
      }
      return updated;
    })();

    broadcast('updated', task, req.user!.id);
    if (task.projectId !== current.project_id) {
      // Let viewers of the old project's board know the card left.
      events.broadcast({ entity: 'task', action: 'updated', id: task.id, projectId: current.project_id, actorId: req.user!.id });
    }
    res.json({ task });
  });

  /** Drag-and-drop: change column and/or position within a column. */
  router.post('/:id/move', (req, res) => {
    const current = loadTask(req.params.id);
    const input = parse(moveSchema, req.body);
    const project = loadWritableProject(current.project_id);

    const task = db.transaction(() => {
      const moved = moveTask(db, current, input.status, input.afterId);
      if (input.status !== current.status) {
        logActivity(db, {
          type: 'task.status',
          userId: req.user!.id,
          projectId: current.project_id,
          taskId: current.id,
          data: { taskTitle: current.title, projectName: project.name, from: current.status, to: input.status },
        });
      }
      return moved;
    })();

    broadcast('updated', task, req.user!.id);
    res.json({ task });
  });

  router.delete('/:id', (req, res) => {
    const current = loadTask(req.params.id);
    const project = getProjectRow(db, current.project_id);
    const allowed =
      req.user!.role === 'admin' || current.created_by === req.user!.id || project?.owner_id === req.user!.id;
    if (!allowed) throw forbidden('Only the person who created this task, the project owner or an admin can delete it.');

    db.transaction(() => {
      deleteTask(db, current.id);
      logActivity(db, {
        type: 'task.deleted',
        userId: req.user!.id,
        projectId: current.project_id,
        taskId: null,
        data: { taskTitle: current.title, projectName: project?.name },
      });
    })();

    broadcast('deleted', { id: current.id, projectId: current.project_id }, req.user!.id);
    res.status(204).end();
  });

  return router;
}
