import fs from 'node:fs';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { parse, parseId, zIdRef } from '../lib/validation.js';
import { logActivity } from '../repos/activity.js';
import {
  attachmentTotals,
  deleteAttachmentRow,
  getAttachmentRow,
  INLINE_IMAGE_TYPES,
  insertAttachment,
  listAttachments,
  toAttachment,
} from '../repos/attachments.js';
import {
  countChecklist,
  deleteChecklistItem,
  getChecklistRow,
  insertChecklistItem,
  listChecklist,
  MAX_CHECKLIST_ITEMS,
  reorderChecklist,
  updateChecklistItem,
} from '../repos/checklist.js';
import {
  addDependency,
  countBlockers,
  listDependencies,
  MAX_BLOCKERS,
  removeDependency,
  wouldCreateCycle,
} from '../repos/dependencies.js';
import { getTaskRow } from '../repos/tasks.js';
import { requireAuth } from '../auth/middleware.js';
import { canManageProject, canSeeProject } from '../services/permissions.js';
import {
  attachmentPath,
  cleanFilename,
  formatBytes,
  looksLikeImage,
  mimeTypeFor,
  newStoredName,
  removeFile,
  saveStream,
} from '../services/storage.js';
import { assertCanChange, loadTask } from './guards.js';
import { getProjectRow } from '../repos/projects.js';

const itemSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(500, 'Use at most 500 characters'),
  done: z.boolean().default(false),
});
const itemPatchSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(500, 'Use at most 500 characters').optional(),
  done: z.boolean().optional(),
});
const orderSchema = z.object({ ids: z.array(zIdRef).max(MAX_CHECKLIST_ITEMS) });
const blockerSchema = z.object({ blockerId: zIdRef });

/** Routes under /api/tasks/:taskId: checklist, dependencies and attachments. */
export function taskDetailsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const { db, events, config } = ctx;
  router.use(requireAuth);

  const changed = (req: Request, task: { id: number; project_id: number }) =>
    events.broadcast({ entity: 'task', action: 'updated', id: task.id, projectId: task.project_id, actorId: req.user!.id });

  // ---------------------------------------------------------------- checklist

  router.get<{ taskId: string }>('/checklist', (req, res) => {
    const { task } = loadTask(ctx, req, req.params.taskId);
    res.json({ items: listChecklist(db, task.id) });
  });

  router.post<{ taskId: string }>('/checklist', (req, res) => {
    const { task, project } = loadTask(ctx, req, req.params.taskId);
    assertCanChange(req, project);
    const input = parse(itemSchema, req.body);
    if (countChecklist(db, task.id) >= MAX_CHECKLIST_ITEMS) {
      throw badRequest(`A checklist can have at most ${MAX_CHECKLIST_ITEMS} items.`);
    }
    const item = insertChecklistItem(db, task.id, input.body, req.user!.id, input.done);
    changed(req, task);
    res.status(201).json({ item });
  });

  router.put<{ taskId: string }>('/checklist/order', (req, res) => {
    const { task, project } = loadTask(ctx, req, req.params.taskId);
    assertCanChange(req, project);
    const { ids } = parse(orderSchema, req.body);
    const current = listChecklist(db, task.id).map((i) => i.id);
    if (ids.length !== current.length || !current.every((id) => ids.includes(id))) {
      throw badRequest('List every checklist item exactly once.');
    }
    reorderChecklist(db, task.id, ids);
    changed(req, task);
    res.json({ items: listChecklist(db, task.id) });
  });

  // ------------------------------------------------------------- dependencies

  router.get<{ taskId: string }>('/dependencies', (req, res) => {
    const { task } = loadTask(ctx, req, req.params.taskId);
    res.json(listDependencies(db, req.user!, task.id));
  });

  /** "This task can't start until `blockerId` is done." */
  router.post<{ taskId: string }>('/blockers', (req, res) => {
    const { task, project } = loadTask(ctx, req, req.params.taskId);
    assertCanChange(req, project);
    const { blockerId } = parse(blockerSchema, req.body);
    const blocker = getTaskRow(db, blockerId);
    const blockerProject = blocker ? getProjectRow(db, blocker.project_id) : undefined;
    if (!blocker || blocker.deleted_at || !blockerProject || !canSeeProject(db, req.user!, blockerProject)) {
      throw badRequest('That task does not exist.', { blockerId: 'Unknown task' });
    }
    if (blocker.id === task.id) throw badRequest('A task can’t wait for itself.', { blockerId: 'Choose another task' });
    if (wouldCreateCycle(db, blocker.id, task.id)) {
      throw badRequest(`“${blocker.title}” already waits for this task, so it can’t block it as well.`, {
        blockerId: 'That would make a loop',
      });
    }
    if (countBlockers(db, task.id) >= MAX_BLOCKERS) throw badRequest(`A task can wait for at most ${MAX_BLOCKERS} others.`);
    addDependency(db, blocker.id, task.id, req.user!.id);
    changed(req, task);
    changed(req, blocker);
    res.status(201).json(listDependencies(db, req.user!, task.id));
  });

  router.delete<{ taskId: string; blockerId: string }>('/blockers/:blockerId', (req, res) => {
    const { task, project } = loadTask(ctx, req, req.params.taskId);
    assertCanChange(req, project);
    const blockerId = parseId(req.params.blockerId, 'task id');
    if (!removeDependency(db, blockerId, task.id)) throw notFound('Dependency');
    changed(req, task);
    const blocker = getTaskRow(db, blockerId);
    if (blocker) changed(req, blocker);
    res.json(listDependencies(db, req.user!, task.id));
  });

  // -------------------------------------------------------------- attachments

  router.get<{ taskId: string }>('/attachments', (req, res) => {
    const { task } = loadTask(ctx, req, req.params.taskId);
    res.json({ attachments: listAttachments(db, task.id) });
  });

  /**
   * Uploads one file. The body is the raw file; its name comes in the
   * X-File-Name header (URI-encoded). Its type is decided from the name.
   */
  router.post<{ taskId: string }>('/attachments', async (req, res) => {
    const { task, project } = loadTask(ctx, req, req.params.taskId);
    assertCanChange(req, project);
    const rawName = req.get('x-file-name');
    if (!rawName) throw badRequest('Missing X-File-Name header.');
    let filename: string;
    try {
      filename = cleanFilename(decodeURIComponent(rawName));
    } catch {
      throw badRequest('The file name is not valid.');
    }
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > config.maxUploadBytes) {
      throw new HttpError(413, `Files can be at most ${formatBytes(config.maxUploadBytes)}.`);
    }
    if (config.storageLimitBytes > 0) {
      const { bytes } = attachmentTotals(db);
      if (bytes + (Number.isFinite(declared) ? declared : 0) > config.storageLimitBytes) {
        throw new HttpError(507, 'The storage for attachments is full. Ask an admin to make room or raise the limit.');
      }
    }

    const storedName = newStoredName();
    const file = attachmentPath(config.attachmentsDir, storedName);
    const size = await saveStream(req, file, config.maxUploadBytes);
    if (size === 0) {
      removeFile(file);
      throw badRequest('The file is empty.');
    }
    let mimeType = mimeTypeFor(filename);
    // Something named .png that isn't a PNG is treated as an ordinary download.
    if (INLINE_IMAGE_TYPES.has(mimeType) && !looksLikeImage(file, mimeType)) mimeType = 'application/octet-stream';

    try {
      const row = db.transaction(() => {
        const created = insertAttachment(db, { taskId: task.id, userId: req.user!.id, filename, storedName, mimeType, size });
        logActivity(db, {
          type: 'task.attachment',
          userId: req.user!.id,
          projectId: project.id,
          taskId: task.id,
          data: { taskTitle: task.title, projectName: project.name, filename },
        });
        return created;
      })();
      changed(req, task);
      res.status(201).json({ attachment: toAttachment(row) });
    } catch (error) {
      removeFile(file);
      throw error;
    }
  });

  return router;
}

