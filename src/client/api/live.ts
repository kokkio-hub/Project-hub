import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LiveEvent } from '../../shared/types';
import { qk } from './queries';

/**
 * Listens to the server's change feed and refreshes whatever changed, so
 * everyone on the team sees the same board without reloading.
 */
export function useLiveUpdates(enabled: boolean): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let flushTimer: number | undefined;
    let hadError = false;
    let closed = false;
    const pending = new Set<string>();

    // Batch bursts of events (e.g. someone dragging several cards) into one refresh.
    const queue = (...keys: unknown[][]) => {
      for (const key of keys) pending.add(JSON.stringify(key));
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => {
        for (const key of pending) void qc.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
        pending.clear();
      }, 150);
    };

    const handle = (event: LiveEvent) => {
      switch (event.entity) {
        case 'task':
          queue(['tasks'], ['projects'], ['project'], [...qk.dashboard], ['activity'], ['dependencies'], [...qk.trash]);
          if (event.id > 0) {
            queue(['task', event.id], ['checklist', event.id], ['attachments', event.id]);
          } else {
            // A change to many tasks at once (columns or labels changed).
            queue(['task']);
          }
          break;
        case 'project':
          queue(['projects'], ['project'], [...qk.dashboard], ['activity'], [...qk.trash]);
          if (event.action === 'deleted' || event.action === 'created') queue(['tasks'], ['task']);
          break;
        case 'comment':
          queue(['activity'], [...qk.dashboard]);
          if (event.taskId) queue(['comments', event.taskId], ['task', event.taskId], ['tasks']);
          break;
        case 'user':
          queue([...qk.users], [...qk.me], [...qk.dashboard]);
          // Someone was removed from a project, or an invitation was cancelled: what people can see may have changed.
          if (event.action === 'deleted' || event.id === 0) queue(['tasks'], ['task'], ['projects'], ['project'], ['activity']);
          break;
        case 'notification':
          queue([...qk.notifications]);
          break;
      }
    };

    const connect = () => {
      source = new EventSource('/api/events');
      source.addEventListener('open', () => {
        // After a dropped connection we may have missed changes: refresh everything once.
        if (hadError) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'status' });
        hadError = false;
      });
      source.addEventListener('change', (message) => {
        try {
          handle(JSON.parse((message as MessageEvent<string>).data) as LiveEvent);
        } catch {
          // Ignore malformed messages.
        }
      });
      source.addEventListener('error', () => {
        hadError = true;
        if (source?.readyState === EventSource.CLOSED && !closed) {
          // The browser gave up (e.g. the session expired). Check the session and retry later.
          source = null;
          void qc.invalidateQueries({ queryKey: qk.me });
          retryTimer = window.setTimeout(connect, 15_000);
        }
      });
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(flushTimer);
      source?.close();
    };
  }, [enabled, qc]);
}
