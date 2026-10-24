import { describe, expect, it } from 'vitest';
import type { Project, SearchResults, Task, User } from '../src/shared/types.js';
import { addPerson, createProject, createTask, makeApp, setupAdmin } from './helpers.js';

describe('private projects', () => {
  it('are only visible to their members, owner and admins', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: owner, user: ownerUser } = await addPerson(t, admin, 'Olga Owner');
    const { agent: member, user: memberUser } = await addPerson(t, admin, 'Max Member');
    const { agent: outsider } = await addPerson(t, admin, 'Otto Outsider');

    const secret = await createProject(owner, { name: 'Secret', visibility: 'private' });
    expect(secret.memberIds).toEqual([ownerUser.id]);
    const task = await createTask(owner, secret.id, { title: 'Hidden work' });
    await createProject(owner, { name: 'Open' });

    const names = async (agent: typeof owner) => ((await agent.get('/api/projects').expect(200)).body.projects as Project[]).map((p) => p.name);
    expect(await names(owner)).toEqual(['Open', 'Secret']);
    expect(await names(outsider)).toEqual(['Open']);
    expect(await names(admin)).toEqual(['Open', 'Secret']);

    // Anything inside answers "not found" to people who can't see it.
    await outsider.get(`/api/projects/${secret.id}`).expect(404);
    await outsider.get(`/api/tasks/${task.id}`).expect(404);
    await outsider.get(`/api/tasks/${task.id}/comments`).expect(404);
    await outsider.post(`/api/tasks/${task.id}/comments`).send({ body: 'hi' }).expect(404);
    await outsider.post('/api/tasks').send({ projectId: secret.id, title: 'Sneaky' }).expect(400);
    expect((await outsider.get('/api/tasks').expect(200)).body.tasks).toHaveLength(0);
    expect((await outsider.get('/api/dashboard').expect(200)).body.projects).toHaveLength(1);
    expect(((await outsider.get('/api/activity').expect(200)).body.activity as { data: { projectName?: string } }[]).map((a) => a.data.projectName)).not.toContain(
      'Secret',
    );

    // Work can't be assigned to someone outside the private project.
    await owner.patch(`/api/tasks/${task.id}`).send({ assigneeId: memberUser.id }).expect(400);
    await owner.put(`/api/projects/${secret.id}/members`).send({ userIds: [ownerUser.id, memberUser.id] }).expect(200);
    await owner.patch(`/api/tasks/${task.id}`).send({ assigneeId: memberUser.id }).expect(200);
    expect(await names(member)).toEqual(['Open', 'Secret']);
    await member.put(`/api/projects/${secret.id}/members`).send({ userIds: [] }).expect(403);
  });

  it('keeps whoever makes a project private on it', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: owner, user: ownerUser } = await addPerson(t, admin, 'Olga Owner');
    const p = await createProject(owner, { name: 'Becomes private' });
    const updated = (await owner.patch(`/api/projects/${p.id}`).send({ visibility: 'private' }).expect(200)).body.project as Project;
    expect(updated).toMatchObject({ visibility: 'private', memberIds: [ownerUser.id] });
  });
});

