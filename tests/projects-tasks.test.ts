import { describe, expect, it } from 'vitest';
import type { Task } from '../src/shared/types.js';
import { addMember, makeApp, setupAdmin, type Client } from './helpers.js';

async function createProject(agent: Client, body: Record<string, unknown> = {}) {
  const res = await agent.post('/api/projects').send({ name: 'Launch', ...body }).expect(201);
  return res.body.project as { id: number; ownerId: number; color: string; counts: Record<string, number> };
}

async function createTask(agent: Client, projectId: number, body: Record<string, unknown> = {}) {
  const res = await agent.post('/api/tasks').send({ projectId, title: 'Task', ...body }).expect(201);
  return res.body.task as Task;
}

async function column(agent: Client, projectId: number, status: string) {
  const res = await agent.get(`/api/tasks?projectId=${projectId}`).expect(200);
  return (res.body.tasks as Task[]).filter((t) => t.status === status).map((t) => t.title);
}

describe('projects', () => {
  it('creates a project owned by its creator, with task counts', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const project = await createProject(admin, { description: 'Q3', startDate: '2026-06-01', dueDate: '2026-07-01' });
    expect(project).toMatchObject({ ownerId: adminUser.id, color: 'blue' });
    expect(project.counts).toEqual({ total: 0, todo: 0, in_progress: 0, review: 0, done: 0, overdue: 0 });

    await createTask(admin, project.id, { title: 'Late', dueDate: '2026-06-01' });
    await createTask(admin, project.id, { title: 'Done', status: 'done', dueDate: '2026-06-01' });
    const list = await admin.get('/api/projects').expect(200);
    expect(list.body.projects[0].counts).toMatchObject({ total: 2, todo: 1, done: 1, overdue: 1 });
  });

  it('rejects a due date before the start date', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const res = await admin
      .post('/api/projects')
      .send({ name: 'Backwards', startDate: '2026-06-10', dueDate: '2026-06-01' })
      .expect(400);
    expect(res.body.fields.dueDate).toBeDefined();
    const project = await createProject(admin, { startDate: '2026-06-10' });
    await admin.patch(`/api/projects/${project.id}`).send({ dueDate: '2026-06-01' }).expect(400);
  });

  it('only lets the owner or an admin change or delete a project', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: owner } = await addMember(t, admin, { name: 'Owner', email: 'owner@example.com' });
    const { agent: other } = await addMember(t, admin, { name: 'Other', email: 'other@example.com' });

    const project = await createProject(owner);
    await other.patch(`/api/projects/${project.id}`).send({ name: 'Hijacked' }).expect(403);
    await other.delete(`/api/projects/${project.id}`).expect(403);
    await owner.patch(`/api/projects/${project.id}`).send({ name: 'Renamed' }).expect(200);
    await admin.patch(`/api/projects/${project.id}`).send({ status: 'on_hold' }).expect(200);

    // Everyone on the team can still work on its tasks.
    await createTask(other, project.id, { title: 'Helping out' });
  });

  it('hides archived projects by default and freezes their tasks', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const task = await createTask(admin, project.id);
    await admin.patch(`/api/projects/${project.id}`).send({ status: 'archived' }).expect(200);

    expect((await admin.get('/api/projects').expect(200)).body.projects).toHaveLength(0);
    expect((await admin.get('/api/projects?includeArchived=true').expect(200)).body.projects).toHaveLength(1);
    expect((await admin.get('/api/tasks').expect(200)).body.tasks).toHaveLength(0);

    await admin.post('/api/tasks').send({ projectId: project.id, title: 'More' }).expect(400);
    await admin.patch(`/api/tasks/${task.id}`).send({ title: 'Edit' }).expect(400);
  });

  it('deletes a project together with its tasks', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const task = await createTask(admin, project.id);
    await admin.delete(`/api/projects/${project.id}`).expect(204);
    await admin.get(`/api/projects/${project.id}`).expect(404);
    await admin.get(`/api/tasks/${task.id}`).expect(404);
  });
});

