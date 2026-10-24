import { describe, expect, it } from 'vitest';
import type { Project, SavedView, Task } from '../src/shared/types.js';
import { addPerson, createProject, createTask, makeApp, setupAdmin } from './helpers.js';

describe('subtasks', () => {
  it('adds subtasks under a task and counts how many are done', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const parent = await createTask(admin, project.id, { title: 'Launch page' });
    const a = await createTask(admin, project.id, { title: 'Copy', parentId: parent.id });
    await createTask(admin, project.id, { title: 'Images', parentId: parent.id });
    expect(a.parentId).toBe(parent.id);

    const done = project.columns.find((c) => c.stage === 'done')!;
    await admin.post(`/api/tasks/${a.id}/move`).send({ columnId: done.id, afterId: null }).expect(200);
    const fresh = (await admin.get(`/api/tasks/${parent.id}`).expect(200)).body.task as Task;
    expect(fresh.subtaskTotal).toBe(2);
    expect(fresh.subtaskDone).toBe(1);
  });

  it('keeps subtasks one level deep and inside the same project', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const other = await createProject(admin, { name: 'Other' });
    const parent = await createTask(admin, project.id);
    const child = await createTask(admin, project.id, { parentId: parent.id });

    const nested = await admin.post('/api/tasks').send({ projectId: project.id, title: 'Deep', parentId: child.id }).expect(400);
    expect(nested.body.fields.parentId).toBe('Choose a main task');
    await admin.post('/api/tasks').send({ projectId: other.id, title: 'Elsewhere', parentId: parent.id }).expect(400);
    const self = await admin.patch(`/api/tasks/${parent.id}`).send({ parentId: parent.id }).expect(400);
    expect(self.body.fields.parentId).toBe('Choose another task');
    const another = await createTask(admin, project.id);
    const loop = await admin.patch(`/api/tasks/${parent.id}`).send({ parentId: another.id }).expect(400);
    expect(loop.body.fields.parentId).toBe('Has subtasks');

    // Turning a subtask back into a normal task.
    const freed = await admin.patch(`/api/tasks/${child.id}`).send({ parentId: null }).expect(200);
    expect((freed.body.task as Task).parentId).toBeNull();
  });

  it('moves subtasks to the trash with their task, and brings them back together', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const parent = await createTask(admin, project.id);
    const child = await createTask(admin, project.id, { parentId: parent.id });

    await admin.delete(`/api/tasks/${parent.id}`).expect(204);
    await admin.get(`/api/tasks/${child.id}`).expect(404);
    await admin.post(`/api/trash/tasks/${parent.id}/restore`).expect(200);
    const back = (await admin.get(`/api/tasks/${child.id}`).expect(200)).body.task as Task;
    expect(back.parentId).toBe(parent.id);
  });

  it('turns a checklist item into a subtask', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const parent = await createTask(admin, project.id);
    const item = await admin.post(`/api/tasks/${parent.id}/checklist`).send({ body: 'Call the printer' }).expect(201);
    const itemId = (item.body.item ?? item.body.items?.at(-1)).id as number;

    const res = await admin.post(`/api/checklist/${itemId}/subtask`).expect(201);
    const subtask = res.body.task as Task;
    expect(subtask.title).toBe('Call the printer');
    expect(subtask.parentId).toBe(parent.id);
    const list = (await admin.get(`/api/tasks/${parent.id}/checklist`).expect(200)).body.items as unknown[];
    expect(list).toHaveLength(0);
  });

  it('copies subtasks with a repeating task', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const parent = await createTask(admin, project.id, { dueDate: '2026-06-10', recurrence: { freq: 'weekly', interval: 1 } });
    await createTask(admin, project.id, { title: 'Step', parentId: parent.id, dueDate: '2026-06-09' });
    const done = project.columns.find((c) => c.stage === 'done')!;
    const moved = await admin.post(`/api/tasks/${parent.id}/move`).send({ columnId: done.id, afterId: null }).expect(200);
    const next = moved.body.next as Task | undefined;
    expect(next).toBeTruthy();
    const tasks = (await admin.get(`/api/tasks?projectId=${project.id}`).expect(200)).body.tasks as Task[];
    const copied = tasks.filter((x) => x.parentId === next!.id);
    expect(copied.map((x) => [x.title, x.dueDate])).toEqual([['Step', '2026-06-16']]);
  });
});

