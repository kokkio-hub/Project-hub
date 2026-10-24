import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/server/config.js';
import { createMailer, explainMailError } from '../src/server/lib/mailer.js';
import type { Task, User } from '../src/shared/types.js';
import { ADMIN, addMember, client, FakeMailer, makeApp, setupAdmin, tokenOf } from './helpers.js';

const APP_URL = 'https://projects.example.com';

/** An app with email set up (via a fake mail server) and APP_URL set. */
function withEmail() {
  const mailer = new FakeMailer();
  return { ...makeApp({ appUrl: APP_URL }, { mailer }), mailer };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('email settings', () => {
  it('reports whether invitations and password resets can be emailed', async () => {
    const status = async (t: ReturnType<typeof makeApp>) => (await client(t.app).get('/api/auth/status').expect(200)).body;
    expect(await status(makeApp())).toMatchObject({ emailEnabled: false, passwordResetEnabled: false });
    expect(await status(makeApp({}, { mailer: new FakeMailer() }))).toMatchObject({ emailEnabled: true, passwordResetEnabled: false });
    expect(await status(withEmail())).toMatchObject({ emailEnabled: true, passwordResetEnabled: true });
  });

  it('reads the SMTP settings from the environment', () => {
    const config = loadConfig({
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'projects@example.com',
      SMTP_PASSWORD: 'secret',
      APP_URL: 'https://projects.example.com/some/page',
    });
    expect(config.smtp).toEqual({ host: 'smtp.example.com', port: 587, secure: false, user: 'projects@example.com', password: 'secret' });
    expect(config.mailFrom).toEqual({ name: 'Project Hub', address: 'projects@example.com' });
    expect(config.appUrl).toBe('https://projects.example.com');
    expect(loadConfig({ SMTP_HOST: 'mail', SMTP_PORT: '465', MAIL_FROM: 'Hub <hub@example.com>' }).smtp?.secure).toBe(true);
    expect(loadConfig({}).smtp).toBeNull();
    expect(() => loadConfig({ SMTP_HOST: 'mail', SMTP_USER: 'apikey' })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ APP_URL: 'projects.example.com' })).toThrow(/APP_URL/);
  });
});

describe('inviting by email', () => {
  it('emails an invitation whose link lets the person choose a password and sign in', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const res = await admin
      .post('/api/users')
      .send({ name: 'Fatima el Amrani', email: 'fatima@example.com', invite: 'email' })
      .expect(201);
    expect(res.body).toMatchObject({ emailed: true, user: { invitePending: true, mustChangePassword: false } });
    expect(res.body.user.invite).toMatchObject({ emailedAt: expect.any(String), expiresAt: expect.any(String) });
    expect(res.body.inviteUrl).toBeUndefined();
    expect(res.body.temporaryPassword).toBeUndefined();

    expect(t.mailer.sent).toHaveLength(1);
    const mail = t.mailer.sent[0]!;
    expect(mail.to).toBe('fatima@example.com');
    expect(mail.subject).toBe('Ada Admin invited you to Project Hub');
    expect(t.mailer.link()).toMatch(/^https:\/\/projects\.example\.com\/invite#[\w-]{43}$/);
    expect(mail.html).toContain(t.mailer.link());

    // Until they accept, signing in fails exactly as it would for an unknown address.
    const login = await client(t.app)
      .post('/api/auth/login')
      .send({ email: 'fatima@example.com', password: 'anything-at-all' })
      .expect(401);
    expect(login.body.error).toBe('Incorrect email or password.');

    const token = t.mailer.token();
    const info = await client(t.app).post('/api/auth/invitation/lookup').send({ token }).expect(200);
    expect(info.body).toEqual({ name: 'Fatima el Amrani', email: 'fatima@example.com', invitedBy: 'Ada Admin' });

    const fatima = client(t.app);
    await fatima.post('/api/auth/invitation/accept').send({ token, password: 'short' }).expect(400);
    const accepted = await fatima
      .post('/api/auth/invitation/accept')
      .send({ token, name: 'Fatima E.', password: 'fatimas-password' })
      .expect(200);
    expect(accepted.body.user).toMatchObject({ name: 'Fatima E.', invitePending: false, mustChangePassword: false });
    await fatima.get('/api/projects').expect(200); // signed in straight away

    // The link works only once.
    await client(t.app).post('/api/auth/invitation/accept').send({ token, password: 'another-password' }).expect(410);
    await client(t.app).post('/api/auth/invitation/lookup').send({ token }).expect(410);
    await client(t.app).post('/api/auth/login').send({ email: 'fatima@example.com', password: 'fatimas-password' }).expect(200);
  });

  it("refuses to email invitations when email isn't set up", async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const res = await admin.post('/api/users').send({ name: 'No Mail', email: 'nomail@example.com', invite: 'email' }).expect(400);
    expect(res.body.error).toMatch(/Email isn't set up/);
    expect((await admin.get('/api/users').expect(200)).body.users).toHaveLength(1);
  });

  it("returns the link when the email couldn't be sent, so the admin can pass it on", async () => {
    const t = withEmail();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = await setupAdmin(t);
    t.mailer.failWith = "Couldn't connect to the mail server at test:25.";
    const res = await admin.post('/api/users').send({ name: 'Ines', email: 'ines@example.com', invite: 'email' }).expect(201);
    expect(res.body).toMatchObject({ emailed: false, emailError: "Couldn't connect to the mail server at test:25." });
    expect(res.body.user).toMatchObject({ invitePending: true, invite: { emailedAt: null } });
    await client(t.app)
      .post('/api/auth/invitation/accept')
      .send({ token: tokenOf(res.body.inviteUrl), password: 'ines-password' })
      .expect(200);
  });

  it('escapes names in the email', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    await admin.patch('/api/auth/me').send({ name: '<b>Ada</b> & co' }).expect(200);
    await admin.post('/api/users').send({ name: 'Eve<i>', email: 'eve@example.com', invite: 'email' }).expect(201);
    const mail = t.mailer.sent[0]!;
    expect(mail.html).toContain('&lt;b&gt;Ada&lt;/b&gt; &amp; co');
    expect(mail.html).toContain('Hi Eve&lt;i&gt;,');
    expect(mail.html).not.toContain('<b>Ada</b>');
    expect(mail.html).not.toContain('<i>');
  });
});

