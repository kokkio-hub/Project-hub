import type { DB } from './db/index.js';
import { hashPassword } from './auth/password.js';
import { issueToken } from './auth/tokens.js';
import { logActivity } from './repos/activity.js';
import { insertChecklistItem } from './repos/checklist.js';
import { addDependency } from './repos/dependencies.js';
import { insertLabel, setTaskLabels } from './repos/labels.js';
import { insertProject } from './repos/projects.js';
import { insertUser } from './repos/users.js';
import { addDays, localToday } from '../shared/dates.js';
import type { ColorName, ProjectStatus, TaskPriority, TaskStatus, UserRole } from '../shared/types.js';

/**
 * Demo data for trying the app out: a small team, a handful of projects and
 * tasks spread around today's date. Never run this against a real workspace.
 */

export const DEMO_PASSWORD = 'demo1234';

type PersonKey = 'sanne' | 'liam' | 'priya' | 'tom' | 'emma' | 'noah';

const PEOPLE: { key: PersonKey; name: string; email: string; title: string; role: UserRole; color: ColorName }[] = [
  { key: 'sanne', name: 'Sanne de Vries', email: 'admin@example.com', title: 'Operations lead', role: 'admin', color: 'violet' },
  { key: 'liam', name: 'Liam Bakker', email: 'liam@example.com', title: 'Product manager', role: 'member', color: 'blue' },
  { key: 'priya', name: 'Priya Raman', email: 'priya@example.com', title: 'Lead developer', role: 'member', color: 'aqua' },
  { key: 'tom', name: 'Tom Jansen', email: 'tom@example.com', title: 'Designer', role: 'member', color: 'orange' },
  { key: 'emma', name: 'Emma Visser', email: 'emma@example.com', title: 'Marketing manager', role: 'member', color: 'magenta' },
  { key: 'noah', name: 'Noah Peters', email: 'noah@example.com', title: 'Developer', role: 'member', color: 'green' },
];

interface SeedTask {
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: PersonKey | null;
  /** Offsets in days from today. */
  start?: number;
  due?: number;
  /** Days ago the task was created / completed. */
  created: number;
  completed?: number;
  description?: string;
  comments?: [PersonKey, string, number][]; // author, text, hours ago
}

interface SeedProject {
  name: string;
  description: string;
  color: ColorName;
  status: ProjectStatus;
  owner: PersonKey;
  start: number;
  due: number;
  created: number;
  tasks: SeedTask[];
}

