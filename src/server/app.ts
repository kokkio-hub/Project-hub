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
import { authenticate, clientClock, requireCustomHeader } from './auth/middleware.js';
import { authRouter } from './routes/auth.js';
import { commentsRouter, taskCommentsRouter } from './routes/comments.js';
import { miscRouter } from './routes/misc.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';
import { usersRouter } from './routes/users.js';

export interface CreatedApp {
  app: Express;
  ctx: AppContext;
}

export function createApp({ db, config, mailer }: { db: DB; config: Config; mailer?: Mailer }): CreatedApp {
  const ctx: AppContext = {
    db,
    config,
    events: new EventHub(),
    mailer: mailer ?? createMailer(config),
    jobs: new BackgroundJobs(),
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
          'img-src': ["'self'", 'data:'],
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
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.use('/auth', authRouter(ctx));
  api.use('/users', usersRouter(ctx));
  api.use('/projects', projectsRouter(ctx));
  api.use('/tasks/:taskId/comments', taskCommentsRouter(ctx));
  api.use('/tasks', tasksRouter(ctx));
  api.use('/comments', commentsRouter(ctx));
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