/** Routes for /api/checklist/:id. */
export function checklistRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const load = (req: Request) => {
    const item = getChecklistRow(db, parseId(req.params.id, 'checklist item id'));
    if (!item) throw notFound('Checklist item');
    const { task, project } = loadTask(ctx, req, item.task_id);
    assertCanChange(req, project);
    return { item, task };
  };

  router.patch('/:id', (req, res) => {
    const { item, task } = load(req);
    const input = parse(itemPatchSchema, req.body);
    const updated = updateChecklistItem(db, item, input, req.user!.id);
    events.broadcast({ entity: 'task', action: 'updated', id: task.id, projectId: task.project_id, actorId: req.user!.id });
    res.json({ item: updated });
  });

  router.delete('/:id', (req, res) => {
    const { item, task } = load(req);
    deleteChecklistItem(db, item.id);
    events.broadcast({ entity: 'task', action: 'updated', id: task.id, projectId: task.project_id, actorId: req.user!.id });
    res.status(204).end();
  });

  return router;
}

/** Routes for /api/attachments/:id (download and delete). */
export function attachmentsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events, config } = ctx;
  router.use(requireAuth);

  const load = (req: Request) => {
    const attachment = getAttachmentRow(db, parseId(req.params.id, 'attachment id'));
    if (!attachment) throw notFound('Attachment');
    const { task, project } = loadTask(ctx, req, attachment.task_id);
    return { attachment, task, project };
  };

  router.get('/:id/file', (req, res) => {
    const { attachment } = load(req);
    const file = attachmentPath(config.attachmentsDir, attachment.stored_name);
    if (!fs.existsSync(file)) throw notFound('File');
    const inline = INLINE_IMAGE_TYPES.has(attachment.mime_type) && req.query.download === undefined;
    const encoded = encodeURIComponent(attachment.filename);
    const fallback = attachment.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.setHeader('Content-Type', inline ? attachment.mime_type : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Length', String(attachment.size));
    // Files never run as a page in the app's origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(file).pipe(res);
  });

  router.delete('/:id', (req, res) => {
    const { attachment, task, project } = load(req);
    assertCanChange(req, project);
    const allowed = attachment.user_id === req.user!.id || canManageProject(req.user!, project);
    if (!allowed) throw forbidden('Only the person who added this file, the project owner or an admin can remove it.');
    deleteAttachmentRow(db, attachment.id);
    removeFile(attachmentPath(config.attachmentsDir, attachment.stored_name));
    events.broadcast({ entity: 'task', action: 'updated', id: task.id, projectId: task.project_id, actorId: req.user!.id });
    res.status(204).end();
  });

  return router;
}