describe('milestones', () => {
  it('creates milestones, links tasks to them and counts progress', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const created = await admin.post(`/api/projects/${project.id}/milestones`).send({ name: 'Beta', date: '2026-07-01' }).expect(201);
    const milestoneId = created.body.milestoneId as number;
    expect((created.body.project as Project).milestones.map((m) => m.name)).toEqual(['Beta']);

    const task = await createTask(admin, project.id, { milestoneId });
    expect(task.milestoneId).toBe(milestoneId);
    const done = project.columns.find((c) => c.stage === 'done')!;
    await createTask(admin, project.id, { milestoneId, columnId: done.id });
    const fresh = (await admin.get(`/api/projects/${project.id}`).expect(200)).body.project as Project;
    expect(fresh.milestones[0]).toMatchObject({ taskCount: 2, doneCount: 1, reachedAt: null });

    const reached = await admin.patch(`/api/milestones/${milestoneId}`).send({ reached: true }).expect(200);
    expect((reached.body.project as Project).milestones[0]!.reachedAt).not.toBeNull();

    await admin.delete(`/api/milestones/${milestoneId}`).expect(200);
    expect(((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task as Task).milestoneId).toBeNull();
  });

  it('only accepts milestones of the task’s own project', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const other = await createProject(admin, { name: 'Other' });
    const { body } = await admin.post(`/api/projects/${other.id}/milestones`).send({ name: 'Elsewhere', date: '2026-07-01' }).expect(201);
    const res = await admin.post('/api/tasks').send({ projectId: project.id, title: 'X', milestoneId: body.milestoneId }).expect(400);
    expect(res.body.fields.milestoneId).toBe('Unknown milestone');
  });

  it('doesn’t let guests change milestones', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const { agent: guest, user } = await addPerson(t, admin, 'Gus Guest', 'guest');
    await admin.put(`/api/projects/${project.id}/members`).send({ userIds: [user.id] }).expect(200);
    await guest.post(`/api/projects/${project.id}/milestones`).send({ name: 'Beta', date: '2026-07-01' }).expect(403);
  });
});

describe('custom fields', () => {
  it('adds fields and stores checked values on tasks', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const points = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'Story points', type: 'number' }).expect(201)).body.field;
    const client = (
      await admin
        .post(`/api/projects/${project.id}/fields`)
        .send({ name: 'Client', type: 'select', options: [{ name: 'Acme', color: 'red' }, { name: 'Globex' }], showOnCard: true })
        .expect(201)
    ).body.field;
    expect(client.options).toHaveLength(2);
    const acme = client.options[0].id as string;

    const task = await createTask(admin, project.id, { fields: { [points.id]: '3,5', [client.id]: acme } });
    expect(task.fieldValues).toEqual({ [points.id]: '3.5', [client.id]: acme });

    const bad = await admin.patch(`/api/tasks/${task.id}`).send({ fields: { [points.id]: 'lots' } }).expect(400);
    expect(bad.body.error).toBe('Story points: Enter a number');
    expect(bad.body.fields[`fields.${points.id}`]).toBe('Enter a number');
    await admin.patch(`/api/tasks/${task.id}`).send({ fields: { [client.id]: 'nope' } }).expect(400);

    // Clearing a value, and dropping a choice clears the tasks that had it.
    const cleared = await admin.patch(`/api/tasks/${task.id}`).send({ fields: { [points.id]: null } }).expect(200);
    expect((cleared.body.task as Task).fieldValues).toEqual({ [client.id]: acme });
    await admin.patch(`/api/fields/${client.id}`).send({ options: [client.options[1]] }).expect(200);
    expect(((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task as Task).fieldValues).toEqual({});
  });

  it('translates field problems', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const points = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'Story points', type: 'number' }).expect(201)).body.field;
    const task = await createTask(admin, project.id);
    const bad = await admin.patch(`/api/tasks/${task.id}`).set('X-Client-Lang', 'nl').send({ fields: { [points.id]: 'veel' } }).expect(400);
    expect(bad.body.error).toBe('Story points: Vul een getal in');
  });

  it('rejects fields of another project, duplicate names and empty dropdowns', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const other = await createProject(admin, { name: 'Other' });
    const foreign = (await admin.post(`/api/projects/${other.id}/fields`).send({ name: 'Size', type: 'text' }).expect(201)).body.field;
    await admin.post('/api/tasks').send({ projectId: project.id, title: 'X', fields: { [foreign.id]: 'L' } }).expect(400);
    await admin.post(`/api/projects/${other.id}/fields`).send({ name: 'size', type: 'text' }).expect(400);
    const empty = await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'Team', type: 'select' }).expect(400);
    expect(empty.body.fields.options).toBe('Add a choice');
  });

  it('lets only the owner or an admin change the fields, but anyone working on tasks fill them in', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const field = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'Size', type: 'text' }).expect(201)).body.field;
    const { agent: member } = await addPerson(t, admin, 'Mia Member');
    const denied = await member.post(`/api/projects/${project.id}/fields`).send({ name: 'Other', type: 'text' }).expect(403);
    expect(denied.body.error).toBe('Only the project owner or an admin can change the custom fields.');
    await member.patch(`/api/fields/${field.id}`).send({ name: 'Bigness' }).expect(403);
    const task = await createTask(member, project.id, { fields: { [field.id]: 'L' } });
    expect(task.fieldValues[field.id]).toBe('L');
  });

  it('reorders fields', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const a = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'A', type: 'text' }).expect(201)).body.field;
    const b = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'B', type: 'checkbox' }).expect(201)).body.field;
    const res = await admin.put(`/api/projects/${project.id}/fields/order`).send({ ids: [b.id, a.id] }).expect(200);
    expect((res.body.project as Project).fields.map((f) => f.name)).toEqual(['B', 'A']);
    await admin.put(`/api/projects/${project.id}/fields/order`).send({ ids: [b.id] }).expect(400);
  });

  it('exports fields, milestones and parent tasks in the CSV', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const field = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'Client', type: 'select', options: [{ name: 'Acme' }] }).expect(201)).body.field;
    const { body } = await admin.post(`/api/projects/${project.id}/milestones`).send({ name: 'Beta', date: '2026-07-01' }).expect(201);
    const parent = await createTask(admin, project.id, { title: 'Main', milestoneId: body.milestoneId, fields: { [field.id]: field.options[0].id } });
    await createTask(admin, project.id, { title: 'Child', parentId: parent.id });

    const csv = (await admin.get(`/api/projects/${project.id}/export.csv`).expect(200)).text;
    const [header, ...rows] = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(header).toContain('Parent task,Milestone,Client,Description');
    expect(rows.find((r) => r.includes('Main'))).toContain(',Beta,Acme,');
    expect(rows.find((r) => r.includes('Child'))).toContain(`,${parent.id},,,`);

    const all = (await admin.get('/api/export/tasks.csv').expect(200)).text;
    expect(all).toContain('Custom fields');
    expect(all).toContain('Client: Acme');
  });
});

