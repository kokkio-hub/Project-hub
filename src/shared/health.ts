import { diffDays } from './dates.js';
import type { ProjectHealth, ProjectStatus } from './types.js';

export interface HealthInput {
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  total: number;
  done: number;
  overdue: number;
}

export interface HealthResult {
  health: ProjectHealth;
  reason: string;
  /** 0..1 share of tasks that are done. */
  progress: number;
}

/** How far progress may trail elapsed time before a project counts as at risk. */
const SCHEDULE_TOLERANCE = 0.25;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Rates a project as on track, at risk or off track.
 *
 * - Off track: the project's due date has passed and work remains.
 * - At risk: some tasks are overdue, or the share of finished tasks trails the
 *   share of elapsed time (start date to due date) by more than 25 points.
 * - On track: everything else.
 */
export function computeProjectHealth(input: HealthInput, today: string): HealthResult {
  const { status, dueDate, total, done, overdue } = input;
  const progress = total > 0 ? done / total : 0;

  if (status === 'completed' || status === 'archived') {
    return { health: 'completed', reason: status === 'completed' ? 'Project completed' : 'Project archived', progress };
  }
  if (total > 0 && done === total) {
    return { health: 'on_track', reason: 'All tasks are done', progress };
  }
  if (dueDate && dueDate < today) {
    return {
      health: 'off_track',
      reason: `Past its due date by ${plural(diffDays(today, dueDate), 'day')}`,
      progress,
    };
  }
  if (overdue > 0) {
    return { health: 'at_risk', reason: `${plural(overdue, 'overdue task')}`, progress };
  }
  if (dueDate && total > 0) {
    const start = input.startDate ?? input.createdAt.slice(0, 10);
    const span = diffDays(dueDate, start);
    if (span > 0) {
      const elapsed = Math.min(1, Math.max(0, diffDays(today, start) / span));
      if (elapsed - progress > SCHEDULE_TOLERANCE) {
        return {
          health: 'at_risk',
          reason: `${pct(elapsed)} of the time used, ${pct(progress)} of tasks done`,
          progress,
        };
      }
    }
  }
  if (total === 0) return { health: 'on_track', reason: 'No tasks yet', progress };
  if (!dueDate) return { health: 'on_track', reason: 'No due date set', progress };
  return { health: 'on_track', reason: 'On schedule', progress };
}
