import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, parseId, zIdRef } from '../lib/validation.js';
import { listActivity, logActivity } from '../repos/activity.js';
import { attachmentTotals } from '../repos/attachments.js';
import { buildDashboard } from '../repos/dashboard.js';
import { countUnread, listNotifications, markRead, markTaskRead } from '../repos/notifications.js';
import { getProjectRow, listProjects, restoreProject } from '../repos/projects.js';
import { getTaskRow, listTasks, restoreTask, toTaskRef, type TaskRow } from '../repos/tasks.js';
import { listUsers, listUsersFor, type UserRow } from '../repos/users.js';
import {
  type AdminStatus,
  type ColorName,
  type ProjectStatus,
  type SearchResults,
} from '../../shared/types.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';
import { buildCalendar, type CalendarTask } from '../services/calendar.js';
import { tasksCsv } from '../services/csv.js';
import {
  canManageProject,
  hasProjectAccess,
  viewerParams,
  visibleProjectSql,
  visibleTaskSql,
  WORK_PROJECT_IDS,
} from '../services/permissions.js';
import { trFor, userLanguage } from '../i18n/index.js';
import { destroyProject, destroyTask, listTrash } from '../services/trash.js';

const activityQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  taskId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const searchSchema = z.object({
  q: z.string().max(200).default(''),
});

const readSchema = z.object({
  ids: z.array(zIdRef).max(500).optional(),
  all: z.boolean().optional(),
  taskId: zIdRef.optional(),
});

