import { describe, expect, it } from 'vitest';
import { findMentions, splitMentions } from '../src/shared/notifications.js';
import type { Notification } from '../src/shared/types.js';
import { createDueReminders, sendDailyDigests, sendInstantEmails } from '../src/server/services/notify.js';
import { addPerson, createProject, createTask, FakeMailer, makeApp, setupAdmin, type Client } from './helpers.js';

async function inbox(agent: Client) {
  const res = await agent.get('/api/notifications').expect(200);
  return res.body as { notifications: Notification[]; unread: number };
}

describe('mentions', () => {
  const people = [
    { id: 1, name: 'Liam Bakker' },
    { id: 2, name: 'Priya Raman' },
    { id: 3, name: 'Liam de Vries' },
    { id: 4, name: 'Tom' },
  ];

  it('finds full names, and first names that are unique', () => {
    expect(findMentions('Thanks @liam bakker!', people).map((p) => p.id)).toEqual([1]);
    expect(findMentions('@Priya can you look?', people).map((p) => p.id)).toEqual([2]);
    expect(findMentions('@Liam ping', people)).toEqual([]); // two Liams
    expect(findMentions('mail me at tom@example.com', people)).toEqual([]);
    expect(findMentions('@Tom, @Tommy', people).map((p) => p.id)).toEqual([4]);
  });

  it('splits text into mentions for highlighting', () => {
    expect(splitMentions('Hi @Priya Raman and @Tom.', people)).toEqual([
      { text: 'Hi ' },
      { text: '@Priya Raman', person: people[1] },
      { text: ' and ' },
      { text: '@Tom', person: people[3] },
      { text: '.' },
    ]);
  });
});

describe('notifications', () => {
  it('tell people when they are assigned, mentioned or a task they follow gets a comment', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const { agent: liam, user: liamUser } = await addPerson(t, admin, 'Liam Bakker');
    const { agent: priya, user: priyaUser } = await addPerson(t, admin, 'Priya Raman');
    const p = await createProject(admin);
    const task = await createTask(admin, p.id, { title: 'Wireframes', assigneeId: liamUser.id });

    let liamBox = await inbox(liam);
    expect(liamBox.unread).toBe(1);
    expect(liamBox.notifications[0]).toMatchObject({ type: 'assigned', actorId: adminUser.id, taskId: task.id, data: { taskTitle: 'Wireframes' } });

    // Priya mentions admin; Liam follows the task as its assignee.
    await priya.post(`/api/tasks/${task.id}/comments`).send({ body: '@Ada Admin can you check this?' }).expect(201);
    expect((await inbox(admin)).notifications.map((n) => n.type)).toEqual(['mentioned']);
    liamBox = await inbox(liam);
    expect(liamBox.notifications.map((n) => n.type)).toEqual(['commented', 'assigned']);
    expect(liamBox.notifications[0]!.data.excerpt).toBe('@Ada Admin can you check this?');

    // Nobody hears about their own actions.
    await liam.post(`/api/tasks/${task.id}/comments`).send({ body: 'On it' }).expect(201);
    expect((await inbox(liam)).notifications).toHaveLength(2);
    expect((await inbox(priya)).notifications.map((n) => n.type)).toEqual(['commented']);

    // Reading them.
    await liam.post('/api/notifications/read').send({ taskId: task.id }).expect(200);
    expect((await inbox(liam)).unread).toBe(0);
    await priya.post('/api/notifications/read').send({ all: true }).expect(200);
    expect((await inbox(priya)).unread).toBe(0);
    expect(priyaUser.id).toBeGreaterThan(0);
  });

  it('tell the creator when a task is finished and the next person when they are unblocked', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: dev, user: devUser } = await addPerson(t, admin, 'Dev Person');
    const { agent: qa, user: qaUser } = await addPerson(t, admin, 'Qa Person');
    const p = await createProject(admin);
    const build = await createTask(admin, p.id, { title: 'Build', assigneeId: devUser.id });
    const test = await createTask(admin, p.id, { title: 'Test', assigneeId: qaUser.id });
    await admin.post(`/api/tasks/${test.id}/blockers`).send({ blockerId: build.id }).expect(201);
    await dev.post(`/api/tasks/${build.id}/move`).send({ status: 'done', afterId: null }).expect(200);

    expect((await inbox(admin)).notifications.map((n) => n.type)).toEqual(['completed']);
    expect((await inbox(qa)).notifications.map((n) => [n.type, n.data.taskTitle])).toEqual([
      ['unblocked', 'Test'],
      ['assigned', 'Test'],
    ]);
  });

  it('hide notifications about things that were deleted or made private', async () => {
    const t = makeApp();
    const { admin } = await setupAdmin(t);
    const { agent: member, user } = await addPerson(t, admin, 'Mia Member');
    const p = await createProject(admin);
    const task = await createTask(admin, p.id, { assigneeId: user.id });
    expect((await inbox(member)).unread).toBe(1);
    await admin.delete(`/api/tasks/${task.id}`).expect(204);
    expect((await inbox(member)).unread).toBe(0);
  });

  it('send "due tomorrow" reminders once', async () => {
    const t = makeApp();
    const { admin, adminUser } = await setupAdmin(t);
    const p = await createProject(admin);
    await createTask(admin, p.id, { title: 'Due soon', assigneeId: adminUser.id, dueDate: '2026-06-11' });
    await createTask(admin, p.id, { title: 'Later', assigneeId: adminUser.id, dueDate: '2026-06-20' });
    const now = new Date('2026-06-10T09:00:00Z');
    expect(createDueReminders(t.ctx, now)).toBe(1);
    expect(createDueReminders(t.ctx, now)).toBe(0);
    const box = await inbox(admin);
    expect(box.notifications.find((n) => n.type === 'due_soon')).toMatchObject({ data: { taskTitle: 'Due soon', dueDate: '2026-06-11' } });
  });
});

