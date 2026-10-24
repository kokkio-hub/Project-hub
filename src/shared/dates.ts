/**
 * Calendar-date helpers for YYYY-MM-DD strings.
 *
 * Due dates and start dates are plain calendar dates with no time zone. All math
 * here is done on whole days in UTC so the result never shifts with the viewer's
 * clock or daylight-saving changes.
 */

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whole days since 1970-01-01. */
export function toDayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Number of days from `b` to `a` (positive when `a` is later). */
export function diffDays(a: string, b: string): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(date: string): number {
  // 1970-01-01 was a Thursday (index 3).
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** Today's date in the local time zone of the machine running this code. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
