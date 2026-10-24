import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { parse } from '../lib/validation.js';
import { listActivity } from '../repos/activity.js';
import { buildDashboard } from '../repos/dashboard.js';
import { requireAuth } from '../auth/middleware.js';

const activityQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  taskId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Dashboard, activity feed and the live-update stream. */
export function miscRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events } = ctx;

  router.get('/dashboard', requireAuth, (req, res) => {
    res.json(buildDashboard(db, req.user!.id, req.clientToday, req.tzOffsetMinutes));
  });

  router.get('/activity', requireAuth, (req, res) => {
    const query = parse(activityQuerySchema, req.query);
    res.json({ activity: listActivity(db, { ...query, excludeArchived: query.projectId === undefined }) });
  });

  /** Server-Sent Events stream: tells browsers when something changed so they can refresh. */
  router.get('/events', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
    });
    res.write('retry: 5000\n\n');
    events.add(res, req.user!.id);
    req.on('close', () => events.remove(res));
  });

  return router;
}
