import type { AppContext } from '../context.js';
import { nowIso } from '../db/index.js';
import { addDays } from '../../shared/dates.js';
import { describeNotification, findMentions } from '../../shared/notifications.js';
import type { NotificationType } from '../../shared/types.js';
import { notificationsEmail, type NotificationEmailItem } from '../lib/emails.js';
import { insertNotification, markEmailed, pendingEmailFor, toNotification } from '../repos/notifications.js';
import { getProjectRow, type ProjectRow } from '../repos/projects.js';
import type { TaskRow } from '../repos/tasks.js';
import { getUserById, type UserRow } from '../repos/users.js';
import { trFor, userLanguage, type Translator } from '../i18n/index.js';
import { canSeeProject, viewerParams, WORK_PROJECT_IDS } from './permissions.js';

/**
 * In-app notifications (the bell) and the emails that summarise them.
 *
 * Notifications go to the people a change is about: whoever was assigned,
 * mentioned, or is following the task (its assignee, its creator and anyone who
 * commented). Nobody is notified about their own actions, about tasks they can't
 * see, or about work in templates.
 */

export interface NotifyInput {
  type: NotificationType;
  recipients: Iterable<number | null | undefined>;
  actorId: number | null;
  task: Pick<TaskRow, 'id' | 'title' | 'project_id'>;
  project?: ProjectRow;
  excerpt?: string;
  dueDate?: string;
  dedupeKey?: (userId: number) => string;
}

/** Creates the notifications and tells the recipients' open tabs. Returns who was notified. */
export function notify(ctx: AppContext, input: NotifyInput): number[] {
  const { db, events } = ctx;
  const project = input.project ?? getProjectRow(db, input.task.project_id);
  if (!project || project.is_template === 1 || project.deleted_at) return [];
  const notified: number[] = [];
  const seen = new Set<number>();
  for (const id of input.recipients) {
    if (!id || seen.has(id) || id === input.actorId) continue;
    seen.add(id);
    const user = getUserById(db, id);
    if (!user || !user.is_active || user.password_hash === '') continue;
    if (!canSeeProject(db, user, project)) continue;
    const created = insertNotification(db, {
      userId: id,
      type: input.type,
      actorId: input.actorId,
      projectId: project.id,
      taskId: input.task.id,
      data: {
        taskTitle: input.task.title,
        projectName: project.name,
        ...(input.excerpt ? { excerpt: input.excerpt } : {}),
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      },
      dedupeKey: input.dedupeKey?.(id),
    });
    if (created) {
      notified.push(id);
      events.sendTo(id, { entity: 'notification', action: 'created', id: 0, taskId: input.task.id });
    }
  }
  return notified;
}

/** People who follow a task: its assignee, its creator and everyone who commented on it. */
export function taskFollowers(ctx: AppContext, task: Pick<TaskRow, 'id' | 'assignee_id' | 'created_by'>): number[] {
  const commenters = ctx.db
    .prepare('SELECT DISTINCT user_id FROM comments WHERE task_id = ? AND user_id IS NOT NULL')
    .all(task.id) as { user_id: number }[];
  return [task.assignee_id, task.created_by, ...commenters.map((c) => c.user_id)].filter((id): id is number => id !== null);
}

/** Active people who can see the project, who could be mentioned in it. */
export function mentionablePeople(ctx: AppContext, project: ProjectRow): UserRow[] {
  const rows = ctx.db.prepare("SELECT * FROM users WHERE is_active = 1 AND password_hash != ''").all() as UserRow[];
  return rows.filter((u) => canSeeProject(ctx.db, u, project));
}

/** Notifies everyone @mentioned in a comment, and the task's followers. */
export function notifyComment(ctx: AppContext, input: { task: TaskRow; project: ProjectRow; actorId: number; body: string; excerpt: string }): void {
  const mentioned = findMentions(input.body, mentionablePeople(ctx, input.project)).map((u) => u.id);
  notify(ctx, {
    type: 'mentioned',
    recipients: mentioned,
    actorId: input.actorId,
    task: input.task,
    project: input.project,
    excerpt: input.excerpt,
  });
  const already = new Set(mentioned);
  notify(ctx, {
    type: 'commented',
    recipients: taskFollowers(ctx, input.task).filter((id) => !already.has(id)),
    actorId: input.actorId,
    task: input.task,
    project: input.project,
    excerpt: input.excerpt,
  });
}

// ---------------------------------------------------------------------------
// Scheduled work: reminders and emails
// ---------------------------------------------------------------------------

