import type { ColorName, ProjectHealth, TaskPriority, TaskStatus } from '../../shared/types';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '../../shared/types';
import { N_, t } from '../i18n';

/**
 * Task stage icon: a ring that fills up as work progresses (to do → done), in the
 * one-hue stage ramp. Shape carries the meaning, colour reinforces it.
 */
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const color = `var(--stage-${status})`;
  const r = 5.25;
  const inner = 3;
  const fraction = status === 'in_progress' ? 0.5 : status === 'review' ? 0.75 : 0;
  let pie: string | null = null;
  if (fraction > 0) {
    const angle = fraction * Math.PI * 2;
    const x = 7 + inner * Math.sin(angle);
    const y = 7 - inner * Math.cos(angle);
    pie = `M7 7 L7 ${7 - inner} A${inner} ${inner} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="status-icon" style={{ flexShrink: 0 }}>
      {status === 'done' ? (
        <>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="M4.3 7.2 6.1 9 9.8 5.2" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" />
          {pie && <path d={pie} fill={color} />}
        </>
      )}
    </svg>
  );
}

export function StatusLabel({ status }: { status: TaskStatus }) {
  return (
    <span className="status-label">
      <StatusIcon status={status} />
      {t(TASK_STATUS_LABELS[status])}
    </span>
  );
}

/** Priority as signal bars (low → high); urgent is a red square with an exclamation mark. */
export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }) {
  if (priority === 'urgent') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-label={t('Urgent priority')} role="img" style={{ flexShrink: 0 }}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--critical)" />
        <rect x="6.2" y="3.4" width="1.6" height="4.6" rx="0.8" fill="#fff" />
        <circle cx="7" cy="10" r="0.95" fill="#fff" />
      </svg>
    );
  }
  const level = priority === 'low' ? 1 : priority === 'medium' ? 2 : 3;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      role="img"
      aria-label={t('{priority} priority', { priority: t(TASK_PRIORITY_LABELS[priority]) })}
      style={{ flexShrink: 0 }}
    >
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4}
          y={9 - i * 3}
          width="3"
          height={4 + i * 3}
          rx="1"
          fill={i < level ? 'var(--text-2)' : 'var(--axis)'}
        />
      ))}
    </svg>
  );
}

export function PriorityLabel({ priority }: { priority: TaskPriority }) {
  return (
    <span className="status-label">
      <PriorityIcon priority={priority} />
      {t(TASK_PRIORITY_LABELS[priority])}
    </span>
  );
}

export type Tone = 'good' | 'warning' | 'critical' | 'neutral';

/** Status glyph in the reserved status colours, always shown next to a text label. */
export function StatusGlyph({ tone, size = 14 }: { tone: Tone; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
      {tone === 'good' && (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--good)" />
          <path d="M4.8 8.3 7 10.4 11.2 5.9" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {tone === 'warning' && (
        <>
          <path d="M8 1.3 15 14H1Z" fill="var(--warning)" stroke="var(--warning)" strokeWidth="1.4" strokeLinejoin="round" />
          <rect x="7.15" y="5.4" width="1.7" height="4.6" rx="0.85" fill="#0b0b0b" />
          <circle cx="8" cy="11.9" r="1" fill="#0b0b0b" />
        </>
      )}
      {tone === 'critical' && (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--critical)" />
          <rect x="7.15" y="3.8" width="1.7" height="5.4" rx="0.85" fill="#fff" />
          <circle cx="8" cy="11.5" r="1.05" fill="#fff" />
        </>
      )}
      {tone === 'neutral' && (
        <>
          <circle cx="8" cy="8" r="6.3" fill="none" stroke="var(--text-3)" strokeWidth="1.5" />
          <path d="M5.2 8.2 7.1 10 10.8 6.1" fill="none" stroke="var(--text-3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

const HEALTH: Record<ProjectHealth, { tone: Tone; label: string }> = {
  on_track: { tone: 'good', label: N_('On track') },
  at_risk: { tone: 'warning', label: N_('At risk') },
  off_track: { tone: 'critical', label: N_('Off track') },
  completed: { tone: 'neutral', label: N_('Completed') },
};

export function HealthBadge({ health, reason }: { health: ProjectHealth; reason?: string }) {
  const { tone, label } = HEALTH[health];
  return (
    <span className="status-label health" title={reason}>
      <StatusGlyph tone={tone} />
      <span>{t(label)}</span>
    </span>
  );
}

export function healthTone(health: ProjectHealth): 'warning' | 'critical' | undefined {
  return health === 'at_risk' ? 'warning' : health === 'off_track' ? 'critical' : undefined;
}

export function ProjectDot({ color, size = 'md' }: { color: ColorName; size?: 'md' | 'lg' }) {
  return <span className={`dot ${size === 'lg' ? 'dot-lg' : ''}`} style={{ background: `var(--cat-${color})` }} aria-hidden />;
}
