import type { Config } from './config.js';
import type { Lang } from '../shared/i18n/core.js';
import type { DB } from './db/index.js';
import type { EventHub } from './lib/events.js';
import type { BackgroundJobs } from './lib/jobs.js';
import type { Mailer } from './lib/mailer.js';
import type { UserRow } from './repos/users.js';
import type { Backups } from './services/backup.js';

/** Everything a route handler needs, passed explicitly so tests can build isolated apps. */
export interface AppContext {
  db: DB;
  config: Config;
  events: EventHub;
  mailer: Mailer;
  jobs: BackgroundJobs;
  backups: Backups;
}

declare global {
  namespace Express {
    interface Request {
      /** The signed-in user, set by the authenticate middleware. */
      user?: UserRow;
      /** Hashed id of the current session. */
      sessionId?: string;
      /** The viewer's local calendar date (from the X-Client-Date header, else the server's). */
      clientToday: string;
      /** The viewer's offset from UTC in minutes (from X-Client-Tz-Offset, else the server's). */
      tzOffsetMinutes: number;
      /** The language to answer in (X-Client-Lang, else the person's settings, else the browser's). */
      lang: Lang;
    }
  }
}
