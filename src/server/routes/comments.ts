import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, parseId } from '../lib/validation.js';
import { logActivity } from '../repos/activity.js';
import { deleteComment, getCommentRow, insertComment, listComments, updateComment } from '../repos/comments.js';
import { getProjectRow } from '../repos/projects.js';
import { getTaskRow, type TaskRow } from '../repos/tasks.js';
import { requireAuth } from '../auth/middleware.js';

const bodySchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(5000, 'Use at most 5,000 characters'),
});

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Routes for /api/tasks/:taskId/comments. */
export function taskCommentsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const { db, events } = ctx;
  router.use(requireAuth);

  const loadTask = (rawId: unknown): TaskRow => {
    const task = getTaskRow(db, parseId(rawId, 'task id'));
    if (!task) throw notFound('Task');
    return task;
  };

  router.get<{ taskId: string }>('/', (req, res) => {
    const task = loadTask(req.params.taskId);
    res.json({ comments: listComments(db, task.id) });
  });

  router.post<{ taskId: string }>('/', (req, res) => {
    const task = loadTask(req.params.taskId);
    const { body } = parse(bodySchema, req.body);
    const project = getProjectRow(db, task.project_id);
    if (project?.status === 'archived') throw badRequest('This project is archived.');

    const comment = db.transaction(() => {
      const created = insertComment(db, task.id, req.user!.id, body);
      logActivity(db, {
        type: 'comment.created',
        userId: req.user!.id,
        projectId: task.project_id,
        taskId: task.id,
        data: { taskTitle: task.title, projectName: project?.name, excerpt: excerpt(body) },
      });
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

  const load = (rawId: unknown) => {
    const comment = getCommentRow(db, parseId(rawId, 'comment id'));
    if (!comment) throw notFound('Comment');
    return comment;
  };

  const projectIdOf = (taskId: number) => getTaskRow(db, taskId)?.project_id;

  router.patch('/:id', (req, res) => {
    const current = load(req.params.id);
    if (current.user_id !== req.user!.id) throw forbidden('You can only edit your own comments.');
    const { body } = parse(bodySchema, req.body);
    const comment = updateComment(db, current.id, body);
    events.broadcast({
      entity: 'comment',
      action: 'updated',
      id: comment.id,
      taskId: comment.taskId,
      projectId: projectIdOf(comment.taskId),
      actorId: req.user!.id,
    });
    res.json({ comment });
  });

  router.delete('/:id', (req, res) => {
    const current = load(req.params.id);
    if (current.user_id !== req.user!.id && req.user!.role !== 'admin') {
      throw forbidden('You can only delete your own comments.');
    }
    deleteComment(db, current.id);
    events.broadcast({
      entity: 'comment',
      action: 'deleted',
      id: current.id,
      taskId: current.task_id,
      projectId: projectIdOf(current.task_id),
      actorId: req.user!.id,
    });
    res.status(204).end();
  });

  return router;
}