describe('invitation links', () => {
  it('creates a link to share by hand, without needing email', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const res = await admin.post('/api/users').send({ name: 'Lars', email: 'lars@example.com', invite: 'link' }).expect(201);
    // Without APP_URL, the link uses the address the admin has open.
    expect(res.body.inviteUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/invite#[\w-]{43}$/);
    expect(res.body.emailed).toBeUndefined();
    expect(res.body.user.invite).toMatchObject({ emailedAt: null });
    await client(t.app)
      .post('/api/auth/invitation/accept')
      .send({ token: tokenOf(res.body.inviteUrl), password: 'lars-password' })
      .expect(200);
  });

  it('replaces the link when a new invitation is sent', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const created = await admin.post('/api/users').send({ name: 'Rosa', email: 'rosa@example.com', invite: 'link' }).expect(201);
    const id = created.body.user.id;

    const emailed = await admin.post(`/api/users/${id}/invite`).send({ sendEmail: true }).expect(200);
    expect(emailed.body).toMatchObject({ emailed: true, expiresAt: expect.any(String) });
    expect(emailed.body.inviteUrl).toBeUndefined();
    await client(t.app).post('/api/auth/invitation/lookup').send({ token: tokenOf(created.body.inviteUrl) }).expect(410);

    const copied = await admin.post(`/api/users/${id}/invite`).send({ sendEmail: false }).expect(200);
    await client(t.app).post('/api/auth/invitation/lookup').send({ token: t.mailer.token() }).expect(410);
    await client(t.app)
      .post('/api/auth/invitation/accept')
      .send({ token: tokenOf(copied.body.inviteUrl), password: 'rosas-password' })
      .expect(200);

    // Once someone has joined there's nothing left to send.
    await admin.post(`/api/users/${id}/invite`).send({ sendEmail: false }).expect(400);
  });

  it('only lets admins invite people, send invitations and cancel them', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addMember(t, admin, { name: 'Mo', email: 'mo@example.com' });
    const created = await admin.post('/api/users').send({ name: 'Pat', email: 'pat@example.com', invite: 'link' }).expect(201);
    await member.post('/api/users').send({ name: 'X', email: 'x@example.com', invite: 'link' }).expect(403);
    await member.post(`/api/users/${created.body.user.id}/invite`).send({ sendEmail: false }).expect(403);
    await member.delete(`/api/users/${created.body.user.id}`).expect(403);
  });

  it('shows admins the state of each invitation, and everyone who is still invited', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addMember(t, admin, { name: 'Mo', email: 'mo@example.com' });
    await admin.post('/api/users').send({ name: 'Pat', email: 'pat@example.com', invite: 'email' }).expect(201);

    const seenByAdmin = (await admin.get('/api/users').expect(200)).body.users as User[];
    expect(seenByAdmin.find((u) => u.email === 'pat@example.com')).toMatchObject({
      invitePending: true,
      invite: { emailedAt: expect.any(String) },
    });
    expect(seenByAdmin.find((u) => u.email === 'mo@example.com')).toMatchObject({ invitePending: false, invite: null });

    const seenByMember = (await member.get('/api/users').expect(200)).body.users as User[];
    expect(seenByMember.find((u) => u.email === 'pat@example.com')).toMatchObject({ invitePending: true });
    expect(seenByMember[0]).not.toHaveProperty('invite');
  });

  it('cancels an invitation: the account and link are removed and their tasks become unassigned', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const created = await admin.post('/api/users').send({ name: 'Gone Soon', email: 'gone@example.com', invite: 'link' }).expect(201);
    const id = created.body.user.id as number;
    const project = (await admin.post('/api/projects').send({ name: 'P' }).expect(201)).body.project;
    const task = (
      await admin.post('/api/tasks').send({ projectId: project.id, title: 'For the new person', assigneeId: id }).expect(201)
    ).body.task as Task;

    await admin.delete(`/api/users/${id}`).expect(204);
    expect((await admin.get('/api/users').expect(200)).body.users.map((u: User) => u.email)).toEqual(['ada@example.com']);
    expect((await admin.get(`/api/tasks/${task.id}`).expect(200)).body.task.assigneeId).toBeNull();
    await client(t.app).post('/api/auth/invitation/lookup').send({ token: tokenOf(created.body.inviteUrl) }).expect(410);
  });

  it("won't cancel someone who has already joined", async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { user } = await addMember(t, admin, { name: 'Joined', email: 'joined@example.com' });
    const res = await admin.delete(`/api/users/${user.id}`).expect(400);
    expect(res.body.error).toMatch(/deactivate/);
  });

  it('stops expired links from working', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const created = await admin.post('/api/users').send({ name: 'Late', email: 'late@example.com', invite: 'link' }).expect(201);
    t.db.prepare('UPDATE user_tokens SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
    const token = tokenOf(created.body.inviteUrl);
    await client(t.app).post('/api/auth/invitation/lookup').send({ token }).expect(410);
    await client(t.app).post('/api/auth/invitation/accept').send({ token, password: 'late-password' }).expect(410);
    const users = (await admin.get('/api/users').expect(200)).body.users as User[];
    expect(users.find((u) => u.email === 'late@example.com')).toMatchObject({ invitePending: true, invite: null });
  });

  it('stops links from working when the email address changes or the account is deactivated', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const a = await admin.post('/api/users').send({ name: 'A', email: 'a@example.com', invite: 'link' }).expect(201);
    const b = await admin.post('/api/users').send({ name: 'B', email: 'b@example.com', invite: 'link' }).expect(201);
    await admin.patch(`/api/users/${a.body.user.id}`).send({ email: 'a.new@example.com' }).expect(200);
    await admin.patch(`/api/users/${b.body.user.id}`).send({ isActive: false }).expect(200);
    await client(t.app).post('/api/auth/invitation/lookup').send({ token: tokenOf(a.body.inviteUrl) }).expect(410);
    await client(t.app).post('/api/auth/invitation/lookup').send({ token: tokenOf(b.body.inviteUrl) }).expect(410);
    // Someone deactivated can't be sent a new invitation until they're reactivated.
    await admin.post(`/api/users/${b.body.user.id}/invite`).send({ sendEmail: false }).expect(400);
  });

  it("doesn't count invited admins who haven't joined yet toward the required admin", async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    await admin.post('/api/users').send({ name: 'Future Admin', email: 'future@example.com', role: 'admin', invite: 'link' }).expect(201);
    await admin.patch(`/api/users/${adminUser.id}`).send({ role: 'member' }).expect(400);
  });

  it('rejects incomplete and unknown tokens', async () => {
    const t = makeApp();
    await setupAdmin(t);
    await client(t.app).post('/api/auth/invitation/lookup').send({}).expect(400);
    await client(t.app).post('/api/auth/invitation/lookup').send({ token: 'x'.repeat(43) }).expect(410);
    await client(t.app).post('/api/auth/password-reset/lookup').send({ token: 'x'.repeat(43) }).expect(410);
  });
});

