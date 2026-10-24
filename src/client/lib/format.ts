import { diffDays, localToday } from '../../shared/dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

export function monthShort(date: string): string {
  return MONTHS[parts(date).m - 1]!;
}

export function monthLong(date: string): string {
  return MONTHS_LONG[parts(date).m - 1]!;
}

/** "Sep 28", or "Sep 28, 2027" when not in the current year. */
export function formatDate(date: string | null | undefined, today = localToday()): string {
  if (!date) return '';
  const { y, m, d } = parts(date);
  const label = `${MONTHS[m - 1]} ${d}`;
  return y === parts(today).y ? label : `${label}, ${y}`;
}

export function formatDateLong(date: string): string {
  const { y, m, d } = parts(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

export function formatRange(start: string | null, end: string | null): string {
  if (start && end) return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
  if (end) return `Due ${formatDate(end)}`;
  if (start) return `Starts ${formatDate(start)}`;
  return 'No dates';
}

/** Friendly due-date label: "Today", "Tomorrow", "Yesterday", "Fri", or "Oct 3". */
export function relativeDay(date: string, today = localToday()): string {
  const delta = diffDays(date, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) {
    const { y, m, d } = parts(date);
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!.slice(0, 3);
  }
  return formatDate(date, today);
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(localDateOf(iso));
}

/** The local calendar date of a timestamp. */
export function localDateOf(iso: string): string {
  return localToday(new Date(iso));
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(localDateOf(iso))}, ${time}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : pluralForm}`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
