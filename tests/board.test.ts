import { describe, expect, it } from 'vitest';
import type { Project, Task, TrashItem } from '../src/shared/types.js';
import { nextDates } from '../src/shared/recurrence.js';
import { purgeExpiredTrash } from '../src/server/services/trash.js';
import { addPerson, createProject, createTask, makeApp, setupAdmin, TODAY, type Client } from './helpers.js';

async function project(agent: Client, id: number) {
  return (await agent.get(`/api/projects/${id}`).expect(200)).body.project as Project;
}

async function tasksOf(agent: Client, projectId: number) {
  return (await agent.get(`/api/tasks?projectId=${projectId}`).expect(200)).body.tasks as Task[];
}

describe('board columns', () => {
  it('starts every project with the four standard columns', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    expect(p.columns.map((c) => [c.name, c.stage])).toEqual([
      ['To do', 'todo'],
      ['In progress', 'in_progress'],
      ['In review', 'review'],
      ['Done', 'done'],
    ]);
    const task = await createTask(admin, p.id);
    expect(task.columnId).toBe(p.columns[0]!.id);
  });

  it('adds, renames, reorders and removes columns, and tasks follow their column’s stage', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const added = (await admin.post(`/api/projects/${p.id}/columns`).send({ name: 'Blocked', stage: 'in_progress' }).expect(201)).body
      .project as Project;
    const blocked = added.columns.find((c) => c.name === 'Blocked')!;
    expect(blocked.stage).toBe('in_progress');

    const task = await createTask(admin, p.id, { columnId: blocked.id });
    expect(task).toMatchObject({ columnId: blocked.id, status: 'in_progress' });

    // Changing the column's stage moves its tasks to that stage too.
    await admin.patch(`/api/columns/${blocked.id}`).send({ name: 'Waiting', stage: 'review' }).expect(200);
    expect((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task.status).toBe('review');

    const ids = added.columns.map((c) => c.id).reverse();
    const reordered = (await admin.put(`/api/projects/${p.id}/columns/order`).send({ ids }).expect(200)).body.project as Project;
    expect(reordered.columns.map((c) => c.id)).toEqual(ids);
    await admin.put(`/api/projects/${p.id}/columns/order`).send({ ids: ids.slice(1) }).expect(400);

    // Deleting a column moves its tasks.
    const done = p.columns.find((c) => c.stage === 'done')!;
    await admin.delete(`/api/columns/${blocked.id}`).expect(400); // no moveTo
    await admin.delete(`/api/columns/${blocked.id}?moveTo=${done.id}`).expect(200);
    const moved = (await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task as Task;
    expect(moved).toMatchObject({ columnId: done.id, status: 'done' });
    expect(moved.completedAt).not.toBeNull();
  });

  it('keeps at least one finished and one unfinished column', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const [todo, progress, review, done] = p.columns;
    await admin.patch(`/api/columns/${done!.id}`).send({ stage: 'todo' }).expect(400);
    await admin.delete(`/api/columns/${done!.id}?moveTo=${todo!.id}`).expect(400);
    await admin.delete(`/api/columns/${progress!.id}?moveTo=${todo!.id}`).expect(200);
    await admin.delete(`/api/columns/${review!.id}?moveTo=${todo!.id}`).expect(200);
    await admin.delete(`/api/columns/${todo!.id}?moveTo=${done!.id}`).expect(400);
  });

  it('only lets the owner or an admin change the columns', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addPerson(t, admin, 'Mia Member');
    const p = await createProject(admin);
    await member.post(`/api/projects/${p.id}/columns`).send({ name: 'Mine', stage: 'todo' }).expect(403);
    await member.patch(`/api/columns/${p.columns[0]!.id}`).send({ name: 'Renamed' }).expect(403);
  });

  it('moves cards into a custom column by id, and still accepts a stage', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const extra = ((await admin.post(`/api/projects/${p.id}/columns`).send({ name: 'QA', stage: 'review' }).expect(201)).body.project as Project)
      .columns.find((c) => c.name === 'QA')!;
    const a = await createTask(admin, p.id, { title: 'A' });
    const moved = (await admin.post(`/api/tasks/${a.id}/move`).send({ columnId: extra.id, afterId: null }).expect(200)).body.task;
    expect(moved).toMatchObject({ columnId: extra.id, status: 'review' });
    const back = (await admin.post(`/api/tasks/${a.id}/move`).send({ status: 'todo', afterId: null }).expect(200)).body.task;
    expect(back.columnId).toBe(p.columns[0]!.id);
    // A column from another project is refused.
    const other = await createProject(admin, { name: 'Other' });
    await admin.post(`/api/tasks/${a.id}/move`).send({ columnId: other.columns[0]!.id, afterId: null }).expect(400);
  });
});

