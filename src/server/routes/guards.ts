import type { Request } from 'express';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parseId } from '../lib/validation.js';
import { getProjectRow, type ProjectRow } from '../repos/projects.js';
import { getTaskRow, type TaskRow } from '../repos/tasks.js';
import { canChangeWork, canManageProject, canSeeProject } from '../services/permissions.js';

/**
 * Loaders shared by the routes. Anything the viewer may not see answers 404,
 * exactly like something that doesn't exist, so ids of private work don't leak.
 */

export function loadProject(ctx: AppContext, req: Request, rawId: unknown): ProjectRow {
  const project = getProjectRow(ctx.db, parseId(rawId, 'project id'));
  if (!project || !canSeeProject(ctx.db, req.user!, project)) throw notFound('Project');
  return project;
}

export interface LoadedTask {
  task: TaskRow;
  project: ProjectRow;
}

export function loadTask(ctx: AppContext, req: Request, rawId: unknown): LoadedTask {
  const task = getTaskRow(ctx.db, parseId(rawId, 'task id'));
  if (!task || task.deleted_at) throw notFound('Task');
  const project = getProjectRow(ctx.db, task.project_id);
  if (!project || !canSeeProject(ctx.db, req.user!, project)) throw notFound('Task');
  return { task, project };
}

/** Changing work needs a non-guest account and a project that isn't archived. */
export function assertCanChange(req: Request, project: ProjectRow): void {
  if (!canChangeWork(req.user!)) throw forbidden('Guests can look and comment, but not change work.');
  if (project.status === 'archived') throw badRequest('This project is archived. Restore it before changing its tasks.');
}

export function assertManager(req: Request, project: ProjectRow, what = 'change project settings'): void {
  if (!canManageProject(req.user!, project)) throw forbidden(`Only the project owner or an admin can ${what}.`);
}
