import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { loadConfig, loadEnvFile, type Config } from './config.js';
import { openDatabase, type DB } from './db/index.js';
import { testEmail } from './lib/emails.js';
import { createMailer } from './lib/mailer.js';
import { generateTemporaryPassword, hashPassword } from './auth/password.js';
import { deleteUserSessions } from './auth/sessions.js';
import { deleteUserTokens } from './auth/tokens.js';
import { countUsers, getUserByEmail, insertUser, listUsers, updateUser } from './repos/users.js';
import { DEMO_PASSWORD, seedDemo } from './seed.js';
import { Backups } from './services/backup.js';
import { PASSWORD_MIN_LENGTH, USER_ROLES, type UserRole } from '../shared/types.js';

const HELP = `
Project Hub command-line tools

Usage: npm run cli -- <command> [options]
  (inside Docker: docker compose exec app node dist/server/cli.js <command> [options])

Commands:
  create-user     --email <email> --name <name> [--role admin|member|guest] [--password <password>]
                  Adds an account. Without --password a temporary password is printed,
                  which the person must change when they first sign in.
  reset-password  --email <email> [--password <password>]
                  Sets a new password and signs the person out everywhere. Use this if
                  the only admin is locked out.
  list-users      Shows all accounts.
  backup          [--out <file>] [--remote]
                  Writes a consistent copy of the database (safe while the app runs).
                  Default: backups/project-hub-<date-time>.db next to the database.
                  With --remote: uploads a backup to the backup bucket now (BACKUP_S3_*).
  list-remote-backups
                  Lists the database backups in the backup bucket, newest first.
  download-backup --key <name> [--out <file>]
                  Downloads (and unzips) a database backup from the bucket, for restoring.
  disable-2fa     --email <email>
                  Turns off two-factor sign-in for someone who lost their phone and codes.
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
  if (!USER_ROLES.includes(role)) fail('--role must be "admin", "member" or "guest".');
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

async function remoteBackup(db: DB, config: Config) {
  const backups = new Backups(db, config);
  if (!backups.client) fail('No backup bucket is set up. Set BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY.');
  console.log(`Backing up to ${backups.client.description}...`);
  const result = await backups.run().catch((error: Error) => fail(error.message));
  console.log(`Uploaded ${result.key} (${Math.round(result.size / 1024)} KB), ${result.attachments} new attachments, removed ${result.removed} old copies.`);
}

async function listRemoteBackups(db: DB, config: Config) {
  const backups = new Backups(db, config);
  if (!backups.client) fail('No backup bucket is set up (BACKUP_S3_*).');
  const copies = await backups.listDatabaseCopies().catch((error: Error) => fail(error.message));
  if (copies.length === 0) {
    console.log('No backups in the bucket yet.');
    return;
  }
  console.table(copies.map((c) => ({ key: c.key, size: `${Math.round(c.size / 1024)} KB`, uploaded: c.lastModified })));
}

async function downloadBackup(db: DB, config: Config, values: Record<string, unknown>) {
  const key = requireOption(values, 'key');
  const backups = new Backups(db, config);
  if (!backups.client) fail('No backup bucket is set up (BACKUP_S3_*).');
  const out = path.resolve(typeof values.out === 'string' && values.out.trim() ? values.out.trim() : path.basename(key).replace(/\.gz$/, ''));
  if (fs.existsSync(out)) fail(`${out} already exists.`);
  const body = await backups.client.get(key).catch((error: Error) => fail(error.message));
  fs.writeFileSync(out, key.endsWith('.gz') ? gunzipSync(body) : body);
  console.log(`Saved ${out}.`);
  console.log('To restore: stop the app, replace the database file (DATABASE_PATH) with this file, and start the app again.');
}

function disableTwoFactor(db: DB, values: Record<string, unknown>) {
  const email = requireOption(values, 'email');
  const user = getUserByEmail(db, email);
  if (!user) fail(`No account found for ${email}.`);
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
  console.log(`Two-factor sign-in is now off for ${user.name} <${user.email}>.`);
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
      twoFactor: u.totp_secret ? 'on' : '',
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
      key: { type: 'string' },
      remote: { type: 'boolean' },
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
        if (values.remote) await remoteBackup(db, config);
        else await backup(db, config.databasePath, values);
        break;
      case 'list-remote-backups':
        await listRemoteBackups(db, config);
        break;
      case 'download-backup':
        await downloadBackup(db, config, values);
        break;
      case 'disable-2fa':
        disableTwoFactor(db, values);
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