describe('forgotten passwords', () => {
  it('emails a reset link that sets a new password and signs out other sessions', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const { agent: member } = await addMember(t, admin, { name: 'Mia Jansen', email: 'mia@example.com' }, 'old-password-1');

    const res = await client(t.app).post('/api/auth/password-reset/request').send({ email: 'MIA@example.com' }).expect(200);
    expect(res.body).toEqual({ ok: true });
    await t.ctx.jobs.idle();
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]).toMatchObject({ to: 'mia@example.com', subject: 'Reset your Project Hub password' });
    expect(t.mailer.link()).toMatch(/^https:\/\/projects\.example\.com\/reset-password#[\w-]{43}$/);

    const token = t.mailer.token();
    const info = await client(t.app).post('/api/auth/password-reset/lookup').send({ token }).expect(200);
    expect(info.body).toEqual({ name: 'Mia Jansen', email: 'mia@example.com' });

    const fresh = client(t.app);
    const done = await fresh.post('/api/auth/password-reset/complete').send({ token, password: 'new-password-1' }).expect(200);
    expect(done.body.user.email).toBe('mia@example.com');
    await fresh.get('/api/projects').expect(200); // signed in here
    await member.get('/api/projects').expect(401); // and signed out everywhere else
    await client(t.app).post('/api/auth/login').send({ email: 'mia@example.com', password: 'old-password-1' }).expect(401);
    await client(t.app).post('/api/auth/login').send({ email: 'mia@example.com', password: 'new-password-1' }).expect(200);
    await client(t.app).post('/api/auth/password-reset/complete').send({ token, password: 'third-password' }).expect(410);
  });

  it("answers the same for unknown addresses, and sends nothing", async () => {
    const t = withEmail();
    await setupAdmin(t);
    const res = await client(t.app).post('/api/auth/password-reset/request').send({ email: 'nobody@example.com' }).expect(200);
    expect(res.body).toEqual({ ok: true });
    await t.ctx.jobs.idle();
    expect(t.mailer.sent).toHaveLength(0);
  });

  it('sends at most one email a minute to the same person', async () => {
    const t = withEmail();
    await setupAdmin(t);
    for (let i = 0; i < 3; i++) {
      await client(t.app).post('/api/auth/password-reset/request').send({ email: ADMIN.email }).expect(200);
    }
    await t.ctx.jobs.idle();
    expect(t.mailer.sent).toHaveLength(1);
  });

  it('sends a fresh invitation to someone who never accepted theirs', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    await admin.post('/api/users').send({ name: 'Noor', email: 'noor@example.com', invite: 'link' }).expect(201);
    t.db.prepare("UPDATE user_tokens SET created_at = '2020-01-01T00:00:00.000Z'").run(); // older than a minute
    await client(t.app).post('/api/auth/password-reset/request').send({ email: 'noor@example.com' }).expect(200);
    await t.ctx.jobs.idle();
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]!.subject).toBe('Ada Admin invited you to Project Hub');
    expect(t.mailer.link()).toContain('/invite#');
  });

  it('ignores deactivated accounts', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const { user } = await addMember(t, admin, { name: 'Ex', email: 'ex@example.com' });
    await admin.patch(`/api/users/${user.id}`).send({ isActive: false }).expect(200);
    await client(t.app).post('/api/auth/password-reset/request').send({ email: 'ex@example.com' }).expect(200);
    await t.ctx.jobs.idle();
    expect(t.mailer.sent).toHaveLength(0);
  });

  it('is off without APP_URL, so links never depend on the address a request came in on', async () => {
    const t = makeApp({}, { mailer: new FakeMailer() });
    await setupAdmin(t);
    await client(t.app).post('/api/auth/password-reset/request').send({ email: ADMIN.email }).expect(400);
  });

  it('cancels outstanding reset links when the password is changed', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    await client(t.app).post('/api/auth/password-reset/request').send({ email: ADMIN.email }).expect(200);
    await t.ctx.jobs.idle();
    await admin.post('/api/auth/password').send({ currentPassword: ADMIN.password, newPassword: 'changed-password' }).expect(200);
    await client(t.app).post('/api/auth/password-reset/lookup').send({ token: t.mailer.token() }).expect(410);
  });
});