describe('labels', () => {
  it('creates labels, puts them on tasks and filters out labels from other projects', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const bug = (await admin.post(`/api/projects/${p.id}/labels`).send({ name: 'Bug', color: 'red' }).expect(201)).body.label;
    await admin.post(`/api/projects/${p.id}/labels`).send({ name: 'bug' }).expect(400); // same name
    const task = await createTask(admin, p.id, { labelIds: [bug.id] });
    expect(task.labelIds).toEqual([bug.id]);
    expect((await project(admin, p.id)).labels.map((l) => l.name)).toEqual(['Bug']);

    const other = await createProject(admin, { name: 'Other' });
    const foreign = (await admin.post(`/api/projects/${other.id}/labels`).send({ name: 'Elsewhere' }).expect(201)).body.label;
    await admin.patch(`/api/tasks/${task.id}`).send({ labelIds: [foreign.id] }).expect(400);

    await admin.patch(`/api/labels/${bug.id}`).send({ name: 'Defect', color: 'orange' }).expect(200);
    await admin.delete(`/api/labels/${bug.id}`).expect(204);
    expect((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task.labelIds).toEqual([]);
  });

  it('keeps labels with the same name when a task moves to another project', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const a = await createProject(admin, { name: 'A' });
    const b = await createProject(admin, { name: 'B' });
    const designA = (await admin.post(`/api/projects/${a.id}/labels`).send({ name: 'Design' }).expect(201)).body.label;
    const onlyA = (await admin.post(`/api/projects/${a.id}/labels`).send({ name: 'Only here' }).expect(201)).body.label;
    const designB = (await admin.post(`/api/projects/${b.id}/labels`).send({ name: 'design' }).expect(201)).body.label;
    const task = await createTask(admin, a.id, { labelIds: [designA.id, onlyA.id] });
    const moved = (await admin.patch(`/api/tasks/${task.id}`).send({ projectId: b.id }).expect(200)).body.task as Task;
    expect(moved.labelIds).toEqual([designB.id]);
    expect(moved.columnId).toBe(b.columns[0]!.id);
  });
});

describe('checklists', () => {
  it('adds, ticks, reorders and removes items, with counts on the task', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const task = await createTask(admin, p.id);
    const one = (await admin.post(`/api/tasks/${task.id}/checklist`).send({ body: 'One' }).expect(201)).body.item;
    const two = (await admin.post(`/api/tasks/${task.id}/checklist`).send({ body: 'Two' }).expect(201)).body.item;
    await admin.post(`/api/tasks/${task.id}/checklist`).send({ body: '  ' }).expect(400);

    const ticked = (await admin.patch(`/api/checklist/${one.id}`).send({ done: true }).expect(200)).body.item;
    expect(ticked.done).toBe(true);
    expect(ticked.completedAt).not.toBeNull();
    expect((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task).toMatchObject({ checklistTotal: 2, checklistDone: 1 });

    const order = (await admin.put(`/api/tasks/${task.id}/checklist/order`).send({ ids: [two.id, one.id] }).expect(200)).body.items;
    expect(order.map((i: { body: string }) => i.body)).toEqual(['Two', 'One']);
    await admin.delete(`/api/checklist/${two.id}`).expect(204);
    expect((await admin.get(`/api/tasks/${task.id}/checklist`).expect(200)).body.items).toHaveLength(1);
  });
});

describe('dependencies', () => {
  it('records what a task waits for, refuses loops and counts open blockers', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const design = await createTask(admin, p.id, { title: 'Design' });
    const build = await createTask(admin, p.id, { title: 'Build' });
    const launch = await createTask(admin, p.id, { title: 'Launch' });

    await admin.post(`/api/tasks/${build.id}/blockers`).send({ blockerId: design.id }).expect(201);
    const deps = (await admin.post(`/api/tasks/${launch.id}/blockers`).send({ blockerId: build.id }).expect(201)).body;
    expect(deps.blockedBy.map((d: Task) => d.title)).toEqual(['Build']);

    // Design → Build → Launch: Launch can't also block Design.
    await admin.post(`/api/tasks/${design.id}/blockers`).send({ blockerId: launch.id }).expect(400);
    await admin.post(`/api/tasks/${design.id}/blockers`).send({ blockerId: design.id }).expect(400);

    expect((await admin.get(`/api/tasks/${build.id}`).expect(200)).body.task).toMatchObject({
      blockedByIds: [design.id],
      openBlockerCount: 1,
    });
    await admin.patch(`/api/tasks/${design.id}`).send({ status: 'done' }).expect(200);
    expect((await admin.get(`/api/tasks/${build.id}`).expect(200)).body.task.openBlockerCount).toBe(0);

    const blocking = (await admin.get(`/api/tasks/${design.id}/dependencies`).expect(200)).body.blocking;
    expect(blocking.map((d: Task) => d.title)).toEqual(['Build']);
    await admin.delete(`/api/tasks/${build.id}/blockers/${design.id}`).expect(200);
    await admin.delete(`/api/tasks/${build.id}/blockers/${design.id}`).expect(404);
  });
});