describe('guests', () => {
  it('only see the projects they were added to, and can comment but not change work', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const { agent: guest, user: guestUser } = await addPerson(t, admin, 'Gina Guest', 'guest');
    const shared = await createProject(admin, { name: 'Shared with client' });
    await createProject(admin, { name: 'Internal' });
    const task = await createTask(admin, shared.id, { title: 'Homepage', assigneeId: adminUser.id });

    expect((await guest.get('/api/projects').expect(200)).body.projects).toHaveLength(0);
    await admin.put(`/api/projects/${shared.id}/members`).send({ userIds: [guestUser.id] }).expect(200);
    expect(((await guest.get('/api/projects').expect(200)).body.projects as Project[]).map((p) => p.name)).toEqual(['Shared with client']);
    expect((await guest.get('/api/tasks').expect(200)).body.tasks.map((x: Task) => x.title)).toEqual(['Homepage']);

    await guest.post(`/api/tasks/${task.id}/comments`).send({ body: 'Looks good!' }).expect(201);
    await guest.patch(`/api/tasks/${task.id}`).send({ title: 'Changed' }).expect(403);
    await guest.post(`/api/tasks/${task.id}/move`).send({ status: 'done', afterId: null }).expect(403);
    await guest.post('/api/tasks').send({ projectId: shared.id, title: 'New' }).expect(403);
    await guest.delete(`/api/tasks/${task.id}`).expect(403);
    await guest.post('/api/projects').send({ name: 'Mine' }).expect(403);
    await guest.post(`/api/tasks/${task.id}/checklist`).send({ body: 'x' }).expect(403);
    await guest.post(`/api/projects/${shared.id}/labels`).send({ name: 'x' }).expect(403);

    // Guests can't be given work or projects.
    await admin.patch(`/api/tasks/${task.id}`).send({ assigneeId: guestUser.id }).expect(400);
    await admin.patch(`/api/projects/${shared.id}`).send({ ownerId: guestUser.id }).expect(400);

    // The directory only shows people on the guest's projects.
    const { user: bystander } = await addPerson(t, admin, 'Bo Bystander');
    const people = ((await guest.get('/api/users').expect(200)).body.users as User[]).map((u) => u.id);
    expect(people).toContain(adminUser.id);
    expect(people).toContain(guestUser.id);
    expect(people).not.toContain(bystander.id);

    const dashboard = (await guest.get('/api/dashboard').expect(200)).body;
    expect(dashboard.projects.map((p: Project) => p.name)).toEqual(['Shared with client']);
    expect(dashboard.workload.map((w: { userId: number }) => w.userId)).not.toContain(bystander.id);
  });

  it('can’t be made guests while they still own work', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member, user } = await addPerson(t, admin, 'Mo Member');
    const p = await createProject(member);
    await admin.patch(`/api/users/${user.id}`).send({ role: 'guest' }).expect(400);
    await admin.patch(`/api/projects/${p.id}`).send({ ownerId: null }).expect(200);
    await admin.patch(`/api/users/${user.id}`).send({ role: 'guest' }).expect(200);
  });
});

describe('search', () => {
  it('finds tasks by title, description, comments, checklists and number, plus projects and people', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: outsider } = await addPerson(t, admin, 'Otto Outsider');
    const p = await createProject(admin, { name: 'Website' });
    const a = await createTask(admin, p.id, { title: 'Write the homepage copy' });
    const b = await createTask(admin, p.id, { title: 'Images', description: 'Need a HOMEPAGE hero' });
    const c = await createTask(admin, p.id, { title: 'Footer' });
    await admin.post(`/api/tasks/${c.id}/comments`).send({ body: 'Link it from the homepage too' }).expect(201);
    const d = await createTask(admin, p.id, { title: 'Checklist owner' });
    await admin.post(`/api/tasks/${d.id}/checklist`).send({ body: 'homepage banner' }).expect(201);
    const secret = await createProject(admin, { name: 'Secret homepage', visibility: 'private' });
    await createTask(admin, secret.id, { title: 'Secret homepage task' });

    const res = (await admin.get('/api/search?q=homepage').expect(200)).body as SearchResults;
    // Title matches first (admins see the private project too).
    expect(res.tasks.slice(0, 2).map((x) => x.title).sort()).toEqual(['Secret homepage task', 'Write the homepage copy']);
    expect(res.tasks.map((x) => x.id)).toEqual(expect.arrayContaining([a.id, b.id, c.id, d.id]));
    expect(res.projects.map((x) => x.name)).toEqual(['Secret homepage']);

    const theirs = (await outsider.get('/api/search?q=homepage').expect(200)).body as SearchResults;
    expect(theirs.tasks).toHaveLength(4);
    expect(theirs.projects).toHaveLength(0);

    expect(((await admin.get(`/api/search?q=%23${b.id}`).expect(200)).body as SearchResults).tasks[0]!.id).toBe(b.id);
    expect(((await admin.get('/api/search?q=otto').expect(200)).body as SearchResults).people.map((x) => x.name)).toEqual(['Otto Outsider']);
    expect(((await admin.get('/api/search?q=100%25').expect(200)).body as SearchResults).tasks).toHaveLength(0); // % is literal
  });
});

describe('live updates', () => {
  it('only tell people about projects they can see', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const { user: outsider } = await addPerson(t, admin, 'Otto Outsider');
    const secret = await createProject(admin, { name: 'Secret', visibility: 'private' });

    const received: Record<number, string[]> = { [adminUser.id]: [], [outsider.id]: [] };
    const fake = (id: number) => ({ write: (chunk: string) => received[id]!.push(chunk), end() {} }) as never;
    t.ctx.events.add(fake(adminUser.id), adminUser.id);
    t.ctx.events.add(fake(outsider.id), outsider.id);
    await createTask(admin, secret.id, { title: 'Hidden' });
    expect(received[adminUser.id]!.some((c) => c.includes('"entity":"task"'))).toBe(true);
    expect(received[outsider.id]!.some((c) => c.includes('"entity":"task"'))).toBe(false);
    t.ctx.events.closeAll();
  });
});
