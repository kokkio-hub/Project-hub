import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, addMember, client, makeApp, setupAdmin } from './helpers.js';

describe('first-run setup', () => {
  it('reports that setup is required on an empty database', async () => {
    const t = makeApp();
    const res = await client(t.app).get('/api/auth/status').expect(200);
    expect(res.body).toEqual({
      appName: 'Project Hub',
      setupRequired: true,
      emailEnabled: false,
      passwordResetEnabled: false,
      uploadLimitBytes: 25 * 1024 * 1024,
    });
  });

  it('creates the first admin, signs them in, and can only run once', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    expect(adminUser).toMatchObject({ email: ADMIN.email, role: 'admin', mustChangePassword: false });

    const me = await admin.get('/api/auth/me').expect(200);
    expect(me.body.user.id).toBe(adminUser.id);

    const again = await client(t.app)
      .post('/api/auth/setup')
      .send({ name: 'Mallory', email: 'mallory@example.com', password: 'another-password' })
      .expect(409);
    expect(again.body.error).toMatch(/already been completed/);

    const status = await client(t.app).get('/api/auth/status').expect(200);
    expect(status.body.setupRequired).toBe(false);
  });

  it('validates setup input with per-field messages', async () => {
    const t = makeApp();
    const res = await client(t.app)
      .post('/api/auth/setup')
      .send({ name: ' ', email: 'not-an-email', password: 'short' })
      .expect(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(['email', 'name', 'password']);
  });

  it('creates the admin from ADMIN_EMAIL / ADMIN_PASSWORD', async () => {
    const { bootstrapAdmin } = await import('../src/server/bootstrap.js');
    const t = makeApp({ bootstrapAdmin: { email: 'boot@example.com', password: 'bootstrap-pass', name: 'Boot' } });
    await bootstrapAdmin(t.db, t.config);
    await client(t.app).post('/api/auth/login').send({ email: 'boot@example.com', password: 'bootstrap-pass' }).expect(200);
  });
});

describe('sign in and out', () => {
  it('rejects wrong passwords and unknown emails with the same message', async () => {
    const t = makeApp();
    await setupAdmin(t);
    const wrong = await client(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: 'nope-nope' }).expect(401);
    const unknown = await client(t.app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope-nope' })
      .expect(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it('matches email addresses case-insensitively', async () => {
    const t = makeApp();
    await setupAdmin(t);
    await client(t.app).post('/api/auth/login').send({ email: '  ADA@Example.com ', password: ADMIN.password }).expect(200);
  });

  it('sets an HttpOnly, SameSite=Strict session cookie and clears it on logout', async () => {
    const t = makeApp();
    await setupAdmin(t);
    const agent = client(t.app);
    const res = await agent.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/ph_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);

    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('requires the X-Requested-With header on state-changing requests (CSRF guard)', async () => {
    const t = makeApp();
    await setupAdmin(t);
    const res = await request(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(403);
  });

  it('rate-limits repeated failed sign-ins', async () => {
    const t = makeApp({ loginRateLimit: 3 });
    await setupAdmin(t);
    const agent = client(t.app);
    for (let i = 0; i < 3; i++) {
      await agent.post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password' }).expect(401);
    }
    const blocked = await agent.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    expect(blocked.status).toBe(429);
  });

  it('protects API routes from anonymous access', async () => {
    const t = makeApp();
    await setupAdmin(t);
    for (const path of ['/api/projects', '/api/tasks', '/api/users', '/api/dashboard', '/api/activity']) {
      await client(t.app).get(path).expect(401);
    }
  });
});

describe('passwords', () => {
  it('forces people with a temporary password to change it before doing anything else', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const created = await admin.post('/api/users').send({ name: 'Bo', email: 'bo@example.com' }).expect(201);
    const temp = created.body.temporaryPassword as string;
    expect(temp).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);

    const bo = client(t.app);
    const login = await bo.post('/api/auth/login').send({ email: 'bo@example.com', password: temp }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    await bo.get('/api/projects').expect(403);
    await bo.get('/api/auth/me').expect(200);

    await bo.post('/api/auth/password').send({ currentPassword: temp, newPassword: temp }).expect(400);
    const changed = await bo
      .post('/api/auth/password')
      .send({ currentPassword: temp, newPassword: 'a-brand-new-password' })
      .expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    await bo.get('/api/projects').expect(200);
  });

  it('checks the current password and signs out other sessions on change', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const other = client(t.app);
    await other.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);

    await admin.post('/api/auth/password').send({ currentPassword: 'wrong-one', newPassword: 'next-password-1' }).expect(400);
    await admin
      .post('/api/auth/password')
      .send({ currentPassword: ADMIN.password, newPassword: 'next-password-1' })
      .expect(200);

    await admin.get('/api/auth/me').expect(200); // this session survives
    await other.get('/api/auth/me').expect(401); // the other one is signed out
    await client(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(401);
    await client(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: 'next-password-1' }).expect(200);
  });

  it('lets people update their own profile', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const res = await admin.patch('/api/auth/me').send({ name: 'Ada L.', title: 'CTO', color: 'green' }).expect(200);
    expect(res.body.user).toMatchObject({ name: 'Ada L.', title: 'CTO', color: 'green' });
    await admin.patch('/api/auth/me').send({ color: 'chartreuse' }).expect(400);
  });
});

describe('deactivation', () => {
  it('blocks sign-in and ends existing sessions', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent, user } = await addMember(t, admin, { name: 'Cy', email: 'cy@example.com' });
    await agent.get('/api/projects').expect(200);

    await admin.patch(`/api/users/${user.id}`).send({ isActive: false }).expect(200);
    await agent.get('/api/projects').expect(401);
    const res = await client(t.app).post('/api/auth/login').send({ email: 'cy@example.com', password: 'member-password-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/);
  });
});
