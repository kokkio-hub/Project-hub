import type { Response } from 'express';
import type { LiveEvent } from '../../shared/types.js';

const HEARTBEAT_MS = 25_000;

/**
 * Fan-out of change notifications to connected browsers over Server-Sent Events.
 * Messages only say *what* changed; clients re-fetch the data they display, which
 * keeps permission checks in one place (the regular API).
 */
export class EventHub {
  private readonly clients = new Map<Response, number>();
  private heartbeat: NodeJS.Timeout | null = null;

  add(res: Response, userId: number): void {
    this.clients.set(res, userId);
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => this.writeAll(': ping\n\n'), HEARTBEAT_MS);
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
    this.writeAll(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
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

  private writeAll(chunk: string): void {
    for (const res of this.clients.keys()) {
      try {
        res.write(chunk);
      } catch {
        this.remove(res);
      }
    }
  }
}
