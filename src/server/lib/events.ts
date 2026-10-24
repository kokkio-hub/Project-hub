import type { Response } from 'express';
import type { LiveEvent } from '../../shared/types.js';

const HEARTBEAT_MS = 25_000;

/**
 * Fan-out of change notifications to connected browsers over Server-Sent Events.
 * Messages only say *what* changed; clients re-fetch the data they display, which
 * keeps permission checks in one place (the regular API). Changes to a project
 * only go to people who can see that project.
 */
export class EventHub {
  private readonly clients = new Map<Response, number>();
  private heartbeat: NodeJS.Timeout | null = null;

  /** @param canSee decides whether a person may hear about changes in a project. */
  constructor(private readonly canSee: (userId: number, projectId: number) => boolean = () => true) {}

  add(res: Response, userId: number): void {
    this.clients.set(res, userId);
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.write(': ping\n\n', () => true), HEARTBEAT_MS);
      this.heartbeat.unref();
    }
  }

  remove(res: Response): void {
    this.clients.delete(res);
    if (this.clients.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  get size(): number {
    return this.clients.size;
  }

  broadcast(event: LiveEvent): void {
    const chunk = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
    if (event.projectId === undefined) {
      this.write(chunk, () => true);
      return;
    }
    const answers = new Map<number, boolean>();
    this.write(chunk, (userId) => {
      let ok = answers.get(userId);
      if (ok === undefined) {
        ok = this.canSee(userId, event.projectId!);
        answers.set(userId, ok);
      }
      return ok;
    });
  }

  /** Sends an event to one person's open tabs only. */
  sendTo(userId: number, event: LiveEvent): void {
    this.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`, (id) => id === userId);
  }

  /** Closes every stream belonging to a user (after deactivation or a password reset). */
  disconnectUser(userId: number): void {
    for (const [res, id] of this.clients) {
      if (id === userId) {
        res.end();
        this.remove(res);
      }
    }
  }

  closeAll(): void {
    for (const res of this.clients.keys()) {
      res.end();
      this.remove(res);
    }
  }

  private write(chunk: string, to: (userId: number) => boolean): void {
    for (const [res, userId] of this.clients) {
      if (!to(userId)) continue;
      try {
        res.write(chunk);
      } catch {
        this.remove(res);
      }
    }
  }
}
