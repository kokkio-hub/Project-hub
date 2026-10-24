import { addDays } from '../../shared/dates.js';
import { describeRecurrence } from '../../shared/recurrence.js';
import { english, type Translator } from '../../shared/i18n/core.js';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from '../../shared/types.js';

/**
 * Builds an iCalendar (.ics) feed of tasks as all-day events, for subscribing
 * from Google Calendar, Outlook or Apple Calendar.
 */

export interface CalendarTask {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  projectId: number;
  projectName: string;
  columnName: string | null;
  recurrence: { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number } | null;
}

/** Escapes text values (RFC 5545 section 3.3.11). */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines longer than 75 bytes, as the format requires. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const len = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (date: string) => date.replace(/-/g, '');
const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildCalendar(
  input: { name: string; appUrl: string | null; host: string; tasks: CalendarTask[] },
  tr: Translator = english,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Project Hub//Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(input.name)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const task of input.tasks) {
    const start = task.startDate ?? task.dueDate;
    const end = task.dueDate ?? task.startDate;
    if (!start || !end) continue;
    const done = task.status === 'done';
    const url = input.appUrl ? `${input.appUrl}/projects/${task.projectId}?task=${task.id}` : null;
    const details = [
      `${task.projectName} · ${task.columnName ?? tr.t(TASK_STATUS_LABELS[task.status])} · ${tr.t('{priority} priority', {
        priority: tr.t(TASK_PRIORITY_LABELS[task.priority]),
      })}`,
      task.recurrence ? describeRecurrence(task.recurrence, tr) : null,
      task.description.trim() ? `\n${task.description.trim().slice(0, 2000)}` : null,
      url ? `\n${url}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:task-${task.id}@${input.host}`,
      `DTSTAMP:${stamp(task.updatedAt)}`,
      `LAST-MODIFIED:${stamp(task.updatedAt)}`,
      `DTSTART;VALUE=DATE:${compactDate(start)}`,
      // The end of an all-day event is the day after its last day.
      `DTEND;VALUE=DATE:${compactDate(addDays(end, 1))}`,
      `SUMMARY:${icsText(`${done ? '✓ ' : ''}${task.title}`)}`,
      `DESCRIPTION:${icsText(details)}`,
      `CATEGORIES:${icsText(task.projectName)}`,
      'TRANSP:TRANSPARENT',
      'STATUS:CONFIRMED',
    );
    if (url) lines.push(`URL:${url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
