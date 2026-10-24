import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, parseId, zColor, zDate, zIdRef } from '../lib/validation.js';
import { deleteField, getFieldRow, insertField, listFieldRows, newOptionId, reorderFields, toField, updateField } from '../repos/fields.js';
import { countMilestones, deleteMilestone, getMilestoneRow, insertMilestone, updateMilestone } from '../repos/milestones.js';
import { getProject } from '../repos/projects.js';
import { countViews, deleteView, getViewRow, insertView, listViews, reorderViews, toView, updateView } from '../repos/views.js';
import {
  FIELD_TYPES,
  MAX_FIELD_OPTIONS,
  MAX_FIELDS,
  MAX_MILESTONES,
  MAX_SAVED_VIEWS,
  PROJECT_VIEWS,
  type FieldOption,
  type GroupBy,
} from '../../shared/types.js';
import { requireAuth } from '../auth/middleware.js';
import { assertCanChange, assertManager, loadProject } from './guards.js';

const zMilestoneName = z.string().trim().min(1, 'Give the milestone a name').max(100, 'Use at most 100 characters');
const milestoneSchema = z.object({
  name: zMilestoneName,
  date: zDate,
  description: z.string().trim().max(2000, 'Use at most 2,000 characters').default(''),
});
const milestonePatchSchema = z.object({
  name: zMilestoneName.optional(),
  date: zDate.optional(),
  description: z.string().trim().max(2000, 'Use at most 2,000 characters').optional(),
  reached: z.boolean().optional(),
});

const zFieldName = z.string().trim().min(1, 'Give the field a name').max(40, 'Use at most 40 characters');
const zOptions = z
  .array(
    z.object({
      id: z.string().regex(/^[\w-]{1,20}$/).optional(),
      name: z.string().trim().min(1, 'Give the choice a name').max(40, 'Use at most 40 characters'),
      color: zColor.default('blue'),
    }),
  )
  .max(MAX_FIELD_OPTIONS, `Use at most ${MAX_FIELD_OPTIONS} choices`);
const fieldSchema = z.object({
  name: zFieldName,
  type: z.enum(FIELD_TYPES, 'Choose text, number, dropdown, date or checkbox'),
  options: zOptions.default([]),
  showOnCard: z.boolean().default(false),
});
const fieldPatchSchema = z.object({
  name: zFieldName.optional(),
  options: zOptions.optional(),
  showOnCard: z.boolean().optional(),
});
const fieldOrderSchema = z.object({ ids: z.array(zIdRef).max(MAX_FIELDS) });

const zViewName = z.string().trim().min(1, 'Give the view a name').max(60, 'Use at most 60 characters');
const zSettings = z
  .object({
    q: z.string().max(200).optional(),
    assignee: z.string().max(20).optional(),
    priority: z.string().max(20).optional(),
    label: z.string().max(20).optional(),
    milestone: z.string().max(20).optional(),
    hideDone: z.boolean().optional(),
    fields: z.record(z.string().regex(/^\d+$/), z.string().max(40)).optional(),
    groupBy: z
      .string()
      .regex(/^(none|assignee|priority|label|field:\d+)$/)
      .transform((v) => v as GroupBy)
      .optional(),
    showSubtasks: z.boolean().optional(),
    calendarMode: z.enum(['month', 'week']).optional(),
  })
  .strip();
const viewSchema = z.object({
  name: zViewName,
  view: z.enum(PROJECT_VIEWS, 'Choose board, list, timeline or calendar'),
  settings: zSettings.default({}),
});
const viewPatchSchema = z.object({
  name: zViewName.optional(),
  view: z.enum(PROJECT_VIEWS, 'Choose board, list, timeline or calendar').optional(),
  settings: zSettings.optional(),
});
const viewOrderSchema = z.object({ ids: z.array(zIdRef).max(MAX_SAVED_VIEWS) });

