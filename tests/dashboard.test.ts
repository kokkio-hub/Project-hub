import { describe, expect, it } from 'vitest';
import { addDays, startOfWeek, weekdayIndex, isIsoDate, addMonths } from '../src/shared/dates.js';
import { computeProjectHealth } from '../src/shared/health.js';
import type { DashboardData } from '../src/shared/types.js';
import { addMember, client, makeApp, setupAdmin, TODAY } from './helpers.js';

describe('date helpers', () => {
  it('computes weeks starting on Monday', () => {
    expect(weekdayIndex('2026-06-08')).toBe(0); // Monday
    expect(weekdayIndex('2026-06-14')).toBe(6); // Sunday
    expect(startOfWeek('2026-06-10')).toBe('2026-06-08');
    expect(startOfWeek('2026-06-14')).toBe('2026-06-08');
    expect(startOfWeek('2026-06-15')).toBe('2026-06-15');
  });

  it('adds days and months across boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('validates calendar dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-6-1')).toBe(false);
  });
});

describe('project health', () => {
  const base = { status: 'active' as const, startDate: '2026-06-01', createdAt: '2026-05-01T00:00:00Z', overdue: 0 };

  it('is off track when the due date has passed with work left', () => {
    expect(computeProjectHealth({ ...base, dueDate: '2026-06-09', total: 4, done: 3 }, TODAY).health).toBe('off_track');
  });

  it('is at risk with overdue tasks or when progress trails the schedule', () => {
    expect(computeProjectHealth({ ...base, dueDate: '2026-07-01', total: 4, done: 1, overdue: 1 }, TODAY).health).toBe('at_risk');
    // 90% of the time used, 25% of the work done.
    const behind = computeProjectHealth({ ...base, dueDate: '2026-06-11', total: 4, done: 1 }, TODAY);
    expect(behind.health).toBe('at_risk');
    expect(behind.reason).toMatch(/90% of the time used, 25% of tasks done/);
  });

  it('is on track otherwise, and completed for finished projects', () => {
    expect(computeProjectHealth({ ...base, dueDate: '2026-07-01', total: 4, done: 1 }, TODAY).health).toBe('on_track');
    expect(computeProjectHealth({ ...base, dueDate: '2026-06-01', total: 2, done: 2 }, TODAY).health).toBe('on_track');
    expect(computeProjectHealth({ ...base, status: 'completed', dueDate: null, total: 0, done: 0 }, TODAY).health).toBe(
      'completed',
    );
  });
});

describe('dashboard', () => {
  it('summarises open work, due dates, completions and workload', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const { user: member } = await addMember(t, admin, { name: 'Wes', email: 'wes@example.com' });

    const project = (await admin.post('/api/projects').send({ name: 'P', dueDate: '2026-06-30' }).expect(201)).body.project;
    const add = (body: Record<string, unknown>) =>
      admin.post('/api/tasks').send({ projectId: project.id, title: 'T', ...body }).expect(201);

    await add({ assigneeId: adminUser.id, dueDate: '2026-06-01' }); // overdue
    await add({ assigneeId: adminUser.id, dueDate: '2026-06-12', status: 'in_progress' }); // due this week
    await add({ assigneeId: member.id, dueDate: '2026-06-20', status: 'review' }); // later
    await add({ assigneeId: member.id, status: 'done' }); // completed now
    await add({}); // unassigned, no date

    // A paused project still counts; an archived one doesn't.
    const archived = (await admin.post('/api/projects').send({ name: 'Old' }).expect(201)).body.project;
    await admin.post('/api/tasks').send({ projectId: archived.id, title: 'Ignored', dueDate: '2026-01-01' }).expect(201);
    await admin.patch(`/api/projects/${archived.id}`).send({ status: 'archived' }).expect(200);

    // "Today" comes from the viewer's clock; completions are bucketed in real time, so use the real week.
    const realToday = new Date().toISOString().slice(0, 10);
    const res = await client(t.app, TODAY).get('/api/dashboard');
    expect(res.status).toBe(401); // a fresh client has no session

    const data = (await admin.set('X-Client-Date', TODAY).get('/api/dashboard').expect(200)).body as DashboardData;
    expect(data.today).toBe(TODAY);
    expect(data.stats).toMatchObject({ openTasks: 4, overdue: 1, dueThisWeek: 1, activeProjects: 1 });

    const me = data.workload.find((w) => w.userId === adminUser.id)!;
    const wes = data.workload.find((w) => w.userId === member.id)!;
    expect(me).toMatchObject({ todo: 1, in_progress: 1, review: 0, open: 2, overdue: 1, dueThisWeek: 1 });
    expect(wes).toMatchObject({ todo: 0, in_progress: 0, review: 1, open: 1, overdue: 0 });

    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]).toMatchObject({ name: 'P', total: 5, done: 1, overdue: 1, health: 'at_risk' });
    expect(data.myTasks.map((task) => task.dueDate)).toEqual(['2026-06-01', '2026-06-12']);
    expect(data.throughput).toHaveLength(8);
    expect(data.throughput[7]!.weekStart).toBe(startOfWeek(TODAY));
    expect(data.activity.length).toBeGreaterThan(0);

    // Completions land in the week they actually happened (checked against the real calendar).
    const now = (await admin.set('X-Client-Date', realToday).get('/api/dashboard').expect(200)).body as DashboardData;
    expect(now.stats.completedThisWeek).toBe(1);
    expect(now.throughput[7]!.completed).toBe(1);
  });
});