describe('tasks', () => {
  it('creates tasks at the bottom of their column', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const a = await createTask(admin, project.id, { title: 'A' });
    const b = await createTask(admin, project.id, { title: 'B' });
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(await column(admin, project.id, 'todo')).toEqual(['A', 'B']);
  });

  it('moves tasks between and within columns', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const project = await createProject(admin);
    const a = await createTask(admin, project.id, { title: 'A' });
    const b = await createTask(admin, project.id, { title: 'B' });
    const c = await createTask(admin, project.id, { title: 'C' });

    // Reorder: C to the top.
    await admin.post(`/api/tasks/${c.id}/move`).send({ status: 'todo', afterId: null }).expect(200);
    expect(await column(admin, project.id, 'todo')).toEqual(['C', 'A', 'B']);

    // A to "done" sets the completion time; moving it back clears it.
    const done = await admin.post(`/api/tasks/${a.id}/move`).send({ status: 'done', afterId: null }).expect(200);
    expect(done.body.task.completedAt).toEqual(expect.any(String));
    const back = await admin.post(`/api/tasks/${a.id}/move`).send({ status: 'todo', afterId: b.id }).expect(200);
    expect(back.body.task.completedAt).toBeNull();
    expect(await column(admin, project.id, 'todo')).toEqual(['C', 'B', 'A']);
  });

  it('updates fields and keeps completion in sync with the status', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const project = await createProject(admin);
    const task = await createTask(admin, project.id);
    const res = await admin
      .patch(`/api/tasks/${task.id}`)
      .send({ status: 'done', priority: 'urgent', assigneeId: adminUser.id, startDate: '2026-06-01', dueDate: '2026-06-05' })
      .expect(200);
    expect(res.body.task).toMatchObject({
      status: 'done',
      priority: 'urgent',
      assigneeId: adminUser.id,
      startDate: '2026-06-01',
      dueDate: '2026-06-05',
    });
    expect(res.body.task.completedAt).toEqual(expect.any(String));

    await admin.patch(`/api/tasks/${task.id}`).send({ startDate: '2026-06-09' }).expect(400); // after due date
    await admin.patch(`/api/tasks/${task.id}`).send({ dueDate: '2026-02-30' }).expect(400); // not a real date
    await admin.patch(`/api/tasks/${task.id}`).send({ title: '' }).expect(400);
  });

  it('moves a task to another project', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const first = await createProject(admin, { name: 'First' });
    const second = await createProject(admin, { name: 'Second' });
    await createTask(admin, second.id, { title: 'Existing' });
    const task = await createTask(admin, first.id, { title: 'Mover' });
    const res = await admin.patch(`/api/tasks/${task.id}`).send({ projectId: second.id }).expect(200);
    expect(res.body.task).toMatchObject({ projectId: second.id, position: 1 });
  });

  it('only assigns work to active team members', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { user } = await addMember(t, admin, { name: 'Gone', email: 'gone@example.com' });
    await admin.patch(`/api/users/${user.id}`).send({ isActive: false }).expect(200);
    const project = await createProject(admin);
    await admin.post('/api/tasks').send({ projectId: project.id, title: 'X', assigneeId: user.id }).expect(400);
    await admin.post('/api/tasks').send({ projectId: project.id, title: 'X', assigneeId: 999 }).expect(400);
  });

  it('filters tasks by assignee, including "me"', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const { agent: member, user } = await addMember(t, admin, { name: 'Mia', email: 'mia@example.com' });
    const project = await createProject(admin);
    await createTask(admin, project.id, { title: 'Mine', assigneeId: adminUser.id });
    await createTask(admin, project.id, { title: 'Hers', assigneeId: user.id, status: 'in_progress' });

    const mine = await admin.get('/api/tasks?assigneeId=me').expect(200);
    expect(mine.body.tasks.map((x: Task) => x.title)).toEqual(['Mine']);
    const hers = await member.get('/api/tasks?assigneeId=me&status=in_progress,review').expect(200);
    expect(hers.body.tasks.map((x: Task) => x.title)).toEqual(['Hers']);
    await admin.get('/api/tasks?status=bogus').expect(400);
  });

  it('restricts deleting tasks to their creator, the project owner and admins', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: owner } = await addMember(t, admin, { name: 'Owner', email: 'owner@example.com' });
    const { agent: creator } = await addMember(t, admin, { name: 'Creator', email: 'creator@example.com' });
    const { agent: bystander } = await addMember(t, admin, { name: 'By', email: 'by@example.com' });
    const project = await createProject(owner);

    const t1 = await createTask(creator, project.id, { title: 'one' });
    const t2 = await createTask(creator, project.id, { title: 'two' });
    const t3 = await createTask(creator, project.id, { title: 'three' });
    await bystander.delete(`/api/tasks/${t1.id}`).expect(403);
    await creator.delete(`/api/tasks/${t1.id}`).expect(204);
    await owner.delete(`/api/tasks/${t2.id}`).expect(204);
    await admin.delete(`/api/tasks/${t3.id}`).expect(204);
  });

  it('records activity for creation, status changes and assignments', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const project = await createProject(admin);
    const task = await createTask(admin, project.id, { title: 'Tracked' });
    await admin.post(`/api/tasks/${task.id}/move`).send({ status: 'in_progress', afterId: null }).expect(200);
    await admin.patch(`/api/tasks/${task.id}`).send({ assigneeId: adminUser.id }).expect(200);
    await admin.patch(`/api/tasks/${task.id}`).send({ title: 'Tracked 2' }).expect(200);
    await admin.patch(`/api/tasks/${task.id}`).send({ priority: 'high' }).expect(200); // merges with the edit above

    const res = await admin.get(`/api/activity?taskId=${task.id}`).expect(200);
    const types = res.body.activity.map((a: { type: string }) => a.type);
    expect(types).toEqual(['task.updated', 'task.assigned', 'task.status', 'task.created']);
    expect(res.body.activity[0].data.fields.sort()).toEqual(['priority', 'title']);
    expect(res.body.activity[2].data).toMatchObject({ from: 'todo', to: 'in_progress' });
  });
});

describe('comments', () => {
  it('adds, lists, edits and deletes comments with the right permissions', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addMember(t, admin, { name: 'Mem', email: 'mem@example.com' });
    const project = await createProject(admin);
    const task = await createTask(admin, project.id);

    const c1 = (await member.post(`/api/tasks/${task.id}/comments`).send({ body: 'First!' }).expect(201)).body.comment;
    const c2 = (await admin.post(`/api/tasks/${task.id}/comments`).send({ body: 'Second' }).expect(201)).body.comment;
    await member.post(`/api/tasks/${task.id}/comments`).send({ body: '   ' }).expect(400);

    const list = await admin.get(`/api/tasks/${task.id}/comments`).expect(200);
    expect(list.body.comments.map((c: { body: string }) => c.body)).toEqual(['First!', 'Second']);
    expect((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task.commentCount).toBe(2);

    await admin.patch(`/api/comments/${c1.id}`).send({ body: 'edited by admin' }).expect(403);
    await member.patch(`/api/comments/${c1.id}`).send({ body: 'First (edited)' }).expect(200);
    await member.delete(`/api/comments/${c2.id}`).expect(403);
    await admin.delete(`/api/comments/${c1.id}`).expect(204); // admins can moderate
    await admin.delete(`/api/comments/${c2.id}`).expect(204);
  });
});
