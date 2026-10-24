import { describe, expect, it } from 'vitest';
import { codeAt, counterAt, verifyCode, base32Decode, base32Encode } from '../src/server/auth/totp.js';
import { describeDevice } from '../src/server/auth/sessions.js';
import type { Me, SessionInfo } from '../src/shared/types.js';
import { ADMIN, addPerson, client, createProject, createTask, FakeMailer, makeApp, setupAdmin, tokenOf } from './helpers.js';

describe('one-time codes', () => {
  it('match the RFC 6238 test vectors', () => {
    // The RFC's SHA-1 secret is the ASCII text "12345678901234567890".
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(codeAt(secret, counterAt(59_000))).toBe('287082');
    expect(codeAt(secret, counterAt(1_111_111_109_000))).toBe('081804');
    expect(codeAt(secret, counterAt(2_000_000_000_000))).toBe('279037');
  });

  it('allow a step of clock drift and refuse codes used before', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_111_111_109_000;
    const previous = codeAt(secret, counterAt(now) - 1);
    expect(verifyCode(secret, previous, null, now)).toBe(counterAt(now) - 1);
    expect(verifyCode(secret, previous, counterAt(now) - 1, now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, counterAt(now) - 3), null, now)).toBeNull();
    expect(verifyCode(secret, 'abcdef', null, now)).toBeNull();
  });
});

describe('two-factor sign-in', () => {
  it('is set up with a code from the app and then asked for at every sign-in', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    await admin.post('/api/auth/2fa/setup').send({ password: 'wrong' }).expect(400);
    const setup = (await admin.post('/api/auth/2fa/setup').send({ password: ADMIN.password }).expect(200)).body;
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Project%20Hub%3Aada%40example\.com\?secret=/);
    expect(setup.qrSvg).toMatch(/^<svg/);

    await admin.post('/api/auth/2fa/enable').send({ code: '000000' }).expect(400);
    const enabled = (await admin.post('/api/auth/2fa/enable').send({ code: codeAt(setup.secret, counterAt(Date.now())) }).expect(200)).body;
    expect(enabled.recoveryCodes).toHaveLength(10);
    expect((enabled.user as Me).twoFactorEnabled).toBe(true);
    expect((enabled.user as Me).recoveryCodesLeft).toBe(10);

    // Password alone isn't enough any more.
    const browser = client(t.app);
    const first = (await browser.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200)).body;
    expect(first.twoFactorRequired).toBe(true);
    await browser.get('/api/auth/me').expect(401);
    await browser.post('/api/auth/login/verify').send({ challenge: first.challenge, code: '123456' }).expect(400);
    // The code used to switch two-factor on can't be replayed.
    await browser
      .post('/api/auth/login/verify')
      .send({ challenge: first.challenge, code: codeAt(setup.secret, counterAt(Date.now())) })
      .expect(400);

    // A recovery code works, once.
    const done = await browser.post('/api/auth/login/verify').send({ challenge: first.challenge, code: enabled.recoveryCodes[0].toUpperCase() });
    expect(done.status).toBe(200);
    expect((done.body.user as Me).recoveryCodesLeft).toBe(9);
    await browser.get('/api/auth/me').expect(200);
    await browser.post('/api/auth/login/verify').send({ challenge: first.challenge, code: 'x' }).expect(410); // used up

    const again = client(t.app);
    const second = (await again.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200)).body;
    await again.post('/api/auth/login/verify').send({ challenge: second.challenge, code: enabled.recoveryCodes[0] }).expect(400);

    // Turning it off needs the password.
    await browser.post('/api/auth/2fa/disable').send({ password: 'nope' }).expect(400);
    const off = (await browser.post('/api/auth/2fa/disable').send({ password: ADMIN.password }).expect(200)).body.user as Me;
    expect(off.twoFactorEnabled).toBe(false);
    expect((await client(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200)).body.user).toBeDefined();
  });

  it('gives up on a sign-in after five wrong codes', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const setup = (await admin.post('/api/auth/2fa/setup').send({ password: ADMIN.password }).expect(200)).body;
    await admin.post('/api/auth/2fa/enable').send({ code: codeAt(setup.secret, counterAt(Date.now())) }).expect(200);
    const browser = client(t.app);
    const { challenge } = (await browser.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200)).body;
    for (let i = 0; i < 5; i++) await browser.post('/api/auth/login/verify').send({ challenge, code: '111111' }).expect(400);
    await browser.post('/api/auth/login/verify').send({ challenge, code: codeAt(setup.secret, counterAt(Date.now()) + 1) }).expect(410);
  });

  it('can be turned off for someone by an admin, and still applies after a password reset', async () => {
    const mailer = new FakeMailer();
    const t = makeApp({ appUrl: 'https://projects.example.com' }, { mailer });
    const { admin } = await setupAdmin(t);
    const { agent: member, user } = await addPerson(t, admin, 'Mia Member');
    const setup = (await member.post('/api/auth/2fa/setup').send({ password: 'member-password-1' }).expect(200)).body;
    await member.post('/api/auth/2fa/enable').send({ code: codeAt(setup.secret, counterAt(Date.now())) }).expect(200);
    expect((await admin.get('/api/users').expect(200)).body.users.find((u: { id: number }) => u.id === user.id).twoFactorEnabled).toBe(true);
    await member.post(`/api/users/${user.id}/disable-2fa`).expect(403);

    await client(t.app).post('/api/auth/password-reset/request').send({ email: user.email }).expect(200);
    await t.ctx.jobs.idle();
    const reset = await client(t.app).post('/api/auth/password-reset/complete').send({ token: tokenOf(mailer.link()), password: 'brand-new-pass-1' });
    expect(reset.body.twoFactorRequired).toBe(true);
    await member.get('/api/auth/me').expect(401); // the reset signed every device out

    await admin.post(`/api/users/${user.id}/disable-2fa`).expect(200);
    await admin.post(`/api/users/${user.id}/disable-2fa`).expect(400);
  });
});

