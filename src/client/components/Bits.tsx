import { CalendarDays, Clock } from 'lucide-react';
import { diffDays, localToday } from '../../shared/dates';
import type { TaskStatus } from '../../shared/types';
import { formatDate, relativeDay } from '../lib/format';
import { StatusGlyph } from './Icons';

/** Due date with urgency: overdue gets the critical glyph, due within two days a clock. */
export function DueChip({
  dueDate,
  status,
  today = localToday(),
  showIcon = true,
}: {
  dueDate: string | null;
  status: TaskStatus;
  today?: string;
  showIcon?: boolean;
}) {
  if (!dueDate) return null;
  const delta = diffDays(dueDate, today);
  const open = status !== 'done';
  if (open && delta < 0) {
    const days = -delta;
    return (
      <span className="chip chip-overdue" title={`Overdue since ${formatDate(dueDate, today)}`}>
        <StatusGlyph tone="critical" size={13} />
        {days === 1 ? 'Yesterday' : `${days}d overdue`}
      </span>
    );
  }
  if (open && delta <= 1) {
    return (
      <span className="chip chip-soon" title={`Due ${formatDate(dueDate, today)}`}>
        {showIcon && <Clock size={13} aria-hidden />}
        <span style={{ color: 'var(--text)', fontWeight: 560 }}>{relativeDay(dueDate, today)}</span>
      </span>
    );
  }
  return (
    <span className="chip" title={`Due ${formatDate(dueDate, today)}`}>
      {showIcon && <CalendarDays size={13} aria-hidden />}
      {relativeDay(dueDate, today)}
    </span>
  );
}

/** A single ratio against its whole. Tone shifts the fill to warning / critical. */
export function Meter({
  value,
  tone,
  label,
}: {
  value: number;
  tone?: 'warning' | 'critical';
  label: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="meter"
      data-tone={tone}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
