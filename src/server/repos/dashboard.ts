import type { DB } from '../db/index.js';
import { addDays, startOfWeek } from '../../shared/dates.js';
import { computeProjectHealth } from '../../shared/health.js';
import type { DashboardData, DashboardProject, ProjectHealth, ThroughputWeek, WorkloadRow } from '../../shared/types.js';
import { viewerParams, WORK_PROJECT_IDS, type Viewer } from '../services/permissions.js';
import { listActivity } from './activity.js';
import { listProjects } from './projects.js';
import { listOpenTasksFor } from './tasks.js';
import { listUsersFor } from './users.js';

const THROUGHPUT_WEEKS = 8;

/** "Open work" metrics only count projects the viewer can see that are running or paused (not templates). */
const LIVE_PROJECTS = `SELECT id FROM projects WHERE status IN ('active', 'on_hold') AND id IN (${WORK_PROJECT_IDS})`;

/** Finished work counts in every visible project that isn't archived (or a template). */
const COUNTED_PROJECTS = `SELECT id FROM projects WHERE status != 'archived' AND id IN (${WORK_PROJECT_IDS})`;

const HEALTH_ORDER: Record<ProjectHealth, number> = { off_track: 0, at_risk: 1, on_track: 2, completed: 3 };

/**
 * Builds the dashboard for one user.
 * @param today the viewer's local date (YYYY-MM-DD)
 * @param tzOffsetMinutes the viewer's offset from UTC, used to bucket completion timestamps into local days
 */
export function buildDashboard(db: DB, viewer: Viewer, today: string, tzOffsetMinutes: number): DashboardData {
  const vp = viewerParams(viewer);
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const lastWeekStart = addDays(weekStart, -7);
  const rangeStart = addDays(weekStart, -7 * (THROUGHPUT_WEEKS - 1));
  const tz = `${tzOffsetMinutes >= 0 ? '+' : ''}${tzOffsetMinutes} minutes`;

  const open = db
    .prepare(
      `SELECT COALESCE(SUM(t.status != 'done'), 0)                                                    AS open_tasks,
              COALESCE(SUM(t.status != 'done' AND t.due_date < @today), 0)                           AS overdue,
              COALESCE(SUM(t.status != 'done' AND t.due_date >= @today AND t.due_date <= @weekEnd), 0) AS due_this_week
         FROM tasks t
        WHERE t.deleted_at IS NULL AND t.project_id IN (${LIVE_PROJECTS})`,
    )
    .get({ ...vp, today, weekEnd }) as { open_tasks: number; overdue: number; due_this_week: number };

  const completed = db
    .prepare(
      `SELECT COALESCE(SUM(date(t.completed_at, @tz) >= @weekStart), 0) AS this_week,
              COALESCE(SUM(date(t.completed_at, @tz) >= @lastWeekStart AND date(t.completed_at, @tz) < @weekStart), 0) AS last_week
         FROM tasks t
        WHERE t.status = 'done' AND t.completed_at IS NOT NULL AND t.deleted_at IS NULL
          AND t.project_id IN (${COUNTED_PROJECTS})`,
    )
    .get({ ...vp, tz, weekStart, lastWeekStart }) as { this_week: number; last_week: number };

  const projects = listProjects(db, viewer, { today });
  const activeProjects = projects.filter((p) => p.status === 'active').length;

  const dashboardProjects: DashboardProject[] = projects
    .filter((p) => p.status === 'active' || p.status === 'on_hold')
    .map((p) => {
      const { health, reason, progress } = computeProjectHealth(
        {
          status: p.status,
          startDate: p.startDate,
          dueDate: p.dueDate,
          createdAt: p.createdAt,
          total: p.counts.total,
          done: p.counts.done,
          overdue: p.counts.overdue,
        },
        today,
      );
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        status: p.status,
        dueDate: p.dueDate,
        total: p.counts.total,
        done: p.counts.done,
        overdue: p.counts.overdue,
        progress,
        health,
        healthReason: reason,
      };
    })
    .sort(
      (a, b) =>
        HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.name.localeCompare(b.name),
    );

  const visibleUsers = new Set(viewer.role === 'guest' ? listUsersFor(db, viewer).map((u) => u.id) : []);
  const workload = (
    db
      .prepare(
        `SELECT u.id AS userId,
                COALESCE(SUM(t.status = 'todo'), 0)                                        AS todo,
                COALESCE(SUM(t.status = 'in_progress'), 0)                                 AS in_progress,
                COALESCE(SUM(t.status = 'review'), 0)                                      AS review,
                COALESCE(SUM(t.due_date < @today), 0)                                      AS overdue,
                COALESCE(SUM(t.due_date >= @today AND t.due_date <= @weekEnd), 0)          AS dueThisWeek
           FROM users u
           LEFT JOIN tasks t
                  ON t.assignee_id = u.id AND t.status != 'done' AND t.deleted_at IS NULL AND t.project_id IN (${LIVE_PROJECTS})
          WHERE u.is_active = 1 AND u.role != 'guest'
          GROUP BY u.id`,
      )
      .all({ ...vp, today, weekEnd }) as Omit<WorkloadRow, 'open'>[]
  )
    .filter((row) => viewer.role !== 'guest' || visibleUsers.has(row.userId))
    .map((row) => ({ ...row, open: row.todo + row.in_progress + row.review }))
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.userId - b.userId);

  const completedByWeek = new Map(
    (
      db
        .prepare(
          `SELECT date(date(t.completed_at, @tz), '-6 days', 'weekday 1') AS week, COUNT(*) AS n
             FROM tasks t
            WHERE t.status = 'done' AND t.completed_at IS NOT NULL AND t.deleted_at IS NULL
              AND date(t.completed_at, @tz) >= @rangeStart
              AND t.project_id IN (${COUNTED_PROJECTS})
            GROUP BY week`,
        )
        .all({ ...vp, tz, rangeStart }) as { week: string; n: number }[]
    ).map((r) => [r.week, r.n]),
  );
  const createdByWeek = new Map(
    (
      db
        .prepare(
          `SELECT date(date(t.created_at, @tz), '-6 days', 'weekday 1') AS week, COUNT(*) AS n
             FROM tasks t
            WHERE date(t.created_at, @tz) >= @rangeStart AND t.deleted_at IS NULL
              AND t.project_id IN (${COUNTED_PROJECTS})
            GROUP BY week`,
        )
        .all({ ...vp, tz, rangeStart }) as { week: string; n: number }[]
    ).map((r) => [r.week, r.n]),
  );
  const throughput: ThroughputWeek[] = [];
  for (let i = 0; i < THROUGHPUT_WEEKS; i++) {
    const week = addDays(rangeStart, i * 7);
    throughput.push({ weekStart: week, completed: completedByWeek.get(week) ?? 0, created: createdByWeek.get(week) ?? 0 });
  }

  return {
    today,
    stats: {
      openTasks: open.open_tasks,
      dueThisWeek: open.due_this_week,
      overdue: open.overdue,
      completedThisWeek: completed.this_week,
      completedLastWeek: completed.last_week,
      activeProjects,
    },
    projects: dashboardProjects,
    workload,
    throughput,
    myTasks: listOpenTasksFor(db, viewer, 8),
    activity: listActivity(db, viewer, { limit: 15, excludeArchived: true }),
  };
}
