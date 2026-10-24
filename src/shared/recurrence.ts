import { addDays, diffDays } from './dates.js';
import type { Recurrence } from './types.js';
import { english, type Translator } from './i18n/core.js';

/** Adds whole months, keeping the day of the month where possible (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsKeepDay(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, daysInMonth);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The date one repeat after `date`. */
export function nextOccurrence(date: string, rule: Recurrence): string {
  const n = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'daily':
      return addDays(date, n);
    case 'weekly':
      return addDays(date, 7 * n);
    case 'monthly':
      return addMonthsKeepDay(date, n);
    case 'yearly':
      return addMonthsKeepDay(date, 12 * n);
  }
}

/**
 * Dates for the next copy of a repeating task. The schedule follows the due date
 * (or the start date when there is no due date), skipping repeats that are
 * already in the past, so a task finished late isn't followed by an overdue one.
 * A task without dates gets a due date one repeat after the day it was finished.
 */
export function nextDates(
  task: { startDate: string | null; dueDate: string | null },
  rule: Recurrence,
  today: string,
): { startDate: string | null; dueDate: string | null } {
  const anchor = task.dueDate ?? task.startDate;
  if (!anchor) return { startDate: null, dueDate: nextOccurrence(today, rule) };
  let next = nextOccurrence(anchor, rule);
  for (let i = 0; i < 1000 && next < today; i++) next = nextOccurrence(next, rule);
  if (task.dueDate && task.startDate) {
    return { startDate: addDays(next, -diffDays(task.dueDate, task.startDate)), dueDate: next };
  }
  return task.dueDate ? { startDate: null, dueDate: next } : { startDate: next, dueDate: null };
}

/** "Every week", "Every 2 months". */
export function describeRecurrence(rule: Recurrence, tr: Translator = english): string {
  const n = rule.interval;
  switch (rule.freq) {
    case 'daily':
      return tr.tn('Every day', 'Every {count} days', n);
    case 'weekly':
      return tr.tn('Every week', 'Every {count} weeks', n);
    case 'monthly':
      return tr.tn('Every month', 'Every {count} months', n);
    case 'yearly':
      return tr.tn('Every year', 'Every {count} years', n);
  }
}
