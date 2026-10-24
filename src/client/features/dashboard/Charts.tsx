import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { TASK_STATUS_LABELS, type ThroughputWeek, type User, type WorkloadRow } from '../../../shared/types';
import { Avatar } from '../../components/Avatar';
import { StatusGlyph } from '../../components/Icons';
import { formatDate } from '../../lib/format';
import { t } from '../../i18n';

/** Width of an element, kept up to date as it resizes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  const left = Math.min(tip.x + 12, window.innerWidth - 240);
  const top = Math.max(8, tip.y - 70);
  return (
    <div className="tooltip" style={{ left, top }} role="tooltip">
      {tip.content}
    </div>
  );
}

/** "Nice" axis maximum and ticks: 0, 2, 4 … or 0, 5, 10 … */
function niceTicks(max: number): number[] {
  if (max <= 4) return Array.from({ length: Math.max(max, 1) + 1 }, (_, i) => i);
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** Column path with a 4px rounded data end and a square base on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Bar path with a rounded data end on the right, square on the left. */
function barPath(x: number, y: number, w: number, h: number, roundEnd: boolean, r = 4): string {
  if (!roundEnd || w < 1) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

// ---------------------------------------------------------------------------
// Throughput: tasks completed per week (single series, so no legend)
// ---------------------------------------------------------------------------

export function ThroughputChart({ weeks }: { weeks: ThroughputWeek[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  const plotHeight = 150;
  const axisBand = 24;
  const labelBand = 18; // room above the tallest column for its value label
  const left = 28;
  const right = 4;
  const ticks = niceTicks(Math.max(1, ...weeks.map((w) => w.completed)));
  const maxY = ticks[ticks.length - 1]!;
  const plotW = Math.max(0, width - left - right);
  const band = weeks.length ? plotW / weeks.length : 0;
  const barW = Math.min(24, band * 0.56);
  const y = (v: number) => labelBand + plotHeight - (v / maxY) * plotHeight;
  const everyOther = band < 44;
  const lastIndex = weeks.length - 1;

  const describe = (w: ThroughputWeek, i: number) => (
    <>
      <div className="tooltip-value">{t('{count} completed', { count: w.completed })}</div>
      <div>
        {i === lastIndex
          ? t('Week of {date} (so far)', { date: formatDate(w.weekStart) })
          : t('Week of {date}', { date: formatDate(w.weekStart) })}
      </div>
      <div>{t('{count} created', { count: w.created })}</div>
    </>
  );

  return (
    <div ref={ref} className="chart" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={labelBand + plotHeight + axisBand} role="img" aria-label={t('Tasks completed per week, last 8 weeks')}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'chart-baseline' : 'chart-grid'} />
              <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart-tick">
                {tick}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = left + band * i + band / 2;
            const h = plotHeight - (y(w.completed) - labelBand);
            const active = focus === i;
            return (
              <g key={w.weekStart}>
                {w.completed > 0 && (
                  <path
                    d={columnPath(cx - barW / 2, y(w.completed), barW, h)}
                    className={`chart-column ${active ? 'is-active' : ''}`}
                  />
                )}
                {i === lastIndex && (
                  <text x={cx} y={y(w.completed) - 6} textAnchor="middle" className="chart-value">
                    {w.completed}
                  </text>
                )}
                {(!everyOther || (lastIndex - i) % 2 === 0) && (
                  <text x={cx} y={labelBand + plotHeight + 16} textAnchor="middle" className="chart-tick">
                    {i === lastIndex ? t('This wk') : formatDate(w.weekStart)}
                  </text>
                )}
                {/* Hit target: the whole column slot, larger than the mark. */}
                <rect
                  x={left + band * i}
                  y={labelBand}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={t('Week of {date}: {completed} completed, {created} created', {
                    date: formatDate(w.weekStart),
                    completed: w.completed,
                    created: w.created,
                  })}
                  onMouseMove={(e) => {
                    setFocus(i);
                    setTip({ x: e.clientX, y: e.clientY, content: describe(w, i) });
                  }}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setFocus(i);
                    setTip({ x: r.left + r.width / 2, y: r.top + 40, content: describe(w, i) });
                  }}
                  onBlur={() => {
                    setFocus(null);
                    setTip(null);
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export function ThroughputTable({ weeks }: { weeks: ThroughputWeek[] }) {
  return (
    <table className="table compact-table">
      <thead>
        <tr>
          <th>{t('Week of')}</th>
          <th className="num">{t('Completed')}</th>
          <th className="num">{t('Created')}</th>
        </tr>
      </thead>
      <tbody>
        {[...weeks].reverse().map((w, i) => (
          <tr key={w.weekStart}>
            <td>
              {i === 0 ? t('{date} (this week)', { date: formatDate(w.weekStart) }) : formatDate(w.weekStart)}
            </td>
            <td className="num">{w.completed}</td>
            <td className="num">{w.created}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Workload: open tasks per person, stacked by stage (ordinal one-hue ramp)
// ---------------------------------------------------------------------------

const STAGES = ['todo', 'in_progress', 'review'] as const;

export function WorkloadLegend() {
  return (
    <div className="chart-legend" aria-hidden>
      {STAGES.map((s) => (
        <span key={s}>
          <span className="legend-swatch" style={{ background: `var(--stage-${s})` }} />
          {t(TASK_STATUS_LABELS[s])}
        </span>
      ))}
    </div>
  );
}

export function WorkloadChart({ rows, usersById }: { rows: WorkloadRow[]; usersById: Map<number, User> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.open));
  const valueBand = 34; // room for the total at the end of the longest bar
  const trackW = Math.max(40, width - valueBand);
  const barH = 14;
  const gap = 2;

  return (
    <div className="workload" onMouseLeave={() => setTip(null)}>
      {rows.map((row) => {
        const user = usersById.get(row.userId);
        if (!user) return null;
        let x = 0;
        const segments = STAGES.filter((s) => row[s] > 0).map((stage) => {
          const w = (row[stage] / max) * trackW;
          const seg = { stage, x, w, value: row[stage] };
          x += w;
          return seg;
        });
        const total = x;
        return (
          <div key={row.userId} className="workload-row">
            <div className="workload-person">
              <Avatar user={user} size="sm" title={null} />
              <span className="truncate">{user.name}</span>
            </div>
            <div className="workload-bar" ref={row === rows[0] ? ref : undefined}>
              {width > 0 && (
                <svg width={width} height={barH + 4} role="img" aria-label={t('{name}: {todo} to do, {doing} in progress, {review} in review', {
                    name: user.name,
                    todo: row.todo,
                    doing: row.in_progress,
                    review: row.review,
                  })}>
                  {segments.map((seg, i) => {
                    const last = i === segments.length - 1;
                    // 2px surface gap between touching segments.
                    const w = Math.max(1, seg.w - (last ? 0 : gap));
                    const key = `${row.userId}-${seg.stage}`;
                    return (
                      <path
                        key={seg.stage}
                        d={barPath(seg.x, 2, w, barH, last)}
                        fill={`var(--stage-${seg.stage})`}
                        className={`workload-seg ${hovered === key ? 'is-active' : ''}`}
                        onMouseMove={(e) => {
                          setHovered(key);
                          setTip({
                            x: e.clientX,
                            y: e.clientY,
                            content: (
                              <>
                                <div className="tooltip-value">
                                  {seg.value} {t(TASK_STATUS_LABELS[seg.stage]).toLowerCase()}
                                </div>
                                <div>{user.name}</div>
                              </>
                            ),
                          });
                        }}
                        onMouseLeave={() => setHovered(null)}
                      />
                    );
                  })}
                  <text x={total + (total > 0 ? 6 : 0)} y={2 + barH / 2} dy="0.34em" className="chart-value">
                    {row.open}
                  </text>
                </svg>
              )}
            </div>
            <div className="workload-flags">
              {row.overdue > 0 && (
                <span className="chip chip-overdue" title={t('{count} overdue', { count: row.overdue })}>
                  <StatusGlyph tone="critical" size={12} />
                  {t('{count} overdue', { count: row.overdue })}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}

export function WorkloadTable({ rows, usersById }: { rows: WorkloadRow[]; usersById: Map<number, User> }) {
  return (
    <table className="table compact-table">
      <thead>
        <tr>
          <th>{t('Person')}</th>
          <th className="num">{t('To do')}</th>
          <th className="num">{t('In progress')}</th>
          <th className="num">{t('In review')}</th>
          <th className="num">{t('Overdue')}</th>
          <th className="num">{t('Due this week')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId}>
            <td>{usersById.get(r.userId)?.name ?? '—'}</td>
            <td className="num">{r.todo}</td>
            <td className="num">{r.in_progress}</td>
            <td className="num">{r.review}</td>
            <td className="num">{r.overdue}</td>
            <td className="num">{r.dueThisWeek}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