describe('notification emails', () => {
  it('email people who want them right away, a few minutes later, in one message', async () => {
    const mailer = new FakeMailer();
    const t = makeApp({ appUrl: 'https://projects.example.com' }, { mailer });
    const { admin } = await setupAdmin(t);
    const { agent: member, user } = await addPerson(t, admin, 'Mia Member');
    await member.patch('/api/auth/me').send({ notifyEmail: 'instant' }).expect(200);
    const p = await createProject(admin);
    await createTask(admin, p.id, { title: 'First', assigneeId: user.id });
    await createTask(admin, p.id, { title: 'Second', assigneeId: user.id });
    mailer.sent.length = 0;

    expect(await sendInstantEmails(t.ctx, new Date())).toBe(0); // too fresh: they may still read it in the app
    expect(await sendInstantEmails(t.ctx, new Date(Date.now() + 3 * 60_000))).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('mia.member@example.com');
    expect(mailer.sent[0]!.subject).toBe('2 new notifications in Project Hub');
    expect(mailer.sent[0]!.text).toContain(`https://projects.example.com/projects/${p.id}?task=`);
    expect(await sendInstantEmails(t.ctx, new Date(Date.now() + 10 * 60_000))).toBe(0); // already sent
  });

  it('send the daily email from 8:00 local time with due and overdue work', async () => {
    const mailer = new FakeMailer();
    const t = makeApp({ appUrl: 'https://projects.example.com' }, { mailer });
    const { admin, adminUser } = await setupAdmin(t);
    const p = await createProject(admin);
    await createTask(admin, p.id, { title: 'Late one', assigneeId: adminUser.id, dueDate: '2026-06-08' });
    await createTask(admin, p.id, { title: 'Today one', assigneeId: adminUser.id, dueDate: '2026-06-10' });
    t.db.prepare('UPDATE users SET tz_offset_minutes = 120 WHERE id = ?').run(adminUser.id); // Amsterdam in summer

    expect(await sendDailyDigests(t.ctx, new Date('2026-06-10T05:30:00Z'))).toBe(0); // 07:30 there
    expect(await sendDailyDigests(t.ctx, new Date('2026-06-10T06:05:00Z'))).toBe(1); // 08:05 there
    expect(mailer.sent[0]!.subject).toBe('Your day in Project Hub');
    expect(mailer.sent[0]!.text).toMatch(/OVERDUE[\s\S]*Late one[\s\S]*DUE TODAY[\s\S]*Today one/);
    expect(await sendDailyDigests(t.ctx, new Date('2026-06-10T10:00:00Z'))).toBe(0); // once a day
  });

  it('send nothing without APP_URL, or when someone turned emails off', async () => {
    const mailer = new FakeMailer();
    const t = makeApp({}, { mailer });
    const { admin, adminUser } = await setupAdmin(t);
    await admin.patch('/api/auth/me').send({ notifyEmail: 'off' }).expect(200);
    const p = await createProject(admin);
    await createTask(admin, p.id, { assigneeId: adminUser.id, dueDate: '2026-06-01' });
    expect(await sendDailyDigests(t.ctx, new Date('2026-06-10T12:00:00Z'))).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });
});
