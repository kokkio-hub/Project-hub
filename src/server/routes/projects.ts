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
} from '../lib/validation.js';
import { logActivity } from '../repos/activity.js';
import {
  deleteProject,
  getProject,
  getProjectRow,
  insertProject,
  listProjects,
  updateProject,
  type ProjectRow,
} from '../repos/projects.js';
import { getUserById, nextColor } from '../repos/users.js';
import { requireAuth } from '../auth/middleware.js';

const zProjectName = z.string().trim().min(1, 'Give the project a name').max(120, 'Use at most 120 characters');
const zDescription = z.string().trim().max(5000, 'Use at most 5,000 characters');

const createSchema = z.object({
  name: zProjectName,
  description: zDescription.default(''),
  color: zColor.optional(),
  status: zProjectStatus.default('active'),
  startDate: zNullableDate.default(null),
  dueDate: zNullableDate.default(null),
  ownerId: zIdRef.nullable().optional(),
});

const updateSchema = z.object({
  name: zProjectName.optional(),
  description: zDescription.optional(),
  color: zColor.optional(),
  status: zProjectStatus.optional(),
  startDate: zNullableDate.optional(),
  dueDate: zNullableDate.optional(),
  ownerId: zIdRef.nullable().optional(),
});

/** Admins and the project owner can change a project's settings or delete it. */
export function canManageProject(req: Request, project: Pick<ProjectRow, 'owner_id'>): boolean {
  return req.user!.role === 'admin' || project.owner_id === req.user!.id;
}

export function projectsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const assertOwner = (ownerId: number | null | undefined) => {
    if (ownerId === null || ownerId === undefined) return;
    const owner = getUserById(db, ownerId);
    if (!owner || !owner.is_active) throw badRequest('The selected owner is not an active team member.', { ownerId: 'Unknown user' });
  };

  const loadRow = (rawId: unknown): ProjectRow => {
    const row = getProjectRow(db, parseId(rawId, 'project id'));
    if (!row) throw notFound('Project');
    return row;
  };

  router.get('/', (req, res) => {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    res.json({ projects: listProjects(db, { today: req.clientToday, includeArchived }) });
  });

  router.post('/', (req, res) => {
    const input = parse(createSchema, req.body);
    assertDateOrder(input.startDate, input.dueDate);
    const ownerId = input.ownerId === undefined ? req.user!.id : input.ownerId;
    assertOwner(ownerId);
    const id = insertProject(db, {
      name: input.name,
      description: input.description,
      color: input.color ?? nextColor(db, 'projects'),
      status: input.status,
      startDate: input.startDate,
      dueDate: input.dueDate,
      ownerId,
      createdBy: req.user!.id,
    });
    logActivity(db, { type: 'project.created', userId: req.user!.id, projectId: id, data: { projectName: input.name } });
    events.broadcast({ entity: 'project', action: 'created', id, projectId: id, actorId: req.user!.id });
    res.status(201).json({ project: getProject(db, id, req.clientToday) });
  });

  router.get('/:id', (req, res) => {
    const row = loadRow(req.params.id);
    res.json({ project: getProject(db, row.id, req.clientToday) });
  });

  router.patch('/:id', (req, res) => {
    const row = loadRow(req.params.id);
    if (!canManageProject(req, row)) throw forbidden('Only the project owner or an admin can change project settings.');
    const input = parse(updateSchema, req.body);
    assertDateOrder(
      input.startDate === undefined ? row.start_date : input.startDate,
      input.dueDate === undefined ? row.due_date : input.dueDate,
    );
    if (input.ownerId !== undefined) assertOwner(input.ownerId);

    updateProject(db, row.id, input);

    const changed = (Object.keys(input) as (keyof typeof input)[]).filter((key) => {
      const before: Record<string, unknown> = {
        name: row.name,
        description: row.description,
        color: row.color,
        status: row.status,
        startDate: row.start_date,
        dueDate: row.due_date,
        ownerId: row.owner_id,
      };
      return input[key] !== before[key];
    });
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
    events.broadcast({ entity: 'project', action: 'updated', id: row.id, projectId: row.id, actorId: req.user!.id });
    res.json({ project: getProject(db, row.id, req.clientToday) });
  });

  router.delete('/:id', (req, res) => {
    const row = loadRow(req.params.id);
    if (!canManageProject(req, row)) throw forbidden('Only the project owner or an admin can delete a project.');
    db.transaction(() => {
      deleteProject(db, row.id);
      logActivity(db, { type: 'project.deleted', userId: req.user!.id, projectId: null, data: { projectName: row.name } });
    })();
    events.broadcast({ entity: 'project', action: 'deleted', id: row.id, projectId: row.id, actorId: req.user!.id });
    res.status(204).end();
  });

  return router;
}
