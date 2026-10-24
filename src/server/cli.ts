import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, loadEnvFile, type Config } from './config.js';
import { openDatabase, type DB } from './db/index.js';
import { testEmail } from './lib/emails.js';
import { createMailer } from './lib/mailer.js';
import { generateTemporaryPassword, hashPassword } from './auth/password.js';
import { deleteUserSessions } from './auth/sessions.js';
import { deleteUserTokens } from './auth/tokens.js';
import { countUsers, getUserByEmail, insertUser, listUsers, updateUser } from './repos/users.js';
import { DEMO_PASSWORD, seedDemo } from './seed.js';
import { PASSWORD_MIN_LENGTH, USER_ROLES, type UserRole } from '../shared/types.js';

const HELP = `
Project Hub command-line tools

Usage: npm run cli -- <command> [options]
  (inside Docker: docker compose exec app node dist/server/cli.js <command> [options])

Commands:
  create-user     --email <email> --name <name> [--role admin|member] [--password <password>]
                  Adds an account. Without --password a temporary password is printed,
                  which the person must change when they first sign in.
  reset-password  --email <email> [--password <password>]
                  Sets a new password and signs the person out everywhere. Use this if
                  the only admin is locked out.
  list-users      Shows all accounts.
  backup          [--out <file>]
                  Writes a consistent copy of the database (safe while the app runs).
                  Default: backups/project-hub-<date-time>.db next to the database.
  send-test-email --to <email>
                  Checks the email settings (RESEND_API_KEY or SMTP_...) by sending a test message.
  seed-demo       Fills an EMPTY database with a demo team, projects and tasks.
`;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function requireOption(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') fail(`--${name} is required.`);
  return value.trim();
}

function checkPassword(password: string | undefined): void {
  if (password !== undefined && password.length < PASSWORD_MIN_LENGTH) {
    fail(`Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
}

async function createUser(db: DB, values: Record<string, unknown>) {
  const email = requireOption(values, 'email').toLowerCase();
  const name = requireOption(values, 'name');
  const role = (typeof values.role === 'string' ? values.role : 'member') as UserRole;
  if (!USER_ROLES.includes(role)) fail('--role must be "admin" or "member".');
  const password = typeof values.password === 'string' ? values.password : undefined;
  checkPassword(password);
  if (getUserByEmail(db, email)) fail(`An account for ${email} already exists.`);

  const temporary = password ?? generateTemporaryPassword();
  insertUser(db, { email, name, role, passwordHash: await hashPassword(temporary), mustChangePassword: !password });
  console.log(`Created ${role} account for ${name} <${email}>.`);
  if (!password) console.log(`Temporary password: ${temporary}\n(They will be asked to choose a new one when they sign in.)`);
}

async function resetPassword(db: DB, values: Record<string, unknown>) {
  const email = requireOption(values, 'email');
  const user = getUserByEmail(db, email);
  if (!user) fail(`No account found for ${email}.`);
  const password = typeof values.password === 'string' ? values.password : undefined;
  checkPassword(password);

  const next = password ?? generateTemporaryPassword();
  updateUser(db, user.id, { passwordHash: await hashPassword(next), mustChangePassword: !password, isActive: true });
  deleteUserSessions(db, user.id);
  deleteUserTokens(db, user.id);
  console.log(`Password reset for ${user.name} <${user.email}>. The account is active and signed out everywhere.`);
  if (!password) console.log(`Temporary password: ${next}`);
}

async function backup(db: DB, databasePath: string, values: Record<string, unknown>) {
  if (databasePath === ':memory:') fail('There is nothing to back up for an in-memory database.');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const out = path.resolve(
    typeof values.out === 'string' && values.out.trim()
      ? values.out.trim()
      : path.join(path.dirname(databasePath), 'backups', `project-hub-${stamp}.db`),
  );
  if (fs.existsSync(out)) fail(`${out} already exists.`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await db.backup(out);
  console.log(`Backup written to ${out}`);
}

async function sendTestEmail(config: Config, values: Record<string, unknown>) {
  const to = requireOption(values, 'to');
  const mailer = createMailer(config);
  if (!mailer.enabled) {
    fail('Email is not set up. Set RESEND_API_KEY, or SMTP_HOST (usually with SMTP_USER and SMTP_PASSWORD), plus MAIL_FROM first.');
  }
  console.log(`Connecting to ${mailer.description}...`);
  try {
    await mailer.verify();
    await mailer.send({ to, ...testEmail(config.appName) });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  console.log(`Sent a test email to ${to}. If it hasn't arrived in a few minutes, check the spam folder.`);
  if (!config.appUrl) console.log('Tip: also set APP_URL, so links in invitations point to the right address.');
}

function printUsers(db: DB) {
  const users = listUsers(db);
  if (users.length === 0) {
    console.log('No accounts yet. Open the web app to create the first admin, or use create-user.');
    return;
  }
  console.table(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.is_active !== 1 ? 'deactivated' : u.password_hash === '' ? 'invited' : 'active',
      lastLogin: u.last_login_at ?? '-',
    })),
  );
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      password: { type: 'string' },
      out: { type: 'string' },
      to: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  loadEnvFile();
  const config = loadConfig();
  if (command === 'send-test-email') {
    await sendTestEmail(config, values);
    return;
  }
  const db = openDatabase(config.databasePath);
  try {
    switch (command) {
      case 'create-user':
        await createUser(db, values);
        break;
      case 'reset-password':
        await resetPassword(db, values);
        break;
      case 'list-users':
        printUsers(db);
        break;
      case 'backup':
        await backup(db, config.databasePath, values);
        break;
      case 'seed-demo': {
        if (countUsers(db) > 0) fail('The database already has accounts. seed-demo only runs on an empty database.');
        const result = await seedDemo(db);
        console.log(
          `Added ${result.users} people, ${result.invitations} open invitation, ${result.projects} projects and ${result.tasks} tasks.`,
        );
        console.log(`Sign in as admin@example.com (admin) or liam@example.com (member), password: ${DEMO_PASSWORD}`);
        break;
      }
      default:
        console.log(HELP);
        fail(`Unknown command "${command}".`);
    }
  } finally {
    db.close();
  }
}

await main();