describe('repeating tasks', () => {
  it('works out the next dates from the due date, skipping repeats in the past', () => {
    expect(nextDates({ startDate: null, dueDate: '2026-06-10' }, { freq: 'weekly', interval: 1 }, '2026-06-10')).toEqual({
      startDate: null,
      dueDate: '2026-06-17',
    });
    expect(nextDates({ startDate: '2026-06-08', dueDate: '2026-06-10' }, { freq: 'weekly', interval: 2 }, '2026-06-01')).toEqual({
      startDate: '2026-06-22',
      dueDate: '2026-06-24',
    });
    // Finished three weeks late: the next one is the first repeat from today on.
    expect(nextDates({ startDate: null, dueDate: '2026-05-01' }, { freq: 'weekly', interval: 1 }, '2026-05-25').dueDate).toBe('2026-05-29');
    expect(nextDates({ startDate: null, dueDate: '2026-01-31' }, { freq: 'monthly', interval: 1 }, '2026-01-01').dueDate).toBe('2026-02-28');
    expect(nextDates({ startDate: null, dueDate: null }, { freq: 'daily', interval: 3 }, '2026-06-10').dueDate).toBe('2026-06-13');
  });

  it('creates the next copy when a repeating task is finished, only once', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const p = await createProject(admin);
    const label = (await admin.post(`/api/projects/${p.id}/labels`).send({ name: 'Ops' }).expect(201)).body.label;
    const task = await createTask(admin, p.id, {
      title: 'Weekly report',
      dueDate: '2026-06-12',
      assigneeId: adminUser.id,
      labelIds: [label.id],
      recurrence: { freq: 'weekly', interval: 1 },
    });
    await admin.post(`/api/tasks/${task.id}/checklist`).send({ body: 'Numbers' }).expect(201);
    await admin.post(`/api/tasks/${task.id}/checklist`).send({ body: 'Highlights' }).expect(201);

    const res = await admin.patch(`/api/tasks/${task.id}`).send({ status: 'done' }).expect(200);
    const next = res.body.next as Task;
    expect(next).toMatchObject({
      title: 'Weekly report',
      dueDate: '2026-06-19',
      status: 'todo',
      assigneeId: adminUser.id,
      labelIds: [label.id],
      checklistTotal: 2,
      checklistDone: 0,
      recurrence: { freq: 'weekly', interval: 1 },
    });

    // Reopening and finishing again doesn't make another copy.
    await admin.patch(`/api/tasks/${task.id}`).send({ status: 'todo' }).expect(200);
    const again = await admin.post(`/api/tasks/${task.id}/move`).send({ status: 'done', afterId: null }).expect(200);
    expect(again.body.next).toBeUndefined();
    expect((await tasksOf(admin, p.id)).filter((x) => x.title === 'Weekly report')).toHaveLength(2);
  });
});

describe('templates and copies', () => {
  it('keeps templates out of normal lists and starts new projects from them', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const template = await createProject(admin, { name: 'Client site', isTemplate: true, startDate: '2026-01-05', dueDate: '2026-01-30' });
    const label = (await admin.post(`/api/projects/${template.id}/labels`).send({ name: 'Design' }).expect(201)).body.label;
    const kickoff = await createTask(admin, template.id, { title: 'Kick-off', dueDate: '2026-01-05', assigneeId: adminUser.id });
    const design = await createTask(admin, template.id, {
      title: 'Design',
      startDate: '2026-01-06',
      dueDate: '2026-01-16',
      labelIds: [label.id],
      status: 'done',
    });
    await admin.post(`/api/tasks/${design.id}/blockers`).send({ blockerId: kickoff.id }).expect(201);
    await admin.post(`/api/tasks/${design.id}/checklist`).send({ body: 'Moodboard', done: true }).expect(201);

    expect((await admin.get('/api/projects').expect(200)).body.projects).toHaveLength(0);
    expect((await admin.get('/api/projects?templates=only').expect(200)).body.projects.map((p: Project) => p.name)).toEqual(['Client site']);
    expect((await admin.get('/api/tasks').expect(200)).body.tasks).toHaveLength(0); // template work isn't work
    expect((await admin.get('/api/dashboard').expect(200)).body.stats.openTasks).toBe(0);

    const created = (
      await admin.post('/api/projects').send({ name: 'Bakery website', fromTemplateId: template.id, startDate: '2026-07-06' }).expect(201)
    ).body.project as Project;
    expect(created).toMatchObject({ isTemplate: false, startDate: '2026-07-06', dueDate: '2026-07-31' });
    expect(created.labels.map((l) => l.name)).toEqual(['Design']);
    const copied = await tasksOf(admin, created.id);
    expect(copied.map((x) => [x.title, x.status, x.startDate, x.dueDate, x.assigneeId])).toEqual([
      ['Kick-off', 'todo', null, '2026-07-06', null],
      ['Design', 'todo', '2026-07-07', '2026-07-17', null],
    ]);
    const copiedDesign = copied.find((x) => x.title === 'Design')!;
    expect(copiedDesign.blockedByIds).toEqual([copied.find((x) => x.title === 'Kick-off')!.id]);
    expect(copiedDesign).toMatchObject({ checklistTotal: 1, checklistDone: 0, labelIds: [created.labels[0]!.id] });
  });

  it('duplicates a project with its progress, or saves it as a template', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const p = await createProject(admin, { name: 'Original' });
    await createTask(admin, p.id, { title: 'Done already', status: 'done', assigneeId: adminUser.id });
    const copy = (await admin.post(`/api/projects/${p.id}/duplicate`).send({ name: 'Copy' }).expect(201)).body.project as Project;
    expect((await tasksOf(admin, copy.id)).map((x) => [x.title, x.status, x.assigneeId])).toEqual([['Done already', 'done', adminUser.id]]);

    const asTemplate = (await admin.post(`/api/projects/${p.id}/duplicate`).send({ name: 'Tpl', asTemplate: true, resetProgress: true }).expect(201))
      .body.project as Project;
    expect(asTemplate.isTemplate).toBe(true);
    expect((await tasksOf(admin, asTemplate.id))[0]!.status).toBe('todo');
  });
});

