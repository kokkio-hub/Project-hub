import { createApp } from './app.js';
import { bootstrapAdmin } from './bootstrap.js';
import { loadConfig, loadEnvFile } from './config.js';
import { openDatabase } from './db/index.js';
import { createMailer } from './lib/mailer.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { purgeExpiredTokens } from './auth/tokens.js';
import { countUsers } from './repos/users.js';

loadEnvFile();
const config = loadConfig();
const db = openDatabase(config.databasePath);
await bootstrapAdmin(db, config);

const purge = () => {
  purgeExpiredSessions(db);
  purgeExpiredTokens(db);
};
purge();
setInterval(purge, 60 * 60 * 1000).unref();

const mailer = createMailer(config);
const { app, ctx } = createApp({ db, config, mailer });

const server = app.listen(config.port, config.host, () => {
  const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  console.log(`${config.appName} is running at http://${shownHost}:${config.port}`);
  console.log(`Database: ${config.databasePath}`);
  if (countUsers(db) === 0) {
    console.log('No accounts yet: open the app in your browser now to create the admin account.');
  }
  checkEmail();
});

/** Reports at startup whether email will work, so a wrong password shows up in the logs right away. */
function checkEmail() {
  if (!mailer.enabled) {
    console.log('Email: not set up (optional). Invitations can still be shared as links; see "Email" in the README.');
    return;
  }
  if (!config.appUrl) {
    console.warn(
      'Email: set APP_URL to the address people use to open the app (e.g. https://projects.example.com). ' +
        'Links in emails use it, and "Forgot password?" stays off until it is set.',
    );
  }
  mailer.verify().then(
    () => console.log(`Email: ready (${mailer.description}).`),
    (error: Error) => console.warn(`Email: ${error.message} Emails won't arrive until this is fixed.`),
  );
}

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  ctx.events.closeAll();
  server.close(() => {
    // Let emails that are still being sent finish first.
    void ctx.jobs.idle().finally(() => {
      db.close();
      process.exit(0);
    });
  });
  server.closeIdleConnections();
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
