import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, parseId } from '../lib/validation.js';
import { findMentions } from '../../shared/notifications.js';
import { logActivity } from '../repos/activity.js';
import { deleteComment, getCommentRow, insertComment, listComments, updateComment } from '../repos/comments.js';
import { requireAuth } from '../auth/middleware.js';
import { mentionablePeople, notify, notifyComment } from '../services/notify.js';
import { loadTask } from './guards.js';

const bodySchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000, 'Use at most 5,000 characters'),
});

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Routes for /api/tasks/:taskId/comments. Guests can comment too. */
export function taskCommentsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const { db, events } = ctx;
  router.use(requireAuth);

  router.get<{ taskId: string }>('/', (req, res) => {
    const { task } = loadTask(ctx, req, req.params.taskId);
    res.json({ comments: listComments(db, task.id) });
  });

  router.post<{ taskId: string }>('/', (req, res) => {
    const { task, project } = loadTask(ctx, req, req.params.taskId);
    const { body } = parse(bodySchema, req.body);
    if (project.status === 'archived') throw badRequest('This project is archived.');

    const comment = db.transaction(() => {
      const created = insertComment(db, task.id, req.user!.id, body);
      logActivity(db, {
        type: 'comment.created',
        userId: req.user!.id,
        projectId: task.project_id,
        taskId: task.id,
        data: { taskTitle: task.title, projectName: project.name, excerpt: excerpt(body) },
      });
      notifyComment(ctx, { task, project, actorId: req.user!.id, body, excerpt: excerpt(body) });
      return created;
    })();

    events.broadcast({
      entity: 'comment',
      action: 'created',
      id: comment.id,
      taskId: task.id,
      projectId: task.project_id,
      actorId: req.user!.id,
    });
    res.status(201).json({ comment });
  });

  return router;
}

/** Routes for /api/comments/:id (edit and delete). */
export function commentsRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;
  router.use(requireAuth);

  const load = (req: Request) => {
    const comment = getCommentRow(db, parseId(req.params.id, 'comment id'));
    if (!comment) throw notFound('Comment');
    const { task, project } = loadTask(ctx, req, comment.task_id);
    return { comment, task, project };
  };

  router.patch('/:id', (req, res) => {
    const { comment: current, task, project } = load(req);
    if (current.user_id !== req.user!.id) throw forbidden('You can only edit your own comments.');
    if (project.status === 'archived') throw badRequest('This project is archived.');
    const { body } = parse(bodySchema, req.body);
    const comment = db.transaction(() => {
      const updated = updateComment(db, current.id, body);
      // People mentioned for the first time in the edit hear about it.
      const people = mentionablePeople(ctx, project);
      const before = new Set(findMentions(current.body, people).map((p) => p.id));
      const added = findMentions(body, people)
        .map((p) => p.id)
        .filter((id) => !before.has(id));
      notify(ctx, { type: 'mentioned', recipients: added, actorId: req.user!.id, task, project, excerpt: excerpt(body) });
      return updated;
    })();
    events.broadcast({
      entity: 'comment',
      action: 'updated',
      id: comment.id,
      taskId: comment.taskId,
      projectId: task.project_id,
      actorId: req.user!.id,
    });
    res.json({ comment });
  });

  router.delete('/:id', (req, res) => {
    const { comment: current, task, project } = load(req);
    if (current.user_id !== req.user!.id && req.user!.role !== 'admin') {
      throw forbidden('You can only delete your own comments.');
    }
    if (project.status === 'archived') throw badRequest('This project is archived.');
    deleteComment(db, current.id);
    events.broadcast({
      entity: 'comment',
      action: 'deleted',
      id: current.id,
      taskId: current.task_id,
      projectId: task.project_id,
      actorId: req.user!.id,
    });
    res.status(204).end();
  });

  return router;
}