describe('trash', () => {
  it('keeps deleted tasks in the trash until restored', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const task = await createTask(admin, p.id, { title: 'Oops' });
    await admin.delete(`/api/tasks/${task.id}`).expect(204);
    await admin.get(`/api/tasks/${task.id}`).expect(404);
    expect(await tasksOf(admin, p.id)).toHaveLength(0);
    expect((await project(admin, p.id)).counts.total).toBe(0);

    const trash = (await admin.get('/api/trash').expect(200)).body.items as TrashItem[];
    expect(trash).toMatchObject([{ kind: 'task', id: task.id, title: 'Oops', projectName: 'Launch', canRestore: true }]);
    const restored = (await admin.post(`/api/trash/tasks/${task.id}/restore`).expect(200)).body.task;
    expect(restored.title).toBe('Oops');
    expect(await tasksOf(admin, p.id)).toHaveLength(1);
  });

  it('restores a deleted project with its tasks', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addPerson(t, admin, 'Mia Member');
    const p = await createProject(admin);
    await createTask(admin, p.id);
    await admin.delete(`/api/projects/${p.id}`).expect(204);
    await admin.get(`/api/projects/${p.id}`).expect(404);
    expect((await admin.get('/api/tasks').expect(200)).body.tasks).toHaveLength(0);

    const items = (await member.get('/api/trash').expect(200)).body.items as TrashItem[];
    expect(items).toMatchObject([{ kind: 'project', canRestore: false }]);
    await member.post(`/api/trash/projects/${p.id}/restore`).expect(403);
    await admin.post(`/api/trash/projects/${p.id}/restore`).expect(204);
    expect(await tasksOf(admin, p.id)).toHaveLength(1);
  });

  it('empties itself after 30 days, and admins can delete for good', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin);
    const old = await createTask(admin, p.id, { title: 'Old' });
    const recent = await createTask(admin, p.id, { title: 'Recent' });
    await admin.delete(`/api/tasks/${old.id}`).expect(204);
    await admin.delete(`/api/tasks/${recent.id}`).expect(204);
    t.db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', old.id);
    expect(purgeExpiredTrash(t.ctx)).toEqual({ tasks: 1, projects: 0 });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 });

    const { agent: member } = await addPerson(t, admin, 'Mia Member');
    await member.delete(`/api/trash/tasks/${recent.id}`).expect(403);
    await admin.delete(`/api/trash/tasks/${recent.id}`).expect(204);
    expect((await admin.get('/api/trash').expect(200)).body.items).toHaveLength(0);
  });
});

describe('export', () => {
  it('exports a project as CSV that spreadsheets open safely', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const p = await createProject(admin, { name: 'Report' });
    await createTask(admin, p.id, { title: '=HYPERLINK("http://evil")', description: 'Line one\nline "two"', dueDate: TODAY });
    const res = await admin.get(`/api/projects/${p.id}/export.csv`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text;
    expect(text.startsWith('﻿ID,Title,Column')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain('"Line one\nline ""two"""');
    expect((await admin.get('/api/export/tasks.csv').expect(200)).text).toContain('Report');
  });
});