describe('copying a project with planning data', () => {
  it('brings milestones, fields, values and subtasks along', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin, { startDate: '2026-06-01' });
    const field = (await admin.post(`/api/projects/${project.id}/fields`).send({ name: 'Size', type: 'text' }).expect(201)).body.field;
    const { body } = await admin.post(`/api/projects/${project.id}/milestones`).send({ name: 'Beta', date: '2026-06-20' }).expect(201);
    const parent = await createTask(admin, project.id, { title: 'Main', milestoneId: body.milestoneId, fields: { [field.id]: 'L' } });
    await createTask(admin, project.id, { title: 'Child', parentId: parent.id });

    const copy = (await admin.post(`/api/projects/${project.id}/duplicate`).send({ name: 'Copy', startDate: '2026-07-01' }).expect(201)).body.project as Project;
    expect(copy.milestones.map((m) => [m.name, m.date])).toEqual([['Beta', '2026-07-20']]);
    expect(copy.fields.map((f) => f.name)).toEqual(['Size']);
    const tasks = (await admin.get(`/api/tasks?projectId=${copy.id}`).expect(200)).body.tasks as Task[];
    const main = tasks.find((x) => x.title === 'Main')!;
    expect(main.milestoneId).toBe(copy.milestones[0]!.id);
    expect(main.fieldValues).toEqual({ [copy.fields[0]!.id]: 'L' });
    expect(tasks.find((x) => x.title === 'Child')!.parentId).toBe(main.id);
  });
});

describe('saved views', () => {
  it('saves, renames, reorders and deletes personal views', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const a = (await admin.post(`/api/projects/${project.id}/views`).send({ name: 'My urgent', view: 'board', settings: { priority: 'urgent', groupBy: 'assignee', junk: 1 } }).expect(201)).body.view as SavedView;
    expect(a.settings).toEqual({ priority: 'urgent', groupBy: 'assignee' });
    const b = (await admin.post(`/api/projects/${project.id}/views`).send({ name: 'Calendar', view: 'calendar' }).expect(201)).body.view as SavedView;

    await admin.patch(`/api/views/${a.id}`).send({ name: 'Urgent' }).expect(200);
    const order = await admin.put('/api/views/order').send({ ids: [b.id, a.id] }).expect(200);
    expect((order.body.views as SavedView[]).map((v) => v.name)).toEqual(['Calendar', 'Urgent']);
    await admin.delete(`/api/views/${b.id}`).expect(204);
    expect(((await admin.get('/api/views').expect(200)).body.views as SavedView[]).map((v) => v.id)).toEqual([a.id]);

    await admin.post(`/api/projects/${project.id}/views`).send({ name: 'Bad', view: 'board', settings: { groupBy: 'colour' } }).expect(400);
  });

  it('keeps views private to the person who saved them (guests can save their own)', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const view = (await admin.post(`/api/projects/${project.id}/views`).send({ name: 'Mine', view: 'list' }).expect(201)).body.view as SavedView;
    const { agent: guest, user } = await addPerson(t, admin, 'Gus Guest', 'guest');
    await admin.put(`/api/projects/${project.id}/members`).send({ userIds: [user.id] }).expect(200);
    expect((await guest.get('/api/views').expect(200)).body.views).toEqual([]);
    await guest.patch(`/api/views/${view.id}`).send({ name: 'Taken' }).expect(404);
    await guest.delete(`/api/views/${view.id}`).expect(404);
    await guest.put('/api/views/order').send({ ids: [view.id] }).expect(403);
    await guest.post(`/api/projects/${project.id}/views`).send({ name: 'Guest view', view: 'board' }).expect(201);
  });

  it('hides views of projects the person can no longer see', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    await admin.post(`/api/projects/${project.id}/views`).send({ name: 'Soon gone', view: 'board' }).expect(201);
    await admin.delete(`/api/projects/${project.id}`).expect(204);
    expect((await admin.get('/api/views').expect(200)).body.views).toEqual([]);
  });
});