const PROJECTS: SeedProject[] = [
  {
    name: 'Website redesign',
    description: 'New marketing site with a refreshed brand, faster pages and a clearer sign-up flow.',
    color: 'blue',
    status: 'active',
    owner: 'liam',
    start: -35,
    due: 24,
    created: 38,
    tasks: [
      { title: 'Audit current site analytics', status: 'done', priority: 'medium', assignee: 'liam', start: -35, due: -30, created: 36, completed: 31 },
      { title: 'Interview five customers about the sign-up flow', status: 'done', priority: 'high', assignee: 'liam', start: -33, due: -24, created: 36, completed: 25 },
      { title: 'Moodboard and visual direction', status: 'done', priority: 'medium', assignee: 'tom', start: -30, due: -21, created: 34, completed: 20 },
      { title: 'Sitemap and page inventory', status: 'done', priority: 'medium', assignee: 'liam', start: -26, due: -19, created: 30, completed: 18 },
      {
        title: 'Homepage wireframes',
        status: 'done',
        priority: 'high',
        assignee: 'tom',
        start: -20,
        due: -12,
        created: 25,
        completed: 11,
        comments: [
          ['liam', 'Looks great. Can we move the customer logos above the fold?', 290],
          ['tom', 'Done, updated in the latest version.', 270],
        ],
      },
      {
        title: 'Design system: colours, type and components',
        status: 'review',
        priority: 'high',
        assignee: 'tom',
        start: -14,
        due: 2,
        created: 20,
        description: 'Tokens for colour, spacing and type, plus the button, input, card and navigation components.',
        comments: [['priya', 'Please export the tokens as CSS variables so we can use them directly.', 30]],
      },
      { title: 'Build page templates', status: 'in_progress', priority: 'high', assignee: 'priya', start: -6, due: 9, created: 15 },
      { title: 'Rewrite product page copy', status: 'in_progress', priority: 'medium', assignee: 'emma', start: -4, due: 6, created: 14 },
      { title: 'Set up redirects from old URLs', status: 'todo', priority: 'medium', assignee: 'noah', start: 10, due: 14, created: 10 },
      { title: 'Accessibility review', status: 'todo', priority: 'high', assignee: 'tom', start: 12, due: 17, created: 9 },
      { title: 'Performance budget and image optimisation', status: 'todo', priority: 'low', assignee: 'noah', start: 13, due: 19, created: 8 },
      { title: 'Launch checklist and go-live', status: 'todo', priority: 'urgent', assignee: 'liam', start: 21, due: 24, created: 7 },
    ],
  },
  {
    name: 'Mobile app v2',
    description: 'Offline mode, push notifications and a faster onboarding for the iOS and Android apps.',
    color: 'orange',
    status: 'active',
    owner: 'priya',
    start: -21,
    due: 45,
    created: 24,
    tasks: [
      { title: 'Technical spec for offline sync', status: 'done', priority: 'high', assignee: 'priya', start: -21, due: -14, created: 23, completed: 13 },
      { title: 'Choose push notification provider', status: 'done', priority: 'medium', assignee: 'noah', start: -18, due: -12, created: 22, completed: 12 },
      {
        title: 'Local database and sync engine',
        status: 'in_progress',
        priority: 'urgent',
        assignee: 'priya',
        start: -10,
        due: 8,
        created: 16,
        description: 'Store changes locally while offline and replay them when the connection returns. Last write wins per field.',
        comments: [
          ['noah', 'Conflict handling works in the prototype. Edge case: two edits to the same field within a second.', 50],
          ['priya', "Let's timestamp on the server for that case.", 46],
        ],
      },
      { title: 'Notification preferences screen', status: 'in_progress', priority: 'medium', assignee: 'noah', start: -3, due: 7, created: 12 },
      { title: 'New onboarding screens', status: 'todo', priority: 'high', assignee: 'tom', start: 5, due: 16, created: 11 },
      { title: 'Beta test with 20 customers', status: 'todo', priority: 'high', assignee: 'liam', start: 20, due: 32, created: 6 },
      { title: 'App store screenshots and listing', status: 'todo', priority: 'low', assignee: 'emma', start: 33, due: 40, created: 5 },
      { title: 'Release to stores', status: 'todo', priority: 'urgent', assignee: 'priya', due: 45, created: 5 },
      { title: 'Crash reporting dashboard', status: 'todo', priority: 'low', assignee: null, created: 3 },
    ],
  },
  {
    name: 'Autumn campaign',
    description: 'Email, social and paid campaign for the autumn release.',
    color: 'aqua',
    status: 'active',
    owner: 'emma',
    start: -12,
    due: 9,
    created: 15,
    tasks: [
      { title: 'Campaign brief and budget', status: 'done', priority: 'high', assignee: 'emma', start: -12, due: -9, created: 14, completed: 9 },
      { title: 'Landing page copy', status: 'done', priority: 'medium', assignee: 'emma', start: -9, due: -1, created: 12, completed: 0 },
      {
        title: 'Social media visuals',
        status: 'in_progress',
        priority: 'high',
        assignee: 'tom',
        start: -7,
        due: -2,
        created: 12,
        comments: [['emma', 'We need these by Friday at the latest for the scheduling tool.', 20]],
      },
      { title: 'Email sequence (3 emails)', status: 'review', priority: 'medium', assignee: 'emma', start: -5, due: -1, created: 10 },
      { title: 'Set up ad campaigns', status: 'todo', priority: 'high', assignee: 'emma', start: 1, due: 4, created: 8 },
      { title: 'Press release', status: 'todo', priority: 'medium', assignee: 'sanne', start: 2, due: 6, created: 7 },
      { title: 'Results report', status: 'todo', priority: 'low', assignee: 'emma', start: 12, due: 16, created: 5 },
    ],
  },
  {
    name: 'Customer portal',
    description: 'Self-service invoices, usage and team management for customers.',
    color: 'yellow',
    status: 'active',
    owner: 'sanne',
    start: -60,
    due: -2,
    created: 62,
    tasks: [
      { title: 'Requirements workshop', status: 'done', priority: 'high', assignee: 'sanne', start: -60, due: -55, created: 61, completed: 54 },
      { title: 'Invoice history page', status: 'done', priority: 'high', assignee: 'noah', start: -50, due: -38, created: 56, completed: 40 },
      { title: 'Usage charts', status: 'done', priority: 'medium', assignee: 'priya', start: -40, due: -26, created: 50, completed: 27 },
      { title: 'Team member invites', status: 'done', priority: 'medium', assignee: 'noah', start: -30, due: -18, created: 45, completed: 17 },
      { title: 'Single sign-on for portal users', status: 'done', priority: 'high', assignee: 'priya', start: -24, due: -2, created: 40, completed: 1 },
      { title: 'Help centre articles', status: 'done', priority: 'low', assignee: 'emma', start: -15, due: -6, created: 30, completed: 5 },
      { title: 'Security review', status: 'review', priority: 'urgent', assignee: 'sanne', start: -8, due: -3, created: 20 },
      { title: 'Announcement to customers', status: 'todo', priority: 'medium', assignee: 'emma', start: -3, due: -1, created: 12 },
    ],
  },
  {
    name: 'Hiring: two developers',
    description: 'Job posts, interviews and onboarding for two new developers.',
    color: 'magenta',
    status: 'on_hold',
    owner: 'sanne',
    start: -14,
    due: 60,
    created: 16,
    tasks: [
      { title: 'Write job descriptions', status: 'done', priority: 'medium', assignee: 'priya', start: -14, due: -10, created: 15, completed: 10 },
      { title: 'Post on job boards', status: 'todo', priority: 'medium', assignee: 'sanne', start: 20, due: 22, created: 9 },
      { title: 'Prepare technical interview', status: 'todo', priority: 'low', assignee: 'priya', start: 22, due: 30, created: 9 },
    ],
  },
  {
    name: 'Office move',
    description: 'Move to the new office on the canal.',
    color: 'green',
    status: 'completed',
    owner: 'sanne',
    start: -80,
    due: -40,
    created: 85,
    tasks: [
      { title: 'Sign the lease', status: 'done', priority: 'urgent', assignee: 'sanne', start: -80, due: -75, created: 84, completed: 75 },
      { title: 'Order furniture', status: 'done', priority: 'medium', assignee: 'sanne', start: -70, due: -55, created: 80, completed: 56 },
      { title: 'Network and Wi-Fi setup', status: 'done', priority: 'high', assignee: 'noah', start: -50, due: -43, created: 70, completed: 44 },
      { title: 'Moving day', status: 'done', priority: 'high', assignee: 'sanne', start: -41, due: -40, created: 60, completed: 40 },
    ],
  },
];

