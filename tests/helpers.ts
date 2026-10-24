import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { loadConfig, type Config } from '../src/server/config.js';
import { openDatabase } from '../src/server/db/index.js';
import { MailError, type Mailer, type MailMessage } from '../src/server/lib/mailer.js';
import type { Project, Task, User } from '../src/shared/types.js';

export const TODAY = '2026-06-10'; // a Wednesday

/** Records emails instead of sending them. Set `failWith` to simulate a mail server problem. */
export class FakeMailer implements Mailer {
  readonly enabled = true;
  readonly description = 'test mail server';
  readonly sent: MailMessage[] = [];
  failWith: string | null = null;

  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw new MailError(this.failWith);
    this.sent.push(message);
  }

  async verify(): Promise<void> {}

  /** The link in an email (the latest one by default). */
  link(index = this.sent.length - 1): string {
    const match = this.sent[index]?.text.match(/https?:\/\/\S+#[\w-]+/);
    if (!match) throw new Error('No link found in the email');
    return match[0];
  }

  /** The secret token in an email's link. */
  token(index?: number): string {
    return tokenOf(this.link(index));
  }
}

export function tokenOf(link: string): string {
  return link.slice(link.indexOf('#') + 1);
}

export function makeApp(overrides: Partial<Config> = {}, options: { mailer?: Mailer; backupFetch?: typeof fetch } = {}) {
  const config: Config = {
    ...loadConfig({ NODE_ENV: 'test' }),
    databasePath: ':memory:',
    clientDir: '/nonexistent',
    loginRateLimit: 1000,
    attachmentsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'project-hub-test-')),
    ...overrides,
  };
  const db = openDatabase(':memory:');
  const { app, ctx } = createApp({ db, config, mailer: options.mailer, backupFetch: options.backupFetch });
  return { app, db, ctx, config };
}

export type TestApp = ReturnType<typeof makeApp>;

/** A cookie-keeping client that sends the headers the web app always sends. */
export function client(app: TestApp['app'], today = TODAY) {
  return request
    .agent(app)
    .set('X-Requested-With', 'test')
    .set('X-Client-Date', today)
    .set('X-Client-Tz-Offset', '0');
}

export type Client = ReturnType<typeof client>;

export const ADMIN = { name: 'Ada Admin', email: 'ada@example.com', password: 'admin-password-1' };

/** Runs first-run setup and returns a signed-in admin client. */
export async function setupAdmin(t: TestApp): Promise<{ admin: Client; adminUser: User }> {
  const admin = client(t.app);
  const res = await admin.post('/api/auth/setup').send(ADMIN).expect(201);
  return { admin, adminUser: res.body.user as User };
}

/** Admin creates an account; the new person signs in and replaces the temporary password. */
export async function addMember(
  t: TestApp,
  admin: Client,
  person: { name: string; email: string; role?: 'admin' | 'member' | 'guest' },
  password = 'member-password-1',
): Promise<{ agent: Client; user: User }> {
  const created = await admin.post('/api/users').send(person).expect(201);
  const agent = client(t.app);
  await agent.post('/api/auth/login').send({ email: person.email, password: created.body.temporaryPassword }).expect(200);
  await agent
    .post('/api/auth/password')
    .send({ currentPassword: created.body.temporaryPassword, newPassword: password })
    .expect(200);
  return { agent, user: created.body.user as User };
}

export async function createProject(agent: Client, body: Record<string, unknown> = {}) {
  const res = await agent.post('/api/projects').send({ name: 'Launch', ...body }).expect(201);
  return res.body.project as Project;
}

export async function createTask(agent: Client, projectId: number, body: Record<string, unknown> = {}) {
  const res = await agent.post('/api/tasks').send({ projectId, title: 'Task', ...body }).expect(201);
  return res.body.task as Task;
}

/** A person who joined with a password (not invited by link), signed in. */
export async function addPerson(t: TestApp, admin: Client, name: string, role: 'admin' | 'member' | 'guest' = 'member') {
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
  return addMember(t, admin, { name, email, role });
}