describe('admin password resets by email', () => {
  it('emails a reset link and keeps the current password working until the link is used', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const { agent, user } = await addMember(t, admin, { name: 'Sam', email: 'sam@example.com' }, 'sams-password');

    const res = await admin.post(`/api/users/${user.id}/reset-password`).send({ sendEmail: true }).expect(200);
    expect(res.body).toEqual({ emailed: true });
    expect(t.mailer.sent[0]).toMatchObject({ to: 'sam@example.com' });
    expect(t.mailer.sent[0]!.text).toContain('Ada Admin sent you a link to choose a new password');
    await agent.get('/api/projects').expect(200);
    await client(t.app).post('/api/auth/login').send({ email: 'sam@example.com', password: 'sams-password' }).expect(200);

    await client(t.app)
      .post('/api/auth/password-reset/complete')
      .send({ token: t.mailer.token(), password: 'sams-new-password' })
      .expect(200);
    await agent.get('/api/projects').expect(401);
  });

  it("reports a failed email instead of pretending it was sent", async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const { user } = await addMember(t, admin, { name: 'Sam', email: 'sam@example.com' });
    t.mailer.failWith = 'The mail server refused the message.';
    const res = await admin.post(`/api/users/${user.id}/reset-password`).send({ sendEmail: true }).expect(502);
    expect(res.body.error).toMatch(/refused the message/);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM user_tokens').get()).toEqual({ n: 0 });
  });

  it('points to a new invitation for people who have not joined yet', async () => {
    const t = withEmail();
    const { admin } = await setupAdmin(t);
    const created = await admin.post('/api/users').send({ name: 'Ivy', email: 'ivy@example.com', invite: 'link' }).expect(201);
    const res = await admin.post(`/api/users/${created.body.user.id}/reset-password`).send({ sendEmail: true }).expect(400);
    expect(res.body.error).toMatch(/Send a new invitation/);
    await admin.post(`/api/users/${created.body.user.id}/reset-password`).send({}).expect(400);
  });
});