/** How long ago each person last signed in, so the Team page looks lived-in. */
const LAST_SIGN_IN_HOURS: Record<PersonKey, number> = { sanne: 20, liam: 2, priya: 5, tom: 27, emma: 50, noah: 76 };

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** A timestamp `days` ago during working hours, so demo history looks natural (never in the future). */
function daysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, (days * 17) % 60, 0, 0);
  const latest = Date.now() - 30 * 60_000;
  return new Date(Math.min(d.getTime(), latest)).toISOString();
}

export async function seedDemo(db: DB): Promise<{ users: number; invitations: number; projects: number; tasks: number }> {
  const today = localToday();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids = {} as Record<PersonKey, number>;

  let taskCount = 0;
  const run = db.transaction(() => {
    for (const person of PEOPLE) {
      const user = insertUser(db, { ...person, passwordHash, mustChangePassword: false });
      db.prepare('UPDATE users SET created_at = ?, updated_at = ?, last_login_at = ? WHERE id = ?').run(
        daysAgo(90),
        daysAgo(90),
        hoursAgo(LAST_SIGN_IN_HOURS[person.key]),
        user.id,
      );
      ids[person.key] = user.id;
    }

    // Someone who was invited yesterday and hasn't joined yet.
    const invited = insertUser(db, {
      name: 'Fatima el Amrani',
      email: 'fatima@example.com',
      title: 'QA engineer',
      role: 'member',
      color: 'yellow',
      passwordHash: '',
      mustChangePassword: false,
    });
    const invitedAt = daysAgo(1, 15);
    db.prepare('UPDATE users SET created_at = ?, updated_at = ? WHERE id = ?').run(invitedAt, invitedAt, invited.id);
    issueToken(db, { userId: invited.id, purpose: 'invite', ttlMs: 6 * 86_400_000, createdBy: ids.sanne });
    db.prepare("UPDATE user_tokens SET created_at = ?, emailed_at = ? WHERE user_id = ? AND purpose = 'invite'").run(
      invitedAt,
      invitedAt,
      invited.id,
    );

    const insertTask = db.prepare(
      `INSERT INTO tasks (project_id, column_id, title, description, status, priority, assignee_id, start_date, due_date,
                          position, created_by, created_at, updated_at, completed_at)
       VALUES (@projectId,
               (SELECT id FROM project_columns WHERE project_id = @projectId AND stage = @status ORDER BY position LIMIT 1),
               @title, @description, @status, @priority, @assigneeId, @startDate, @dueDate,
               @position, @createdBy, @createdAt, @updatedAt, @completedAt)`,
    );
    const insertComment = db.prepare(
      'INSERT INTO comments (task_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );

    for (const project of PROJECTS) {
      const ownerId = ids[project.owner];
      const projectId = insertProject(db, {
        name: project.name,
        description: project.description,
        color: project.color,
        status: project.status,
        startDate: addDays(today, project.start),
        dueDate: addDays(today, project.due),
        ownerId,
        createdBy: ownerId,
      });
      db.prepare('UPDATE projects SET created_at = ?, updated_at = ? WHERE id = ?').run(
        daysAgo(project.created, 9),
        daysAgo(Math.min(project.created, 2), 9),
        projectId,
      );
      logActivity(db, { type: 'project.created', userId: ownerId, projectId, data: { projectName: project.name } }, daysAgo(project.created, 9));

      const positions: Record<TaskStatus, number> = { todo: 0, in_progress: 0, review: 0, done: 0 };
      project.tasks.forEach((task, index) => {
        const createdAt = daysAgo(task.created, 9 + (index % 7));
        const completedAt = task.completed !== undefined ? daysAgo(task.completed, 11 + (index % 6)) : null;
        const assigneeId = task.assignee ? ids[task.assignee] : null;
        const result = insertTask.run({
          projectId,
          title: task.title,
          description: task.description ?? '',
          status: task.status,
          priority: task.priority,
          assigneeId,
          startDate: task.start !== undefined ? addDays(today, task.start) : null,
          dueDate: task.due !== undefined ? addDays(today, task.due) : null,
          position: positions[task.status]++,
          createdBy: ownerId,
          createdAt,
          updatedAt: completedAt ?? createdAt,
          completedAt,
        });
        const taskId = Number(result.lastInsertRowid);
        taskCount++;
        const snapshot = { taskTitle: task.title, projectName: project.name };
        logActivity(db, { type: 'task.created', userId: ownerId, projectId, taskId, data: snapshot }, createdAt);
        if (task.status !== 'todo') {
          const startedAt = completedAt
            ? new Date(Math.max(Date.parse(createdAt), Date.parse(completedAt) - 3 * 86_400_000)).toISOString()
            : daysAgo(Math.max(0, Math.min(task.created - 1, 3)), 14);
          logActivity(
            db,
            { type: 'task.status', userId: assigneeId ?? ownerId, projectId, taskId, data: { ...snapshot, from: 'todo', to: 'in_progress' } },
            startedAt,
          );
        }
        if (task.status === 'review') {
          logActivity(
            db,
            { type: 'task.status', userId: assigneeId ?? ownerId, projectId, taskId, data: { ...snapshot, from: 'in_progress', to: 'review' } },
            hoursAgo(20 + index),
          );
        }
        if (completedAt) {
          logActivity(
            db,
            { type: 'task.status', userId: assigneeId ?? ownerId, projectId, taskId, data: { ...snapshot, from: 'review', to: 'done' } },
            completedAt,
          );
        }
        for (const [author, body, ago] of task.comments ?? []) {
          insertComment.run(taskId, ids[author], body, hoursAgo(ago), hoursAgo(ago));
          logActivity(
            db,
            { type: 'comment.created', userId: ids[author], projectId, taskId, data: { ...snapshot, excerpt: body } },
            hoursAgo(ago),
          );
        }
      });
    }
    addExtras(db, ids, today);
  });
  run();
  return { users: PEOPLE.length, invitations: 1, projects: PROJECTS.length + 1, tasks: taskCount };
}

/** Labels, checklists, dependencies, a repeating task and a template, so every feature has something to show. */
function addExtras(db: DB, ids: Record<PersonKey, number>, today: string) {
  const projectId = (name: string) => (db.prepare('SELECT id FROM projects WHERE name = ?').get(name) as { id: number }).id;
  const taskId = (title: string) => (db.prepare('SELECT id FROM tasks WHERE title = ?').get(title) as { id: number } | undefined)?.id;

  const web = projectId('Website redesign');
  const design = insertLabel(db, web, 'Design', 'violet').id;
  const content = insertLabel(db, web, 'Content', 'orange').id;
  const dev = insertLabel(db, web, 'Development', 'aqua').id;
  const labelled: [string, number[]][] = [
    ['Moodboard and visual direction', [design]],
    ['Homepage wireframes', [design]],
    ['Design system: colours, type and components', [design, dev]],
    ['Build page templates', [dev]],
    ['Rewrite product page copy', [content]],
    ['Set up redirects from old URLs', [dev]],
    ['Accessibility review', [design, dev]],
    ['Performance budget and image optimisation', [dev]],
  ];
  for (const [title, labels] of labelled) {
    const id = taskId(title);
    if (id) setTaskLabels(db, id, labels);
  }

  const checklists: [string, [string, boolean][]][] = [
    [
      'Build page templates',
      [
        ['Home', true],
        ['Product', true],
        ['Pricing', false],
        ['Blog index and article', false],
        ['Contact', false],
      ],
    ],
    [
      'Launch checklist and go-live',
      [
        ['Freeze content', false],
        ['Check every redirect', false],
        ['Switch DNS', false],
        ['Announce the new site', false],
      ],
    ],
  ];
  for (const [title, items] of checklists) {
    const id = taskId(title);
    if (!id) continue;
    for (const [body, done] of items) insertChecklistItem(db, id, body, ids.priya, done);
  }

  const deps: [string, string][] = [
    ['Build page templates', 'Accessibility review'],
    ['Accessibility review', 'Launch checklist and go-live'],
    ['Set up redirects from old URLs', 'Launch checklist and go-live'],
  ];
  for (const [blocker, blocked] of deps) {
    const a = taskId(blocker);
    const b = taskId(blocked);
    if (a && b) addDependency(db, a, b, ids.liam);
  }

  // A weekly task: finishing it creates next week's.
  db.prepare(
      `INSERT INTO tasks (project_id, column_id, title, description, status, priority, assignee_id, due_date, position,
                          created_by, created_at, updated_at, recurrence, recurrence_interval)
       VALUES (@projectId, (SELECT id FROM project_columns WHERE project_id = @projectId AND stage = 'todo' ORDER BY position LIMIT 1),
               'Weekly status update', 'Send the team a short update: done, next, blocked.', 'todo', 'medium', @assignee, @due,
               99, @assignee, @now, @now, 'weekly', 1)`,
  ).run({ projectId: web, assignee: ids.liam, due: addDays(today, 2), now: new Date().toISOString() });

  // A template to start new projects from.
  const template = insertProject(db, {
    name: 'Client website (template)',
    description: 'Our standard plan for a small business website: kick-off, design, build and launch.',
    color: 'blue',
    status: 'active',
    isTemplate: true,
    startDate: today,
    dueDate: addDays(today, 34),
    ownerId: ids.sanne,
    createdBy: ids.sanne,
  });
  const steps: [string, number, number][] = [
    ['Kick-off call with the client', 0, 0],
    ['Collect logo, photos and copy', 1, 7],
    ['Sitemap and wireframes', 5, 12],
    ['Visual design', 12, 19],
    ['Build the site', 19, 30],
    ['Client review and changes', 28, 32],
    ['Launch and hand-over', 33, 34],
  ];
  const insert = db.prepare(
    `INSERT INTO tasks (project_id, column_id, title, status, priority, start_date, due_date, position, created_by, created_at, updated_at)
     VALUES (@projectId, (SELECT id FROM project_columns WHERE project_id = @projectId AND stage = 'todo' ORDER BY position LIMIT 1),
             @title, 'todo', 'medium', @start, @due, @position, @createdBy, @now, @now)`,
  );
  let previous: number | null = null;
  steps.forEach(([title, start, due], position) => {
    const id = Number(
      insert.run({
        projectId: template,
        title,
        start: start === due ? null : addDays(today, start),
        due: addDays(today, due),
        position,
        createdBy: ids.sanne,
        now: new Date().toISOString(),
      }).lastInsertRowid,
    );
    if (previous) addDependency(db, previous, id, ids.sanne);
    previous = id;
  });
}
