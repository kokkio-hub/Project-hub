import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import type { DB } from './db/index.js';
import { errorHandler } from './lib/errors.js';
import { EventHub } from './lib/events.js';
import { BackgroundJobs } from './lib/jobs.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { authenticate, clientClock, clientLanguage, requireCustomHeader } from './auth/middleware.js';
import { authRouter } from './routes/auth.js';
import { commentsRouter, taskCommentsRouter } from './routes/comments.js';
import { miscRouter } from './routes/misc.js';
import { columnsRouter, labelsRouter, projectsRouter } from './routes/projects.js';
import { attachmentsRouter, checklistRouter, taskDetailsRouter } from './routes/taskDetails.js';
import { tasksRouter } from './routes/tasks.js';
import { usersRouter } from './routes/users.js';
import { getProjectRow } from './repos/projects.js';
import { getUserById } from './repos/users.js';
import { Backups } from './services/backup.js';
import { hasProjectAccess } from './services/permissions.js';

export interface CreatedApp {
  app: Express;
  ctx: AppContext;
}

export function createApp({
  db,
  config,
  mailer,
  backupFetch,
}: {
  db: DB;
  config: Config;
  mailer?: Mailer;
  /** For tests: how the backup client reaches the bucket. */
  backupFetch?: typeof fetch;
}): CreatedApp {
  // Live updates about a project only reach people who can see it.
  const canSee = (userId: number, projectId: number) => {
    const user = getUserById(db, userId);
    const project = getProjectRow(db, projectId);
    return !!user && (!project || hasProjectAccess(db, user, project));
  };
  const ctx: AppContext = {
    db,
    config,
    events: new EventHub(canSee),
    mailer: mailer ?? createMailer(config),
    jobs: new BackgroundJobs(),
    backups: new Backups(db, config, { fetch: backupFetch }),
  };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          // Inline style attributes position timeline bars and apply project colours.
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          // Don't force HTTPS sub-requests: many teams first run this on plain HTTP inside their network.
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use(clientClock);
  api.use(requireCustomHeader);
  api.use(authenticate(ctx));
  api.use(clientLanguage(ctx));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.use('/auth', authRouter(ctx));
  api.use('/users', usersRouter(ctx));
  api.use('/projects', projectsRouter(ctx));
  api.use('/columns', columnsRouter(ctx));
  api.use('/labels', labelsRouter(ctx));
  api.use('/tasks/:taskId/comments', taskCommentsRouter(ctx));
  api.use('/tasks/:taskId', taskDetailsRouter(ctx));
  api.use('/tasks', tasksRouter(ctx));
  api.use('/comments', commentsRouter(ctx));
  api.use('/checklist', checklistRouter(ctx));
  api.use('/attachments', attachmentsRouter(ctx));
  api.use(miscRouter(ctx));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
  app.use('/api', api);

  // The built web app (present after `npm run build`). In development Vite serves it instead.
  const indexHtml = path.join(config.clientDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.clientDir, {
        index: false,
        setHeaders(res, filePath) {
          // Vite fingerprints everything under /assets, so those files never change.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    // Client-side routes (/projects/3, /team, ...) all load the single-page app.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return { app, ctx };
}
