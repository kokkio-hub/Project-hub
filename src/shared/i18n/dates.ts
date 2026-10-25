import type { Lang } from './core.js';

/** Month and weekday names per language, for dates written out in text. */
const NAMES = {
  en: {
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    weekdaysMin: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  },
  nl: {
    months: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
    monthsLong: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
    weekdays: ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'],
    weekdaysShort: ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'],
    weekdaysMin: ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'],
  },
} as const;

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

function weekdayIndex(date: string): number {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function monthShortName(month: number, lang: Lang): string {
  return NAMES[lang].months[month - 1]!;
}

export function monthLongName(month: number, lang: Lang): string {
  return NAMES[lang].monthsLong[month - 1]!;
}

/** "Mon"/"ma" for the date's weekday. */
export function weekdayShort(date: string, lang: Lang): string {
  return NAMES[lang].weekdaysShort[weekdayIndex(date)]!;
}

/** Two-letter weekday names, Monday first. */
export function weekdayInitials(lang: Lang): string[] {
  const names = NAMES[lang].weekdaysMin;
  return [...names.slice(1), names[0]!];
}

export function weekdayLong(date: string, lang: Lang): string {
  return NAMES[lang].weekdays[weekdayIndex(date)]!;
}

/** "Sep 28" / "28 sep", with the year added when it isn't `currentYear`. */
export function formatDayMonth(date: string, lang: Lang, currentYear?: number): string {
  const { y, m, d } = parts(date);
  const month = NAMES[lang].months[m - 1]!;
  const label = lang === 'nl' ? `${d} ${month}` : `${month} ${d}`;
  if (currentYear !== undefined && y === currentYear) return label;
  return lang === 'nl' ? `${label} ${y}` : `${label}, ${y}`;
}

/** "Monday, September 28, 2026" / "maandag 28 september 2026". */
export function formatDateLongIn(date: string, lang: Lang): string {
  const { y, m, d } = parts(date);
  const weekday = NAMES[lang].weekdays[weekdayIndex(date)]!;
  const month = NAMES[lang].monthsLong[m - 1]!;
  return lang === 'nl' ? `${weekday} ${d} ${month} ${y}` : `${weekday}, ${month} ${d}, ${y}`;
}

/** "September 2026" / "september 2026". */
export function formatMonthYear(date: string, lang: Lang): string {
  const { y, m } = parts(date);
  return `${NAMES[lang].monthsLong[m - 1]!} ${y}`;
}
