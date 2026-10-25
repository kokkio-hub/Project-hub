import { diffDays, localToday } from '../../shared/dates';
import {
  formatDateLongIn,
  formatDayMonth,
  formatMonthYear,
  monthLongName,
  monthShortName,
  weekdayShort,
} from '../../shared/i18n/dates';
import { currentLang, currentLocale, t, tn } from '../i18n';

function year(date: string): number {
  return Number(date.slice(0, 4));
}

function month(date: string): number {
  return Number(date.slice(5, 7));
}

export function monthShort(date: string): string {
  return monthShortName(month(date), currentLang());
}

export function monthLong(date: string): string {
  return monthLongName(month(date), currentLang());
}

export function monthYear(date: string): string {
  return formatMonthYear(date, currentLang());
}

/** "Sep 28" / "28 sep", with the year when it isn't the current one. */
export function formatDate(date: string | null | undefined, today = localToday()): string {
  if (!date) return '';
  return formatDayMonth(date, currentLang(), year(today));
}

export function formatDateLong(date: string): string {
  return formatDateLongIn(date, currentLang());
}

export function formatRange(start: string | null, end: string | null): string {
  if (start && end) return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
  if (end) return t('Due {date}', { date: formatDate(end) });
  if (start) return t('Starts {date}', { date: formatDate(start) });
  return t('No dates');
}

/** Friendly due-date label: "Today", "Tomorrow", "Yesterday", "Fri", or "Oct 3". */
export function relativeDay(date: string, today = localToday()): string {
  const delta = diffDays(date, today);
  if (delta === 0) return t('Today');
  if (delta === 1) return t('Tomorrow');
  if (delta === -1) return t('Yesterday');
  if (delta > 1 && delta < 7) return weekdayShort(date, currentLang());
  return formatDate(date, today);
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return t('just now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{count} min ago', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{count} h ago', { count: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t('yesterday');
  if (days < 7) return tn('{count} day ago', '{count} days ago', days);
  return formatDate(localDateOf(iso));
}

/** The local calendar date of a timestamp. */
export function localDateOf(iso: string): string {
  return localToday(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(localDateOf(iso))}, ${formatTime(iso)}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function formatNumber(n: number): string {
  return n.toLocaleString(currentLocale());
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return t('Good morning');
  if (hour < 18) return t('Good afternoon');
  return t('Good evening');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