describe('sending through SMTP', () => {
  /** A tiny SMTP server that accepts every message, enough to exercise the real mail transport. */
  async function startSmtpServer() {
    const messages: string[] = [];
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let buffer = '';
      let data: string | null = null;
      socket.write('220 test ESMTP\r\n');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data !== null) {
            if (line === '.') {
              messages.push(data);
              data = null;
              socket.write('250 Queued\r\n');
            } else {
              data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
            }
            continue;
          }
          const command = line.slice(0, 4).toUpperCase();
          if (command === 'EHLO' || command === 'HELO') socket.write('250-test\r\n250 8BITMIME\r\n');
          else if (command === 'DATA') {
            data = '';
            socket.write('354 Go ahead\r\n');
          } else if (command === 'QUIT') socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    return { port, messages, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it('delivers a message to the configured server', async () => {
    const smtp = await startSmtpServer();
    try {
      const config = loadConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: 'Project Hub <hub@example.com>' });
      const mailer = createMailer(config);
      await mailer.verify();
      await mailer.send({ to: 'fatima@example.com', subject: 'Welcome aboard', text: 'Hello Fatima', html: '<p>Hello Fatima</p>' });
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]).toMatch(/^From: .*hub@example\.com/m);
      expect(smtp.messages[0]).toMatch(/^To: fatima@example\.com/m);
      expect(smtp.messages[0]).toMatch(/^Subject: Welcome aboard/m);
    } finally {
      await smtp.close();
    }
  });

  it('explains mail server problems in plain words', async () => {
    const config = loadConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', MAIL_FROM: 'hub@example.com' });
    await expect(createMailer(config).verify()).rejects.toThrow(/Couldn't connect to the mail server at 127\.0\.0\.1:1/);
    expect(explainMailError({ code: 'EAUTH' }, 'smtp.example.com:587')).toMatch(/username or password/);
    expect(explainMailError({ responseCode: 550, response: '550 5.7.1 Relaying denied' }, 'x')).toBe(
      'The mail server refused the message: 550 5.7.1 Relaying denied',
    );
  });
});

