import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import {
  assertDateOrder,
  parse,
  parseId,
  zColor,
  zIdRef,
  zNullableDate,
  zProjectStatus,
  zTaskStatus,
} from '../lib/validation.js';
import { logActivity } from '../repos/activity.js';
import {
  deleteColumn,
  getColumnRow,
  insertColumn,
  listColumnRows,
  reorderColumns,
  updateColumn,
  type ColumnRow,
} from '../repos/columns.js';
import { deleteLabel, findLabelByName, getLabelRow, insertLabel, updateLabel } from '../repos/labels.js';
import {
  addMember,
  getProject,
  getProjectRow,
  insertProject,
  listProjects,
  setMembers,
  trashProject,
  updateProject,
} from '../repos/projects.js';
import { listTasks } from '../repos/tasks.js';
import { getUserById, listUsers, nextColor } from '../repos/users.js';
import { MAX_COLUMNS, PROJECT_VISIBILITIES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '../../shared/types.js';
import { requireAuth } from '../auth/middleware.js';
import { copyProject } from '../services/copyProject.js';
import { toCsv } from '../services/csv.js';
import { canChangeWork, canSeeProject } from '../services/permissions.js';
import { assertCanChange, assertManager, loadProject } from './guards.js';

const zProjectName = z.string().trim().min(1, 'Give the project a name').max(120, 'Use at most 120 characters');
const zDescription = z.string().trim().max(5000, 'Use at most 5,000 characters');
const zVisibility = z.enum(PROJECT_VISIBILITIES, 'Choose team or private');
const zColumnName = z.string().trim().min(1, 'Give the column a name').max(40, 'Use at most 40 characters');
const zLabelName = z.string().trim().min(1, 'Give the label a name').max(40, 'Use at most 40 characters');

const createSchema = z.object({
  name: zProjectName,
  description: zDescription.default(''),
  color: zColor.optional(),
  status: zProjectStatus.default('active'),
  visibility: zVisibility.default('team'),
  startDate: zNullableDate.default(null),
  dueDate: zNullableDate.default(null),
  ownerId: zIdRef.nullable().optional(),
  memberIds: z.array(zIdRef).max(500).optional(),
  /** Start from this template: copies its columns, labels and tasks. */
  fromTemplateId: zIdRef.optional(),
  /** With a template: keep who the template's tasks are assigned to. */
  keepAssignees: z.boolean().default(false),
  /** Create the project as a template. */
  isTemplate: z.boolean().default(false),
});

const updateSchema = z.object({
  name: zProjectName.optional(),
  description: zDescription.optional(),
  color: zColor.optional(),
  status: zProjectStatus.optional(),
  visibility: zVisibility.optional(),
  startDate: zNullableDate.optional(),
  dueDate: zNullableDate.optional(),
  ownerId: zIdRef.nullable().optional(),
});

const duplicateSchema = z.object({
  name: zProjectName,
  startDate: zNullableDate.default(null),
  includeTasks: z.boolean().default(true),
  keepAssignees: z.boolean().default(true),
  resetProgress: z.boolean().default(false),
  asTemplate: z.boolean().default(false),
});

const membersSchema = z.object({ userIds: z.array(zIdRef).max(500) });
const columnSchema = z.object({ name: zColumnName, stage: zTaskStatus });
const columnPatchSchema = z.object({ name: zColumnName.optional(), stage: zTaskStatus.optional() });
const orderSchema = z.object({ ids: z.array(zIdRef).min(1).max(MAX_COLUMNS) });
const labelSchema = z.object({ name: zLabelName, color: zColor.default('blue') });
const labelPatchSchema = z.object({ name: zLabelName.optional(), color: zColor.optional() });

/** A board needs at least one column for finished work and one for unfinished work. */
function assertColumnsMakeSense(columns: Pick<ColumnRow, 'stage'>[]): void {
  if (!columns.some((c) => c.stage === 'done')) {
    throw badRequest('A board needs at least one column for finished work (stage "Done").', { stage: 'Keep a Done column' });
  }
  if (!columns.some((c) => c.stage !== 'done')) {
    throw badRequest('A board needs at least one column for work that isn’t finished.', { stage: 'Keep an unfinished column' });
  }
}

export function projectsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const assertOwner = (ownerId: number | null | undefined) => {
    if (ownerId === null || ownerId === undefined) return;
    const owner = getUserById(db, ownerId);
    if (!owner || !owner.is_active || owner.role === 'guest') {
      throw badRequest('The owner must be an active team member (not a guest).', { ownerId: 'Choose someone on the team' });
    }
  };

  const assertMembers = (userIds: number[]) => {
    for (const id of userIds) {
      const user = getUserById(db, id);
      if (!user) throw badRequest('One of the selected people does not exist.', { userIds: 'Unknown person' });
    }
  };

  const announce = (projectId: number, actorId: number, action: 'created' | 'updated' | 'deleted' = 'updated') =>
    events.broadcast({ entity: 'project', action, id: projectId, projectId, actorId });

  /** Lets open boards know their tasks changed (columns moved or removed). */
  const announceTasks = (projectId: number, actorId: number) =>
    events.broadcast({ entity: 'task', action: 'updated', id: 0, projectId, actorId });

  router.get('/', (req, res) => {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const t = req.query.templates;
    const templates = t === 'only' || t === 'include' ? t : 'exclude';
    res.json({ projects: listProjects(db, req.user!, { today: req.clientToday, includeArchived, templates }) });
  });

  router.post('/', (req, res) => {
    if (!canChangeWork(req.user!)) throw forbidden('Guests can’t create projects.');
    const input = parse(createSchema, req.body);
    assertDateOrder(input.startDate, input.dueDate);
    const ownerId = input.ownerId === undefined ? req.user!.id : input.ownerId;
    assertOwner(ownerId);
    if (input.memberIds) assertMembers(input.memberIds);
    const color = input.color ?? nextColor(db, 'projects');

    const id = db.transaction(() => {
      let projectId: number;
      if (input.fromTemplateId !== undefined) {
        const template = getProjectRow(db, input.fromTemplateId);
        if (!template || !template.is_template || !canSeeProject(db, req.user!, template)) {
          throw badRequest('That template does not exist.', { fromTemplateId: 'Unknown template' });
        }
        projectId = copyProject(db, template, {
          name: input.name,
          startDate: input.startDate,
          includeTasks: true,
          keepAssignees: input.keepAssignees,
          resetProgress: true,
          asTemplate: false,
          ownerId,
          color,
          createdBy: req.user!.id,
        });
        updateProject(db, projectId, {
          description: input.description || template.description,
          visibility: input.visibility,
          status: input.status,
          ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        });
      } else {
        projectId = insertProject(db, {
          name: input.name,
          description: input.description,
          color,
          status: input.status,
          visibility: input.visibility,
          isTemplate: input.isTemplate,
          startDate: input.startDate,
          dueDate: input.dueDate,
          ownerId,
          createdBy: req.user!.id,
        });
      }
      if (input.visibility === 'private') addMember(db, projectId, req.user!.id, req.user!.id);
      for (const memberId of input.memberIds ?? []) addMember(db, projectId, memberId, req.user!.id);
      logActivity(db, { type: 'project.created', userId: req.user!.id, projectId, data: { projectName: input.name } });
      return projectId;
    })();

    announce(id, req.user!.id, 'created');
    res.status(201).json({ project: getProject(db, id, req.clientToday) });
  });

  router.get('/:id', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    res.json({ project: getProject(db, row.id, req.clientToday) });
  });

  router.patch('/:id', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    assertManager(req, row);
    const input = parse(updateSchema, req.body);
    assertDateOrder(
      input.startDate === undefined ? row.start_date : input.startDate,
      input.dueDate === undefined ? row.due_date : input.dueDate,
    );
    if (input.ownerId !== undefined) assertOwner(input.ownerId);

    db.transaction(() => {
      updateProject(db, row.id, input);
      // Whoever makes a project private keeps access to it.
      if (input.visibility === 'private' && row.visibility !== 'private') addMember(db, row.id, req.user!.id, req.user!.id);

      const before: Record<string, unknown> = {
        name: row.name,
        description: row.description,
        color: row.color,
        status: row.status,
        visibility: row.visibility,
        startDate: row.start_date,
        dueDate: row.due_date,
        ownerId: row.owner_id,
      };
      const changed = (Object.keys(input) as (keyof typeof input)[]).filter((key) => input[key] !== before[key]);
      if (changed.length > 0) {
        logActivity(db, {
          type: 'project.updated',
          userId: req.user!.id,
          projectId: row.id,
          data: {
            projectName: input.name ?? row.name,
            fields: changed,
            ...(input.status !== undefined && input.status !== row.status ? { from: row.status, to: input.status } : {}),
          },
        });
      }
    })();
    announce(row.id, req.user!.id);
    // People who just lost access need to drop the project from their screens.
    if (input.visibility === 'private' && row.visibility !== 'private') {
      events.broadcast({ entity: 'project', action: 'updated', id: row.id, actorId: req.user!.id });
    }
    res.json({ project: getProject(db, row.id, req.clientToday) });
  });

  /** Moves a project to the trash. It can be restored from there for 30 days. */
  router.delete('/:id', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    assertManager(req, row, 'delete a project');
    db.transaction(() => {
      trashProject(db, row.id, req.user!.id);
      logActivity(db, { type: 'project.deleted', userId: req.user!.id, projectId: row.id, data: { projectName: row.name } });
    })();
    events.broadcast({ entity: 'project', action: 'deleted', id: row.id, projectId: row.id, actorId: req.user!.id });
    res.status(204).end();
  });

  /** Copies a project, optionally as a template. */
  router.post('/:id/duplicate', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    if (!canChangeWork(req.user!)) throw forbidden('Guests can’t create projects.');
    const input = parse(duplicateSchema, req.body);
    const id = db.transaction(() => {
      const projectId = copyProject(db, row, {
        name: input.name,
        startDate: input.startDate,
        includeTasks: input.includeTasks,
        keepAssignees: input.keepAssignees,
        resetProgress: input.resetProgress,
        asTemplate: input.asTemplate,
        ownerId: req.user!.id,
        color: row.color,
        createdBy: req.user!.id,
      });
      logActivity(db, { type: 'project.created', userId: req.user!.id, projectId, data: { projectName: input.name } });
      return projectId;
    })();
    announce(id, req.user!.id, 'created');
    res.status(201).json({ project: getProject(db, id, req.clientToday) });
  });

  /** Replaces who belongs to the project. Private projects are only visible to their members. */
  router.put('/:id/members', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    assertManager(req, row, 'change who is on a project');
    const { userIds } = parse(membersSchema, req.body);
    assertMembers(userIds);
    const unique = [...new Set(userIds)];
    setMembers(db, row.id, unique, req.user!.id);
    announce(row.id, req.user!.id);
    // Someone may have lost access: their screens refresh and drop the project.
    events.broadcast({ entity: 'user', action: 'updated', id: 0, actorId: req.user!.id });
    res.json({ project: getProject(db, row.id, req.clientToday) });
  });

  // -------------------------------------------------------------------------
  // Board columns
  // -------------------------------------------------------------------------

  router.post('/:id/columns', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    assertManager(req, row, 'change the board columns');
    const input = parse(columnSchema, req.body);
    if (listColumnRows(db, row.id).length >= MAX_COLUMNS) {
      throw badRequest(`A board can have at most ${MAX_COLUMNS} columns.`);
    }
    insertColumn(db, row.id, input.name, input.stage);
    announce(row.id, req.user!.id);
    res.status(201).json({ project: getProject(db, row.id, req.clientToday) });
  });

  router.put('/:id/columns/order', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    assertManager(req, row, 'change the board columns');
    const { ids } = parse(orderSchema, req.body);
    const current = listColumnRows(db, row.id).map((c) => c.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw badRequest('List every column of this board exactly once.');
    }
    reorderColumns(db, row.id, ids);
    announce(row.id, req.user!.id);
    announceTasks(row.id, req.user!.id);
    res.json({ project: getProject(db, row.id, req.clientToday) });
  });

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  router.post('/:id/labels', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    assertCanChange(req, row);
    const input = parse(labelSchema, req.body);
    if (findLabelByName(db, row.id, input.name)) {
      throw badRequest('This project already has a label with that name.', { name: 'Already exists' });
    }
    const label = insertLabel(db, row.id, input.name, input.color);
    announce(row.id, req.user!.id);
    res.status(201).json({ label: { id: label.id, projectId: label.project_id, name: label.name, color: label.color } });
  });

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  router.get('/:id/export.csv', (req, res) => {
    const row = loadProject(ctx, req, req.params.id);
    const project = getProject(db, row.id, req.clientToday)!;
    const tasks = listTasks(db, req.user!, { projectId: row.id });
    const users = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const columns = new Map(project.columns.map((c) => [c.id, c.name]));
    const labels = new Map(project.labels.map((l) => [l.id, l.name]));
    const csv = toCsv(
      ['ID', 'Title', 'Column', 'Stage', 'Priority', 'Assignee', 'Labels', 'Start date', 'Due date', 'Completed', 'Created', 'Checklist', 'Description'],
      tasks.map((t) => [
        t.id,
        t.title,
        (t.columnId && columns.get(t.columnId)) || TASK_STATUS_LABELS[t.status],
        TASK_STATUS_LABELS[t.status],
        TASK_PRIORITY_LABELS[t.priority],
        t.assigneeId ? (users.get(t.assigneeId) ?? '') : '',
        t.labelIds.map((id) => labels.get(id)).filter(Boolean).join(', '),
        t.startDate,
        t.dueDate,
        t.completedAt?.slice(0, 10),
        t.createdAt.slice(0, 10),
        t.checklistTotal > 0 ? `${t.checklistDone}/${t.checklistTotal}` : '',
        t.description,
      ]),
    );
    const filename = `${row.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'project'} tasks.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="project-tasks.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(csv);
  });

  return router;
}

/** Routes for /api/columns/:id (rename, change stage, delete). */
export function columnsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const load = (req: Request) => {
    const column = getColumnRow(db, parseId(req.params.id, 'column id'));
    if (!column) throw notFound('Column');
    const project = loadProject(ctx, req, column.project_id);
    assertManager(req, project, 'change the board columns');
    return { column, project };
  };

  const done = (req: Request, projectId: number) => {
    events.broadcast({ entity: 'project', action: 'updated', id: projectId, projectId, actorId: req.user!.id });
    events.broadcast({ entity: 'task', action: 'updated', id: 0, projectId, actorId: req.user!.id });
  };

  router.patch('/:id', (req, res) => {
    const { column, project } = load(req);
    const input = parse(columnPatchSchema, req.body);
    if (input.stage !== undefined && input.stage !== column.stage) {
      const after = listColumnRows(db, project.id).map((c) => (c.id === column.id ? { ...c, stage: input.stage! } : c));
      assertColumnsMakeSense(after);
    }
    db.transaction(() => updateColumn(db, column.id, input))();
    done(req, project.id);
    res.json({ project: getProject(db, project.id, req.clientToday) });
  });

  /** Deletes a column. Its tasks move to the column given in ?moveTo=. */
  router.delete('/:id', (req, res) => {
    const { column, project } = load(req);
    const moveTo = parseId(req.query.moveTo, 'column to move the tasks to');
    const target = getColumnRow(db, moveTo);
    if (!target || target.project_id !== project.id || target.id === column.id) {
      throw badRequest('Choose another column of this board for its tasks.', { moveTo: 'Choose a column' });
    }
    assertColumnsMakeSense(listColumnRows(db, project.id).filter((c) => c.id !== column.id));
    db.transaction(() => deleteColumn(db, column.id, target.id))();
    done(req, project.id);
    res.json({ project: getProject(db, project.id, req.clientToday) });
  });

  return router;
}

/** Routes for /api/labels/:id. */
export function labelsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const load = (req: Request) => {
    const label = getLabelRow(db, parseId(req.params.id, 'label id'));
    if (!label) throw notFound('Label');
    const project = loadProject(ctx, req, label.project_id);
    assertCanChange(req, project);
    return { label, project };
  };

  router.patch('/:id', (req, res) => {
    const { label, project } = load(req);
    const input = parse(labelPatchSchema, req.body);
    if (input.name) {
      const existing = findLabelByName(db, project.id, input.name);
      if (existing && existing.id !== label.id) throw badRequest('This project already has a label with that name.', { name: 'Already exists' });
    }
    const updated = updateLabel(db, label.id, input);
    events.broadcast({ entity: 'project', action: 'updated', id: project.id, projectId: project.id, actorId: req.user!.id });
    res.json({ label: { id: updated.id, projectId: updated.project_id, name: updated.name, color: updated.color } });
  });

  router.delete('/:id', (req, res) => {
    const { label, project } = load(req);
    deleteLabel(db, label.id);
    events.broadcast({ entity: 'project', action: 'updated', id: project.id, projectId: project.id, actorId: req.user!.id });
    events.broadcast({ entity: 'task', action: 'updated', id: 0, projectId: project.id, actorId: req.user!.id });
    res.status(204).end();
  });

  return router;
}
