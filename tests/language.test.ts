import { describe, expect, it } from 'vitest';
import { getUserById } from '../src/server/repos/users.js';
import { sendInstantEmails } from '../src/server/services/notify.js';
import type { Me } from '../src/shared/types.js';
import { ADMIN, addPerson, client, createProject, createTask, FakeMailer, makeApp, setupAdmin } from './helpers.js';

describe('interface language', () => {
  it('answers in the language the web app asks for', async () => {
    const t = makeApp();
    await setupAdmin(t);
    const res = await client(t.app)
      .set('X-Client-Lang', 'nl')
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'wrong-password' })
      .expect(401);
    expect(res.body.error).toBe('Onjuist e-mailadres of wachtwoord.');

    const english = await client(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password' }).expect(401);
    expect(english.body.error).toBe('Incorrect email or password.');
  });

  it('translates field messages and messages with names in them', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    admin.set('X-Client-Lang', 'nl');
    const res = await admin.post('/api/projects').send({ name: '' }).expect(400);
    expect(res.body.fields.name).toBe('Geef het project een naam');
    const missing = await admin.get('/api/tasks/999').expect(404);
    expect(missing.body.error).toBe('Taak niet gevonden.');
    const invalid = await admin.get('/api/tasks/abc').expect(400);
    expect(invalid.body.error).toBe('Ongeldig taak-id.');
  });

  it('falls back to the browser’s language, then to the workspace default', async () => {
    const t = makeApp();
    await setupAdmin(t);
    const res = await client(t.app)
      .set('Accept-Language', 'nl-NL,nl;q=0.9,en;q=0.8')
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'nope' })
      .expect(401);
    expect(res.body.error).toBe('Onjuist e-mailadres of wachtwoord.');

    const dutchWorkspace = makeApp({ defaultLanguage: 'nl' });
    await setupAdmin(dutchWorkspace);
    const status = await client(dutchWorkspace.app).get('/api/auth/status').expect(200);
    expect(status.body.defaultLanguage).toBe('nl');
    const viaDefault = await client(dutchWorkspace.app)
      .set('Accept-Language', 'en-GB')
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'nope' })
      .expect(401);
    expect(viaDefault.body.error).toBe('Onjuist e-mailadres of wachtwoord.');
  });

  it('saves the chosen language with the account, and can go back to automatic', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    expect(((await admin.get('/api/auth/me').expect(200)).body.user as Me).language).toBeNull();
    const saved = await admin.patch('/api/auth/me').send({ language: 'nl' }).expect(200);
    expect((saved.body.user as Me).language).toBe('nl');
    // Requests without the app's header (a CSV download link) follow the saved choice.
    const csv = await client(t.app).get('/api/export/tasks.csv').expect(401);
    expect(csv.body.error).toBe('Please sign in to continue.');
    await admin.patch('/api/auth/me').send({ language: null }).expect(200);
    expect(getUserById(t.db, adminUser.id)!.language).toBeNull();
    await admin.patch('/api/auth/me').send({ language: 'de' }).expect(400);
  });

  it('remembers the language people use, for their emails', async () => {
    const mailer = new FakeMailer();
    const t = makeApp({ appUrl: 'https://projects.example.com' }, { mailer });
    const { admin } = await setupAdmin(t);
    const { agent: member, user } = await addPerson(t, admin, 'Mia Member');
    member.set('X-Client-Lang', 'nl');
    await member.patch('/api/auth/me').send({ notifyEmail: 'instant' }).expect(200);
    expect(getUserById(t.db, user.id)!.ui_language).toBe('nl');

    const p = await createProject(admin);
    await createTask(admin, p.id, { title: 'Offerte maken', assigneeId: user.id });
    mailer.sent.length = 0;
    expect(await sendInstantEmails(t.ctx, new Date(Date.now() + 3 * 60_000))).toBe(1);
    expect(mailer.sent[0]!.subject).toBe('Ada Admin heeft “Offerte maken” aan je toegewezen');
    expect(mailer.sent[0]!.html).toContain('lang="nl"');
    expect(mailer.sent[0]!.text).toContain('Je krijgt deze e-mails als er iets gebeurt.');
  });

  it('writes invitations in the inviting admin’s language', async () => {
    const mailer = new FakeMailer();
    const t = makeApp({ appUrl: 'https://projects.example.com' }, { mailer });
    const { admin } = await setupAdmin(t);
    admin.set('X-Client-Lang', 'nl');
    await admin.post('/api/users').send({ name: 'Nina Nieuw', email: 'nina@example.com', invite: 'email' }).expect(201);
    expect(mailer.sent.at(-1)!.subject).toBe('Ada Admin heeft je uitgenodigd voor Project Hub');
    expect(mailer.sent.at(-1)!.text).toContain('Hoi Nina,');
  });

  it('names new board columns, exports and the dashboard in the viewer’s language', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    admin.set('X-Client-Lang', 'nl');
    const p = await createProject(admin, { name: 'Website' });
    expect(p.columns.map((c) => c.name)).toEqual(['Te doen', 'Bezig', 'In review', 'Klaar']);
    await createTask(admin, p.id, { title: 'Ontwerp', priority: 'high' });
    const csv = await admin.get(`/api/projects/${p.id}/export.csv`).expect(200);
    expect(csv.text.split('\r\n')[0]).toContain('Titel,Kolom,Fase,Prioriteit,Toegewezen aan');
    expect(csv.text).toContain('Ontwerp,Te doen,Te doen,Hoog');
    const dashboard = await admin.get('/api/dashboard').expect(200);
    expect(dashboard.body.projects[0].healthReason).toBe('Geen deadline ingesteld');
  });

  it('tells the web app about a forced password change with a code, not just words', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const created = await admin.post('/api/users').send({ name: 'Tom', email: 'tom@example.com' }).expect(201);
    const tom = client(t.app).set('X-Client-Lang', 'nl');
    await tom.post('/api/auth/login').send({ email: 'tom@example.com', password: created.body.temporaryPassword }).expect(200);
    const res = await tom.get('/api/projects').expect(403);
    expect(res.body).toMatchObject({ code: 'password_change_required', error: 'Kies eerst een nieuw wachtwoord.' });
  });
});