/** Gives new dropdown choices an id; existing ones keep theirs. */
function withIds(options: z.infer<typeof zOptions>): FieldOption[] {
  const seen = new Set<string>();
  return options.map((o) => {
    let id = o.id && !seen.has(o.id) ? o.id : newOptionId();
    while (seen.has(id)) id = newOptionId();
    seen.add(id);
    return { id, name: o.name, color: o.color };
  });
}

/** Milestones, custom fields and saved views. */
export function planningRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(['/projects/:id/milestones', '/milestones', '/projects/:id/fields', '/fields', '/projects/:id/views', '/views'], requireAuth);

  const announce = (req: Request, projectId: number, tasksToo = false) => {
    events.broadcast({ entity: 'project', action: 'updated', id: projectId, projectId, actorId: req.user!.id });
    if (tasksToo) events.broadcast({ entity: 'task', action: 'updated', id: 0, projectId, actorId: req.user!.id });
  };

  // ---------------------------------------------------------------- milestones

  router.post('/projects/:id/milestones', (req, res) => {
    const project = loadProject(ctx, req, req.params.id);
    assertCanChange(req, project);
    const input = parse(milestoneSchema, req.body);
    if (countMilestones(db, project.id) >= MAX_MILESTONES) throw badRequest(`A project can have at most ${MAX_MILESTONES} milestones.`);
    const milestone = insertMilestone(db, project.id, input, req.user!.id);
    announce(req, project.id);
    res.status(201).json({ milestoneId: milestone.id, project: getProject(db, project.id, req.clientToday) });
  });

  const loadMilestone = (req: Request) => {
    const milestone = getMilestoneRow(db, parseId(req.params.id, 'milestone id'));
    if (!milestone) throw notFound('Milestone');
    const project = loadProject(ctx, req, milestone.project_id);
    assertCanChange(req, project);
    return { milestone, project };
  };

  router.patch('/milestones/:id', (req, res) => {
    const { milestone, project } = loadMilestone(req);
    const input = parse(milestonePatchSchema, req.body);
    updateMilestone(db, milestone.id, input);
    announce(req, project.id);
    res.json({ project: getProject(db, project.id, req.clientToday) });
  });

  router.delete('/milestones/:id', (req, res) => {
    const { milestone, project } = loadMilestone(req);
    deleteMilestone(db, milestone.id);
    announce(req, project.id, true);
    res.json({ project: getProject(db, project.id, req.clientToday) });
  });

  // ---------------------------------------------------------------- custom fields

  router.post('/projects/:id/fields', (req, res) => {
    const project = loadProject(ctx, req, req.params.id);
    assertCanChange(req, project);
    assertManager(req, project, 'change the custom fields');
    const input = parse(fieldSchema, req.body);
    const existing = listFieldRows(db, project.id);
    if (existing.length >= MAX_FIELDS) throw badRequest(`A project can have at most ${MAX_FIELDS} custom fields.`);
    if (existing.some((f) => f.name.toLowerCase() === input.name.toLowerCase())) {
      throw badRequest('This project already has a field with that name.', { name: 'Already exists' });
    }
    if (input.type === 'select' && input.options.length === 0) {
      throw badRequest('A dropdown needs at least one choice.', { options: 'Add a choice' });
    }
    const field = insertField(db, project.id, { ...input, options: withIds(input.options) });
    announce(req, project.id);
    res.status(201).json({ field: toField(field), project: getProject(db, project.id, req.clientToday) });
  });

  router.put('/projects/:id/fields/order', (req, res) => {
    const project = loadProject(ctx, req, req.params.id);
    assertCanChange(req, project);
    assertManager(req, project, 'change the custom fields');
    const { ids } = parse(fieldOrderSchema, req.body);
    const current = listFieldRows(db, project.id).map((f) => f.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw badRequest('List every field of this project exactly once.');
    }
    reorderFields(db, project.id, ids);
    announce(req, project.id);
    res.json({ project: getProject(db, project.id, req.clientToday) });
  });

  const loadField = (req: Request) => {
    const field = getFieldRow(db, parseId(req.params.id, 'field id'));
    if (!field) throw notFound('Custom field');
    const project = loadProject(ctx, req, field.project_id);
    assertCanChange(req, project);
    assertManager(req, project, 'change the custom fields');
    return { field, project };
  };

  router.patch('/fields/:id', (req, res) => {
    const { field, project } = loadField(req);
    const input = parse(fieldPatchSchema, req.body);
    if (input.name && listFieldRows(db, project.id).some((f) => f.id !== field.id && f.name.toLowerCase() === input.name!.toLowerCase())) {
      throw badRequest('This project already has a field with that name.', { name: 'Already exists' });
    }
    if (input.options !== undefined && field.type === 'select' && input.options.length === 0) {
      throw badRequest('A dropdown needs at least one choice.', { options: 'Add a choice' });
    }
    const updated = updateField(db, field.id, { ...input, options: input.options ? withIds(input.options) : undefined });
    announce(req, project.id, input.options !== undefined);
    res.json({ field: toField(updated), project: getProject(db, project.id, req.clientToday) });
  });

  router.delete('/fields/:id', (req, res) => {
    const { field, project } = loadField(req);
    deleteField(db, field.id);
    announce(req, project.id, true);
    res.json({ project: getProject(db, project.id, req.clientToday) });
  });

  // ---------------------------------------------------------------- saved views

  router.get('/views', (req, res) => {
    res.json({ views: listViews(db, req.user!) });
  });

  router.post('/projects/:id/views', (req, res) => {
    const project = loadProject(ctx, req, req.params.id);
    const input = parse(viewSchema, req.body);
    if (JSON.stringify(input.settings).length > 4000) throw badRequest('These view settings are too long to save.');
    if (countViews(db, req.user!.id) >= MAX_SAVED_VIEWS) throw badRequest(`You can save at most ${MAX_SAVED_VIEWS} views.`);
    const view = insertView(db, { userId: req.user!.id, projectId: project.id, ...input });
    events.sendTo(req.user!.id, { entity: 'view', action: 'created', id: view.id, projectId: project.id, actorId: req.user!.id });
    res.status(201).json({ view: toView(view) });
  });

  /** Saved views are personal: only their owner sees or changes them. */
  const loadView = (req: Request) => {
    const view = getViewRow(db, parseId(req.params.id, 'view id'));
    if (!view || view.user_id !== req.user!.id) throw notFound('Saved view');
    loadProject(ctx, req, view.project_id);
    return view;
  };

  router.put('/views/order', (req, res) => {
    const { ids } = parse(viewOrderSchema, req.body);
    const mine = new Set(listViews(db, req.user!).map((v) => v.id));
    if (!ids.every((id) => mine.has(id))) throw forbidden('You can only reorder your own views.');
    reorderViews(db, req.user!.id, ids);
    events.sendTo(req.user!.id, { entity: 'view', action: 'updated', id: 0, actorId: req.user!.id });
    res.json({ views: listViews(db, req.user!) });
  });

  router.patch('/views/:id', (req, res) => {
    const view = loadView(req);
    const input = parse(viewPatchSchema, req.body);
    if (input.settings && JSON.stringify(input.settings).length > 4000) throw badRequest('These view settings are too long to save.');
    const updated = updateView(db, view.id, input);
    events.sendTo(req.user!.id, { entity: 'view', action: 'updated', id: view.id, projectId: view.project_id, actorId: req.user!.id });
    res.json({ view: toView(updated) });
  });

  router.delete('/views/:id', (req, res) => {
    const view = loadView(req);
    deleteView(db, view.id);
    events.sendTo(req.user!.id, { entity: 'view', action: 'deleted', id: view.id, projectId: view.project_id, actorId: req.user!.id });
    res.status(204).end();
  });

  return router;
}
