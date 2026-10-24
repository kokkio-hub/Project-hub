import type { AppContext } from '../context.js';
import { purgeExpiredSessions } from '../auth/sessions.js';
import { purgeExpiredTokens } from '../auth/tokens.js';
import { purgeOldNotifications } from '../repos/notifications.js';
import { createDueReminders, sendDailyDigests, sendInstantEmails, skipBacklog } from './notify.js';
import { purgeExpiredTrash } from './trash.js';

/**
 * Background work on a timer, checked once a minute:
 * - notification emails (every minute) and daily emails (from 8:00 local time);
 * - "due tomorrow" reminders (hourly);
 * - emptying old trash, expired sessions and links (hourly);
 * - the nightly backup (once a day after BACKUP_HOUR_UTC).
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastHourly = 0;

  constructor(private readonly ctx: AppContext) {}

  start(): void {
    if (this.timer) return;
    skipBacklog(this.ctx);
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step('Notification emails', () => sendInstantEmails(this.ctx, now));
      if (now.getTime() - this.lastHourly >= 60 * 60_000) {
        this.lastHourly = now.getTime();
        await this.step('Due date reminders', () => createDueReminders(this.ctx, now));
        await this.step('Cleaning up', () => {
          purgeExpiredSessions(this.ctx.db);
          purgeExpiredTokens(this.ctx.db);
          this.ctx.db.prepare('DELETE FROM login_challenges WHERE expires_at <= ?').run(now.toISOString());
          purgeOldNotifications(this.ctx.db);
          purgeExpiredTrash(this.ctx, now);
        });
      }
      await this.step('Daily emails', () => sendDailyDigests(this.ctx, now));
      if (this.ctx.backups.isDue(now)) {
        // Runs on its own so a slow upload doesn't hold up emails.
        this.ctx.backups.run().then(
          (result) =>
            console.log(`Backup: uploaded ${result.key} (${Math.round(result.size / 1024)} KB, ${result.attachments} new attachments).`),
          (error: Error) => console.error(`Backup failed: ${error.message}`),
        );
      }
    } finally {
      this.busy = false;
    }
  }

  private async step(label: string, work: () => unknown): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
