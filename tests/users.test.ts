import { describe, expect, it } from 'vitest';
import { addMember, client, makeApp, setupAdmin } from './helpers.js';

describe('team management', () => {
  it('lets members see the team but not change it', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addMember(t, admin, { name: 'Mo', email: 'mo@example.com' });

    const list = await member.get('/api/users').expect(200);
    expect(list.body.users.map((u: { email: string }) => u.email).sort()).toEqual(['ada@example.com', 'mo@example.com']);
    expect(list.body.users[0]).not.toHaveProperty('lastLoginAt');

    await member.post('/api/users').send({ name: 'X', email: 'x@example.com' }).expect(403);
    await member.patch('/api/users/1').send({ role: 'member' }).expect(403);
    await member.post('/api/users/1/reset-password').expect(403);
  });

  it('shows admins last sign-in times', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const list = await admin.get('/api/users').expect(200);
    expect(list.body.users[0].lastLoginAt).toEqual(expect.any(String));
  });

  it('creates accounts with a generated temporary password or a chosen one', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);

    const generated = await admin
      .post('/api/users')
      .send({ name: 'Gen', email: 'gen@example.com', title: 'Designer' })
      .expect(201);
    expect(generated.body.temporaryPassword).toEqual(expect.any(String));
    expect(generated.body.user).toMatchObject({ role: 'member', title: 'Designer', mustChangePassword: true, isActive: true });

    const chosen = await admin
      .post('/api/users')
      .send({ name: 'Cho', email: 'cho@example.com', password: 'chosen-password', role: 'admin' })
      .expect(201);
    expect(chosen.body.temporaryPassword).toBeUndefined();
    expect(chosen.body.user).toMatchObject({ role: 'admin', mustChangePassword: true });
    await client(t.app).post('/api/auth/login').send({ email: 'cho@example.com', password: 'chosen-password' }).expect(200);
  });

  it('rejects duplicate email addresses regardless of case', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    await admin.post('/api/users').send({ name: 'Dup', email: 'dup@example.com' }).expect(201);
    const res = await admin.post('/api/users').send({ name: 'Dup 2', email: 'DUP@example.com' }).expect(409);
    expect(res.body.fields.email).toBeDefined();
  });

  it('assigns identity colours in order, least-used first', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    expect(adminUser.color).toBe('blue');
    const second = await admin.post('/api/users').send({ name: 'Two', email: 'two@example.com' }).expect(201);
    const third = await admin.post('/api/users').send({ name: 'Three', email: 'three@example.com' }).expect(201);
    expect([second.body.user.color, third.body.user.color]).toEqual(['orange', 'aqua']);
  });

  it('never leaves the workspace without an active admin', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    await admin.patch(`/api/users/${adminUser.id}`).send({ role: 'member' }).expect(400);
    await admin.patch(`/api/users/${adminUser.id}`).send({ isActive: false }).expect(400);

    const { user: second } = await addMember(t, admin, { name: 'Second', email: 'second@example.com', role: 'admin' });
    await admin.patch(`/api/users/${adminUser.id}`).send({ role: 'member' }).expect(200);
    // Now `second` is the only admin, and the demoted user can no longer manage the team.
    await admin.patch(`/api/users/${second.id}`).send({ role: 'member' }).expect(403);
  });

  it('resets passwords: old password stops working, sessions end, change is required', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent, user } = await addMember(t, admin, { name: 'Rae', email: 'rae@example.com' });

    const res = await admin.post(`/api/users/${user.id}/reset-password`).expect(200);
    const temp = res.body.temporaryPassword as string;
    await agent.get('/api/projects').expect(401);
    await client(t.app).post('/api/auth/login').send({ email: 'rae@example.com', password: 'member-password-1' }).expect(401);

    const fresh = client(t.app);
    const login = await fresh.post('/api/auth/login').send({ email: 'rae@example.com', password: temp }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it("doesn't let admins reset their own password through the team page", async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    await admin.post(`/api/users/${adminUser.id}/reset-password`).expect(400);
  });

  it('can reactivate a deactivated account', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { user } = await addMember(t, admin, { name: 'Re', email: 're@example.com' });
    await admin.patch(`/api/users/${user.id}`).send({ isActive: false }).expect(200);
    const res = await admin.patch(`/api/users/${user.id}`).send({ isActive: true }).expect(200);
    expect(res.body.user.isActive).toBe(true);
    await client(t.app).post('/api/auth/login').send({ email: 're@example.com', password: 'member-password-1' }).expect(200);
  });
});
