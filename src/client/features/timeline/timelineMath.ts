import { addDays, addMonths, diffDays, startOfMonth, startOfWeek, weekdayIndex } from '../../../shared/dates';
import type { Task } from '../../../shared/types';
import { monthShort, monthYear } from '../../lib/format';

export type Zoom = 'day' | 'week' | 'month';

export const PX_PER_DAY: Record<Zoom, number> = { day: 36, week: 14, month: 3.6 };

export interface Range {
  /** First visible day (a Monday, or the 1st of a month in month zoom). */
  start: string;
  days: number;
}

/** Visible span covering every date plus some breathing room, aligned to whole weeks or months. */
export function computeRange(dates: string[], today: string, zoom: Zoom, minDays: number): Range {
  let min = today;
  let max = today;
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const pad = zoom === 'day' ? 10 : zoom === 'week' ? 21 : 45;
  let start = addDays(min, -pad);
  let end = addDays(max, pad);
  if (zoom === 'month') {
    start = startOfMonth(start);
    end = addDays(addMonths(end, 1), -1);
  } else {
    start = startOfWeek(start);
    end = addDays(startOfWeek(end), 6);
  }
  let days = diffDays(end, start) + 1;
  if (days < minDays) {
    end = addDays(start, minDays - 1);
    end = zoom === 'month' ? addDays(addMonths(end, 1), -1) : addDays(startOfWeek(end), 6);
    days = diffDays(end, start) + 1;
  }
  return { start, days };
}

export interface ScaleCell {
  key: string;
  left: number;
  width: number;
  label: string;
  /** Marks weekend days / the current period in the lower scale row. */
  weekend?: boolean;
  current?: boolean;
}

/** The two header rows: a coarse row (months or years) and a fine row (days, weeks or months). */
export function buildScale(range: Range, zoom: Zoom, ppd: number, today: string): { top: ScaleCell[]; bottom: ScaleCell[] } {
  const end = addDays(range.start, range.days - 1);
  const top: ScaleCell[] = [];
  const bottom: ScaleCell[] = [];
  const x = (date: string) => diffDays(date, range.start) * ppd;

  if (zoom === 'month') {
    for (let m = range.start; m <= end; m = addMonths(m, 1)) {
      const next = addMonths(m, 1);
      bottom.push({
        key: m,
        left: x(m),
        width: diffDays(next, m) * ppd,
        label: monthShort(m),
        current: today >= m && today < next,
      });
    }
    const afterEnd = addDays(end, 1);
    for (let y = Number(range.start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
      const yearStart = `${String(y).padStart(4, '0')}-01-01`;
      const nextYear = `${String(y + 1).padStart(4, '0')}-01-01`;
      const from = yearStart < range.start ? range.start : yearStart;
      const to = nextYear > afterEnd ? afterEnd : nextYear;
      top.push({ key: String(y), left: x(from), width: diffDays(to, from) * ppd, label: String(y) });
    }
    return { top, bottom };
  }

  // Months across the top for day and week zoom.
  for (let m = startOfMonth(range.start); m <= end; m = addMonths(m, 1)) {
    const from = m < range.start ? range.start : m;
    const next = addMonths(m, 1);
    const to = next > end ? addDays(end, 1) : next;
    top.push({ key: m, left: x(from), width: diffDays(to, from) * ppd, label: monthYear(m) });
  }

  if (zoom === 'day') {
    for (let i = 0; i < range.days; i++) {
      const d = addDays(range.start, i);
      bottom.push({
        key: d,
        left: i * ppd,
        width: ppd,
        label: String(Number(d.slice(8))),
        weekend: weekdayIndex(d) >= 5,
        current: d === today,
      });
    }
  } else {
    for (let i = 0; i < range.days; i += 7) {
      const d = addDays(range.start, i);
      bottom.push({
        key: d,
        left: i * ppd,
        width: 7 * ppd,
        label: `${Number(d.slice(8))} ${monthShort(d)}`,
        current: today >= d && today <= addDays(d, 6),
      });
    }
  }
  return { top, bottom };
}

/** Vertical grid lines and weekend bands for the chart body. */
export function buildGrid(range: Range, zoom: Zoom, ppd: number): { lines: number[]; weekends: { left: number; width: number }[] } {
  const lines: number[] = [];
  const weekends: { left: number; width: number }[] = [];
  const end = addDays(range.start, range.days - 1);
  if (zoom === 'month') {
    for (let m = addMonths(range.start, 1); m <= end; m = addMonths(m, 1)) lines.push(diffDays(m, range.start) * ppd);
    return { lines, weekends };
  }
  const step = zoom === 'day' ? 1 : 7;
  for (let i = step; i < range.days; i += step) lines.push(i * ppd);
  for (let i = 5; i < range.days; i += 7) weekends.push({ left: i * ppd, width: 2 * ppd });
  return { lines, weekends };
}

/** The dates a task occupies on the timeline, or null when it has none. */
export function taskSpan(task: Pick<Task, 'startDate' | 'dueDate'>): { start: string; end: string; milestone: boolean } | null {
  if (!task.startDate && !task.dueDate) return null;
  const start = task.startDate ?? task.dueDate!;
  const end = task.dueDate ?? task.startDate!;
  return { start, end, milestone: !task.startDate };
}

export type DragMode = 'move' | 'start' | 'end';

/** New dates after dragging a bar by `delta` days. Start never passes the end. */
export function applyDrag(
  task: Pick<Task, 'startDate' | 'dueDate'>,
  mode: DragMode,
  delta: number,
): { startDate: string | null; dueDate: string | null } {
  const shift = (d: string | null) => (d ? addDays(d, delta) : null);
  if (mode === 'move') return { startDate: shift(task.startDate), dueDate: shift(task.dueDate) };
  if (mode === 'start' && task.startDate && task.dueDate) {
    const start = addDays(task.startDate, delta);
    return { startDate: start > task.dueDate ? task.dueDate : start, dueDate: task.dueDate };
  }
  if (mode === 'end' && task.startDate && task.dueDate) {
    const due = addDays(task.dueDate, delta);
    return { startDate: task.startDate, dueDate: due < task.startDate ? task.startDate : due };
  }
  return { startDate: task.startDate, dueDate: task.dueDate };
}