/** Escapes LIKE wildcards; use with ESCAPE '\'. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Dashboard, activity, search, notifications, trash, the calendar feed, exports and admin status. */
export function miscRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events, config } = ctx;

  router.get('/dashboard', requireAuth, (req, res) => {
    res.json(buildDashboard(db, req.user!, req.clientToday, req.tzOffsetMinutes, trFor(req.lang)));
  });

  router.get('/activity', requireAuth, (req, res) => {
    const query = parse(activityQuerySchema, req.query);
    res.json({ activity: listActivity(db, req.user!, { ...query, excludeArchived: query.projectId === undefined && query.taskId === undefined }) });
  });

  /** Server-Sent Events stream: tells browsers when something changed so they can refresh. */
  router.get('/events', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
    });
    res.write('retry: 5000\n\n');
    events.add(res, req.user!.id);
    req.on('close', () => events.remove(res));
  });

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  router.get('/search', requireAuth, (req, res) => {
    const { q } = parse(searchSchema, req.query);
    const text = q.trim();
    const results: SearchResults = { tasks: [], projects: [], people: [] };
    if (!text) {
      res.json(results);
      return;
    }
    const viewer = req.user!;
    const like = likePattern(text);
    const idMatch = /^#?(\d{1,9})$/.exec(text);
    const params = { ...viewerParams(viewer), like, starts: `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, id: idMatch ? Number(idMatch[1]) : -1 };
    const tasks = db
      .prepare(
        `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE ${visibleTaskSql('t')}
            AND (t.id = @id
                 OR t.title LIKE @like ESCAPE '\\'
                 OR t.description LIKE @like ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM comments c WHERE c.task_id = t.id AND c.body LIKE @like ESCAPE '\\')
                 OR EXISTS (SELECT 1 FROM checklist_items ci WHERE ci.task_id = t.id AND ci.body LIKE @like ESCAPE '\\'))
          ORDER BY (t.id = @id) DESC,
                   (t.title LIKE @starts ESCAPE '\\') DESC,
                   (t.title LIKE @like ESCAPE '\\') DESC,
                   (t.status = 'done') ASC,
                   (p.status = 'archived' OR p.is_template = 1) ASC,
                   t.updated_at DESC
          LIMIT 12`,
      )
      .all(params) as TaskRow[];
    results.tasks = tasks.map(toTaskRef);
    results.projects = (
      db
        .prepare(
          `SELECT p.id, p.name, p.color, p.status, p.is_template FROM projects p
            WHERE ${visibleProjectSql('p')} AND p.name LIKE @like ESCAPE '\\'
            ORDER BY (p.name LIKE @starts ESCAPE '\\') DESC, (p.status = 'archived') ASC, p.name COLLATE NOCASE
            LIMIT 6`,
        )
        .all(params) as { id: number; name: string; color: ColorName; status: ProjectStatus; is_template: number }[]
    ).map((p) => ({ id: p.id, name: p.name, color: p.color, status: p.status, isTemplate: p.is_template === 1 }));
    const lower = text.toLowerCase();
    results.people = listUsersFor(db, viewer)
      .filter((u) => u.is_active && (u.name.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower)))
      .slice(0, 6)
      .map((u) => ({ id: u.id, name: u.name, email: u.email, color: u.color, title: u.title }));
    res.json(results);
  });

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  router.get('/notifications', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    res.json({ notifications: listNotifications(db, req.user!, limit), unread: countUnread(db, req.user!) });
  });

  router.post('/notifications/read', requireAuth, (req, res) => {
    const input = parse(readSchema, req.body);
    let changed = 0;
    if (input.all) changed = markRead(db, req.user!.id, 'all');
    else if (input.taskId) changed = markTaskRead(db, req.user!.id, input.taskId);
    else if (input.ids) changed = markRead(db, req.user!.id, input.ids);
    if (changed > 0) events.sendTo(req.user!.id, { entity: 'notification', action: 'updated', id: 0 });
    res.json({ unread: countUnread(db, req.user!) });
  });

  // -------------------------------------------------------------------------
  // Trash
  // -------------------------------------------------------------------------

  router.get('/trash', requireAuth, (req, res) => {
    res.json({ items: listTrash(db, req.user!) });
  });

  router.post('/trash/tasks/:id/restore', requireAuth, (req, res) => {
    const task = getTaskRow(db, parseId(req.params.id, 'task id'));
    const project = task ? getProjectRow(db, task.project_id) : undefined;
    if (!task || !task.deleted_at || !project || !hasProjectAccess(db, req.user!, project)) throw notFound('Deleted task');
    if (project.deleted_at) throw badRequest(`This task’s project “${project.name}” is in the trash. Restore the project instead.`);
    if (project.status === 'archived') throw badRequest('This project is archived. Restore it before changing its tasks.');
    const allowed =
      canManageProject(req.user!, project) ||
      (req.user!.role !== 'guest' && (task.created_by === req.user!.id || task.deleted_by === req.user!.id));
    if (!allowed) throw forbidden('Only the person who created or deleted this task, the project owner or an admin can restore it.');
    const restored = db.transaction(() => {
      const t = restoreTask(db, task);
      logActivity(db, {
        type: 'task.restored',
        userId: req.user!.id,
        projectId: project.id,
        taskId: task.id,
        data: { taskTitle: task.title, projectName: project.name },
      });
      return t;
    })();
    events.broadcast({ entity: 'task', action: 'created', id: task.id, projectId: project.id, actorId: req.user!.id });
    res.json({ task: restored });
  });

  router.post('/trash/projects/:id/restore', requireAuth, (req, res) => {
    const project = getProjectRow(db, parseId(req.params.id, 'project id'));
    if (!project || !project.deleted_at || !hasProjectAccess(db, req.user!, project)) throw notFound('Deleted project');
    if (!canManageProject(req.user!, project)) throw forbidden('Only the project owner or an admin can restore a project.');
    db.transaction(() => {
      restoreProject(db, project.id);
      logActivity(db, { type: 'project.restored', userId: req.user!.id, projectId: project.id, data: { projectName: project.name } });
    })();
    events.broadcast({ entity: 'project', action: 'created', id: project.id, projectId: project.id, actorId: req.user!.id });
    res.status(204).end();
  });

  router.delete('/trash/tasks/:id', requireAdmin, (req, res) => {
    const task = getTaskRow(db, parseId(req.params.id, 'task id'));
    if (!task || !task.deleted_at) throw notFound('Deleted task');
    destroyTask(ctx, task.id);
    res.status(204).end();
  });

  router.delete('/trash/projects/:id', requireAdmin, (req, res) => {
    const project = getProjectRow(db, parseId(req.params.id, 'project id'));
    if (!project || !project.deleted_at) throw notFound('Deleted project');
    destroyProject(ctx, project.id);
    res.status(204).end();
  });

  /** Empties the whole trash. */
  router.delete('/trash', requireAdmin, (_req, res) => {
    const projects = db.prepare('SELECT id FROM projects WHERE deleted_at IS NOT NULL').all() as { id: number }[];
    for (const p of projects) destroyProject(ctx, p.id);
    const tasks = db.prepare('SELECT id FROM tasks WHERE deleted_at IS NOT NULL').all() as { id: number }[];
    for (const t of tasks) destroyTask(ctx, t.id);
    res.status(204).end();
  });

  // -------------------------------------------------------------------------
  // Calendar feed: a secret address calendar apps subscribe to (no sign-in).
  // -------------------------------------------------------------------------

  const feedLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

  router.get('/calendar/:token', feedLimiter, (req, res) => {
    const token = String(req.params.token).replace(/\.ics$/, '');
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound('Calendar');
    const user = db
      .prepare('SELECT * FROM users WHERE calendar_token_hash = ?')
      .get(createHash('sha256').update(token).digest('hex')) as UserRow | undefined;
    if (!user || !user.is_active) throw notFound('Calendar');
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const rows = db
      .prepare(
        `SELECT t.id, t.title, t.description, t.status, t.priority, t.start_date, t.due_date, t.updated_at, t.project_id,
                t.recurrence, t.recurrence_interval, p.name AS project_name, c.name AS column_name
           FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN project_columns c ON c.id = t.column_id
          WHERE ${visibleTaskSql('t')} AND t.project_id IN (${WORK_PROJECT_IDS}) AND p.status != 'archived'
            AND (t.start_date IS NOT NULL OR t.due_date IS NOT NULL)
            AND (t.status != 'done' OR t.completed_at >= @since)
            AND (@scope = 'all' OR t.assignee_id = @viewerId)
          ORDER BY COALESCE(t.start_date, t.due_date)
          LIMIT 3000`,
      )
      .all({ ...viewerParams(user), since, scope: user.calendar_scope }) as (TaskRow & { project_name: string; column_name: string | null })[];
    const tasks: CalendarTask[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      startDate: r.start_date,
      dueDate: r.due_date,
      updatedAt: r.updated_at,
      projectId: r.project_id,
      projectName: r.project_name,
      columnName: r.column_name,
      recurrence: r.recurrence ? { freq: r.recurrence, interval: r.recurrence_interval ?? 1 } : null,
    }));
    const host = config.appUrl ? new URL(config.appUrl).host : (req.get('host') ?? 'project-hub');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="tasks.ics"');
    // Calendar apps fetch this without the app's headers, so it's in the person's own language.
    const tr = trFor(userLanguage(user, config.defaultLanguage));
    res.send(
      buildCalendar(
        {
          name: `${config.appName}: ${user.calendar_scope === 'all' ? tr.t('all tasks') : tr.t('{name}’s tasks', { name: user.name })}`,
          appUrl: config.appUrl,
          host,
          tasks,
        },
        tr,
      ),
    );
  });

  // -------------------------------------------------------------------------
  // Export everything the viewer can see as one CSV
  // -------------------------------------------------------------------------

  router.get('/export/tasks.csv', requireAuth, (req, res) => {
    const viewer = req.user!;
    const tasks = listTasks(db, viewer, { includeArchived: true });
    const projects = new Map(listProjects(db, viewer, { today: req.clientToday, includeArchived: true }).map((p) => [p.id, p]));
    const users = new Map(listUsers(db).map((u) => [u.id, u.name]));
    const csv = tasksCsv({ tasks, projects, userNames: users, includeProject: true, tr: trFor(req.lang) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="all-tasks-${req.clientToday}.csv"`);
    res.send(csv);
  });

  // -------------------------------------------------------------------------
  // Admin: backups and storage
  // -------------------------------------------------------------------------

  router.get('/admin/status', requireAdmin, (_req, res) => {
    let databaseBytes = 0;
    if (config.databasePath !== ':memory:') {
      for (const suffix of ['', '-wal']) {
        try {
          databaseBytes += fs.statSync(config.databasePath + suffix).size;
        } catch {
          // no WAL file right now
        }
      }
    }
    const totals = attachmentTotals(db);
    const body: AdminStatus = {
      backup: ctx.backups.status(),
      storage: { attachments: totals.count, attachmentBytes: totals.bytes, databaseBytes, uploadLimitBytes: config.maxUploadBytes },
      emailEnabled: ctx.mailer.enabled,
      appUrlSet: config.appUrl !== null,
    };
    res.json(body);
  });

  /** Starts a backup now. Poll /admin/status to see how it went. */
  router.post('/admin/backup', requireAdmin, (_req, res) => {
    if (!ctx.backups.status().configured) {
      throw badRequest('Backups aren’t set up yet. Add the BACKUP_S3_* variables (see “Backups” in the README).');
    }
    ctx.backups.run().catch((error: Error) => console.error(`Backup failed: ${error.message}`));
    res.status(202).json({ backup: ctx.backups.status() });
  });

  return router;
}