describe('sending through Resend', () => {
  const RESEND = { RESEND_API_KEY: 're_test_123', MAIL_FROM: 'Project Hub <projects@example.com>' };

  /** A stand-in for fetch that records requests and answers with the given responses in turn. */
  function fakeFetch(...answers: (Response | Error)[]) {
    const requests: { url: string; init: RequestInit }[] = [];
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });
      const answer = answers.shift() ?? new Response('{}', { status: 200 });
      if (answer instanceof Error) throw answer;
      return answer;
    });
    return { fetch: fn as unknown as typeof fetch, requests };
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('reads the Resend settings, and prefers Resend over SMTP', () => {
    const config = loadConfig({ ...RESEND, SMTP_HOST: 'smtp.example.com' });
    expect(config.resendApiKey).toBe('re_test_123');
    expect(createMailer(config).description).toBe('Resend');
    expect(loadConfig({}).resendApiKey).toBeNull();
    expect(() => loadConfig({ RESEND_API_KEY: 're_test_123' })).toThrow(/MAIL_FROM.*verified in Resend/);
  });

  it('sends the message over HTTPS with the API key', async () => {
    const { fetch, requests } = fakeFetch(json(200, { id: 'abc' }));
    const mailer = createMailer(loadConfig(RESEND), { fetch, resendUrl: 'https://resend.test' });
    await mailer.send({ to: 'fatima@example.com', subject: 'Welcome aboard', text: 'Hello Fatima', html: '<p>Hello Fatima</p>' });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://resend.test/emails');
    expect(requests[0]!.init.method).toBe('POST');
    expect((requests[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_123');
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
      from: 'Project Hub <projects@example.com>',
      to: ['fatima@example.com'],
      subject: 'Welcome aboard',
      html: '<p>Hello Fatima</p>',
      text: 'Hello Fatima',
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
  });

  it('explains what Resend refused', async () => {
    const { fetch } = fakeFetch(
      json(403, { name: 'validation_error', message: 'You can only send testing emails to your own email address (you@example.com).' }),
      json(403, { name: 'validation_error', message: 'The example.com domain is not verified. Please, add and verify your domain.' }),
      json(401, { name: 'validation_error', message: 'API key is invalid' }),
      json(429, { name: 'rate_limit_exceeded', message: 'Too many requests.' }),
      new TypeError('fetch failed'),
    );
    const mailer = createMailer(loadConfig(RESEND), { fetch });
    const message = { to: 'fatima@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' };
    await expect(mailer.send(message)).rejects.toThrow(/only delivers to your own address until you verify a domain/);
    await expect(mailer.send(message)).rejects.toThrow(/domain in MAIL_FROM isn't verified/);
    await expect(mailer.send(message)).rejects.toThrow(/didn't accept the API key/);
    await expect(mailer.send(message)).rejects.toThrow(/limiting how fast/);
    await expect(mailer.send(message)).rejects.toThrow(/Couldn't reach Resend/);
  });

  it('checks the API key without sending anything', async () => {
    const { fetch, requests } = fakeFetch(
      json(200, { data: [] }),
      json(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails.' }),
      json(401, { name: 'validation_error', message: 'API key is invalid' }),
    );
    const mailer = createMailer(loadConfig(RESEND), { fetch, resendUrl: 'https://resend.test' });
    await mailer.verify(); // full-access key
    await mailer.verify(); // sending-only key: still a real key
    await expect(mailer.verify()).rejects.toThrow(/didn't accept the API key/);
    expect(requests.map((r) => `${r.init.method} ${r.url}`)).toEqual([
      'GET https://resend.test/domains',
      'GET https://resend.test/domains',
      'GET https://resend.test/domains',
    ]);
  });

  it('turns email on for the app', async () => {
    const config = { ...loadConfig(RESEND), databasePath: ':memory:' };
    expect(createMailer(config).enabled).toBe(true);
    const t = makeApp({ resendApiKey: config.resendApiKey, mailFrom: config.mailFrom, appUrl: APP_URL });
    const res = await client(t.app).get('/api/auth/status').expect(200);
    expect(res.body).toMatchObject({ emailEnabled: true, passwordResetEnabled: true });
  });
});