describe('signed-in devices', () => {
  it('names devices and signs out the others', async () => {
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe(
      'Chrome on Windows',
    );
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(
      'Safari on iPhone',
    );

    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const laptop = client(t.app).set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0');
    await laptop.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);

    const sessions = (await admin.get('/api/auth/sessions').expect(200)).body.sessions as SessionInfo[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const other = sessions.find((s) => !s.current)!;
    expect(other.device).toBe('Firefox on Mac');
    await admin.delete(`/api/auth/sessions/${sessions.find((s) => s.current)!.id}`).expect(400);
    await admin.delete(`/api/auth/sessions/${other.id}`).expect(204);
    await laptop.get('/api/auth/me').expect(401);

    await laptop.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    await admin.post('/api/auth/sessions/sign-out-others').expect(204);
    await laptop.get('/api/auth/me').expect(401);
    await admin.get('/api/auth/me').expect(200);
  });
});

describe('calendar feed', () => {
  it('serves your tasks at a secret address until you replace it', async () => {
    const t = makeApp({ appUrl: 'https://projects.example.com' });
    const { admin, adminUser } = await setupAdmin(t);
    const { user: other } = await addPerson(t, admin, 'Otto Other');
    const p = await createProject(admin, { name: 'Website' });
    await createTask(admin, p.id, { title: 'Mine, with a comma, and; semicolon', assigneeId: adminUser.id, startDate: '2026-06-10', dueDate: '2026-06-12' });
    await createTask(admin, p.id, { title: 'Theirs', assigneeId: other.id, dueDate: '2026-06-15' });
    await createTask(admin, p.id, { title: 'No dates', assigneeId: adminUser.id });

    const { url, user } = (await admin.post('/api/auth/calendar').send({ scope: 'mine' }).expect(200)).body;
    expect((user as Me).calendarFeed).toBe(true);
    expect(url).toMatch(/^https:\/\/projects\.example\.com\/api\/calendar\/[\w-]+\.ics$/);
    const path = new URL(url).pathname;

    const feed = await client(t.app).get(path).expect(200);
    expect(feed.headers['content-type']).toMatch(/text\/calendar/);
    expect(feed.text).toContain('SUMMARY:Mine\\, with a comma\\, and\\; semicolon');
    expect(feed.text).toContain('DTSTART;VALUE=DATE:20260610');
    expect(feed.text).toContain('DTEND;VALUE=DATE:20260613');
    expect(feed.text).not.toContain('Theirs');
    expect(feed.text).not.toContain('No dates');
    expect(feed.text.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);

    await admin.patch('/api/auth/calendar').send({ scope: 'all' }).expect(200);
    expect((await client(t.app).get(path).expect(200)).text).toContain('Theirs');

    await admin.post('/api/auth/calendar').send({}).expect(200);
    await client(t.app).get(path).expect(404);
    await client(t.app).get('/api/calendar/not-a-real-token-at-all-123.ics').expect(404);
  });
});