/** A person's local calendar date, from the time zone their browser last reported. */
export function localDateFor(user: Pick<UserRow, 'tz_offset_minutes'>, now: Date): { date: string; hour: number } {
  const offset = user.tz_offset_minutes ?? -now.getTimezoneOffset();
  const local = new Date(now.getTime() + offset * 60_000);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** "Due tomorrow" reminders for open tasks people are assigned to. Each one is only ever sent once. */
export function createDueReminders(ctx: AppContext, now = new Date()): number {
  const { db } = ctx;
  const users = db.prepare("SELECT * FROM users WHERE is_active = 1 AND role != 'guest' AND password_hash != ''").all() as UserRow[];
  let count = 0;
  for (const user of users) {
    const tomorrow = addDays(localDateFor(user, now).date, 1);
    const tasks = db
      .prepare(
        `SELECT t.* FROM tasks t
          WHERE t.assignee_id = @viewerId AND t.status != 'done' AND t.deleted_at IS NULL AND t.due_date = @tomorrow
            AND t.project_id IN (${WORK_PROJECT_IDS})
            AND t.project_id IN (SELECT id FROM projects WHERE status IN ('active', 'on_hold'))`,
      )
      .all({ ...viewerParams(user), tomorrow }) as TaskRow[];
    for (const task of tasks) {
      count += notify(ctx, {
        type: 'due_soon',
        recipients: [user.id],
        actorId: null,
        task,
        dueDate: task.due_date!,
        dedupeKey: () => `due:${task.id}:${task.due_date}`,
      }).length;
    }
  }
  return count;
}

function taskUrl(appUrl: string, projectId: number | null, taskId: number | null): string {
  if (projectId && taskId) return `${appUrl}/projects/${projectId}?task=${taskId}`;
  if (projectId) return `${appUrl}/projects/${projectId}`;
  return appUrl;
}

function emailItems(ctx: AppContext, rows: ReturnType<typeof pendingEmailFor>, appUrl: string, tr: Translator): NotificationEmailItem[] {
  const names = new Map<number, string | null>();
  const nameOf = (id: number | null) => {
    if (id === null) return null;
    if (!names.has(id)) names.set(id, getUserById(ctx.db, id)?.name ?? null);
    return names.get(id)!;
  };
  return rows.map((row) => {
    const n = toNotification(row);
    return { text: describeNotification(n, nameOf(n.actorId), tr), url: taskUrl(appUrl, n.projectId, n.taskId), meta: n.data.projectName };
  });
}

let warnedNoAppUrl = false;

function canEmail(ctx: AppContext): string | null {
  if (!ctx.mailer.enabled) return null;
  if (!ctx.config.appUrl) {
    if (!warnedNoAppUrl) {
      console.warn('Notification emails are off until APP_URL is set (links in emails need it).');
      warnedNoAppUrl = true;
    }
    return null;
  }
  return ctx.config.appUrl;
}

/**
 * Emails people who chose "right away". Notifications wait two minutes first,
 * so someone who is in the app and reads them there doesn't get an email too,
 * and several quick changes arrive as one email.
 */
export async function sendInstantEmails(ctx: AppContext, now = new Date()): Promise<number> {
  const appUrl = canEmail(ctx);
  if (!appUrl) return 0;
  const { db } = ctx;
  const before = new Date(now.getTime() - 2 * 60_000).toISOString();
  const users = db
    .prepare(
      `SELECT * FROM users WHERE is_active = 1 AND notify_email = 'instant' AND password_hash != ''
          AND id IN (SELECT user_id FROM notifications WHERE emailed_at IS NULL AND read_at IS NULL)`,
    )
    .all() as UserRow[];
  let sent = 0;
  for (const user of users) {
    const rows = pendingEmailFor(db, user, before);
    if (rows.length === 0) continue;
    const tr = trFor(userLanguage(user, ctx.config.defaultLanguage));
    try {
      await ctx.mailer.send({
        to: user.email,
        ...notificationsEmail(
          { appName: ctx.config.appName, appUrl, name: user.name, mode: 'instant', notifications: emailItems(ctx, rows, appUrl, tr) },
          tr,
        ),
      });
      markEmailed(db, rows.map((r) => r.id));
      sent++;
    } catch (error) {
      console.error(`Couldn't email notifications to ${user.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return sent;
}

/**
 * The daily email, sent from 8:00 in each person's time zone: overdue work,
 * work due today, and notifications they haven't seen. Skipped when there is
 * nothing to say.
 */
export async function sendDailyDigests(ctx: AppContext, now = new Date()): Promise<number> {
  const appUrl = canEmail(ctx);
  if (!appUrl) return 0;
  const { db } = ctx;
  const users = db
    .prepare("SELECT * FROM users WHERE is_active = 1 AND notify_email = 'daily' AND password_hash != ''")
    .all() as UserRow[];
  let sent = 0;
  for (const user of users) {
    const { date, hour } = localDateFor(user, now);
    if (hour < 8 || user.digest_sent_on === date) continue;
    db.prepare('UPDATE users SET digest_sent_on = ? WHERE id = ?').run(date, user.id);

    const rows = pendingEmailFor(db, user, now.toISOString());
    const due = db
      .prepare(
        `SELECT t.id, t.title, t.project_id, t.due_date, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.assignee_id = @viewerId AND t.status != 'done' AND t.deleted_at IS NULL AND t.due_date <= @today
            AND t.project_id IN (${WORK_PROJECT_IDS}) AND p.status IN ('active', 'on_hold')
          ORDER BY t.due_date, t.id LIMIT 30`,
      )
      .all({ ...viewerParams(user), today: date }) as { id: number; title: string; project_id: number; due_date: string; project_name: string }[];
    if (rows.length === 0 && due.length === 0) continue;

    const item = (t: (typeof due)[number]) => ({ text: t.title, url: taskUrl(appUrl, t.project_id, t.id), meta: t.project_name });
    const tr = trFor(userLanguage(user, ctx.config.defaultLanguage));
    try {
      await ctx.mailer.send({
        to: user.email,
        ...notificationsEmail(
          {
            appName: ctx.config.appName,
            appUrl,
            name: user.name,
            mode: 'daily',
            notifications: emailItems(ctx, rows, appUrl, tr),
            overdue: due.filter((t) => t.due_date < date).map(item),
            dueToday: due.filter((t) => t.due_date === date).map(item),
          },
          tr,
        ),
      });
      markEmailed(db, rows.map((r) => r.id));
      sent++;
    } catch (error) {
      console.error(`Couldn't send the daily email to ${user.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return sent;
}

/** Stops mail going out about notifications that piled up while email was off, the first time it's on. */
export function skipBacklog(ctx: AppContext): void {
  const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString();
  ctx.db.prepare('UPDATE notifications SET emailed_at = ? WHERE emailed_at IS NULL AND created_at < ?').run(nowIso(), cutoff);
}
