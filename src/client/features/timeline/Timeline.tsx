import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, CalendarRange } from 'lucide-react';
import { diffDays, localToday } from '../../../shared/dates';
import { TASK_STATUS_LABELS, type ColorName, type Project, type Task, type User } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useUpdateTask } from '../../api/queries';
import { Avatar } from '../../components/Avatar';
import { EmptyState, useToast } from '../../components/Feedback';
import { ProjectDot, StatusGlyph, StatusIcon } from '../../components/Icons';
import { formatDate, formatRange } from '../../lib/format';
import {
  applyDrag,
  buildGrid,
  buildScale,
  computeRange,
  PX_PER_DAY,
  taskSpan,
  type DragMode,
  type Zoom,
} from './timelineMath';
import { N_, t, tn } from '../../i18n';

export interface TimelineGroup {
  project: Project;
  tasks: Task[];
}

interface TimelineProps {
  groups: TimelineGroup[];
  /** Show a summary row per project (for the all-projects timeline). */
  showGroups: boolean;
  usersById: Map<number, User>;
  onOpenTask: (id: number) => void;
}

const ZOOMS: { value: Zoom; label: string }[] = [
  { value: 'day', label: N_('Days') },
  { value: 'week', label: N_('Weeks') },
  { value: 'month', label: N_('Months') },
];

interface HoverInfo {
  task: Task;
  x: number;
  y: number;
}

export function Timeline({ groups, showGroups, usersById, onOpenTask }: TimelineProps) {
  const today = localToday();
  const [zoom, setZoom] = useState<Zoom>('week');
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [viewport, setViewport] = useState(1000);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mutate: updateTask } = useUpdateTask();
  const toast = useToast();

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientWidth));
    observer.observe(el);
    setViewport(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const labelWidth = viewport < 640 ? 168 : 300;
  const ppd = PX_PER_DAY[zoom];

  const allDates = useMemo(() => {
    const dates: string[] = [];
    for (const { project, tasks } of groups) {
      if (project.startDate) dates.push(project.startDate);
      if (project.dueDate) dates.push(project.dueDate);
      for (const task of tasks) {
        if (task.startDate) dates.push(task.startDate);
        if (task.dueDate) dates.push(task.dueDate);
      }
    }
    return dates;
  }, [groups]);

  const minDays = Math.ceil(Math.max(0, viewport - labelWidth) / ppd) + 1;
  const range = useMemo(() => computeRange(allDates, today, zoom, minDays), [allDates, today, zoom, minDays]);
  const scale = useMemo(() => buildScale(range, zoom, ppd, today), [range, zoom, ppd, today]);
  const grid = useMemo(() => buildGrid(range, zoom, ppd), [range, zoom, ppd]);
  const trackWidth = range.days * ppd;
  const todayX = (diffDays(today, range.start) + 0.5) * ppd;

  const scrollToToday = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - labelWidth) * 0.3), behavior });
    },
    [todayX, labelWidth],
  );

  // Start each zoom level with today in view.
  const scrolledForZoom = useRef<Zoom | null>(null);
  useLayoutEffect(() => {
    if (scrolledForZoom.current === zoom || viewport < 50) return;
    scrolledForZoom.current = zoom;
    scrollToToday('auto');
  }, [zoom, viewport, scrollToToday]);

  const reschedule = useCallback(
    (task: Task, dates: { startDate: string | null; dueDate: string | null }) => {
      updateTask(
        { id: task.id, patch: dates },
        { onError: (error) => toast.error(t('Couldn’t change the dates: {error}', { error: errorMessage(error) })) },
      );
    },
    [updateTask, toast],
  );

  const toggleGroup = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalTasks = groups.reduce((n, g) => n + g.tasks.length, 0);
  if (groups.length === 0 || (!showGroups && totalTasks === 0)) {
    return (
      <div className="card">
        <EmptyState icon={<CalendarRange size={22} />} title={t('Nothing to show on the timeline yet')}>
          {t('Add tasks with start and due dates and they will appear here as bars you can drag to reschedule.')}
        </EmptyState>
      </div>
    );
  }

  const style = { '--label-w': `${labelWidth}px`, '--ppd': `${ppd}px` } as CSSProperties;

  return (
    <div className="timeline card" style={style}>
      <div className="timeline-toolbar">
        <div className="segmented" role="group" aria-label={t('Zoom level')}>
          {ZOOMS.map((z) => (
            <button key={z.value} type="button" aria-pressed={zoom === z.value} onClick={() => setZoom(z.value)}>
              {t(z.label)}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => scrollToToday()}>
          {t('Today')}
        </button>
        <span className="spacer" />
        <div className="timeline-legend" aria-label={t('Legend')}>
          <span>
            <span className="legend-bar" /> {t('Open')}
          </span>
          <span>
            <span className="legend-bar is-done" /> {t('Done')}
          </span>
          <span>
            <span className="legend-diamond" /> {t('Due date only')}
          </span>
          <span>
            <StatusGlyph tone="critical" size={12} /> {t('Overdue')}
          </span>
          <span>
            <svg width="22" height="10" aria-hidden className="legend-arrow">
              <path d="M1 5 H17" />
              <path d="M15 2 L19 5 L15 8" />
            </svg>
            {t('Waits for')}
          </span>
        </div>
      </div>

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-inner" style={{ width: labelWidth + trackWidth }}>
          <div className="timeline-header">
            <div className="timeline-corner">{showGroups ? t('Project / task') : t('Task')}</div>
            <div className="timeline-scale" style={{ width: trackWidth }}>
              <div className="scale-row scale-top">
                {scale.top.map((cell) => (
                  <div key={cell.key} className="scale-cell" style={{ left: cell.left, width: cell.width }}>
                    <span>{cell.label}</span>
                  </div>
                ))}
              </div>
              <div className="scale-row scale-bottom">
                {scale.bottom.map((cell) => (
                  <div
                    key={cell.key}
                    className={`scale-cell ${cell.weekend ? 'is-weekend' : ''} ${cell.current ? 'is-current' : ''}`}
                    style={{ left: cell.left, width: cell.width }}
                  >
                    {cell.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="timeline-body">
            <div className="timeline-grid" style={{ left: labelWidth, width: trackWidth }} aria-hidden>
              {grid.weekends.map((w) => (
                <div key={`w${w.left}`} className="grid-weekend" style={{ left: w.left, width: w.width }} />
              ))}
              {grid.lines.map((x) => (
                <div key={`l${x}`} className="grid-line" style={{ left: x }} />
              ))}
              <div className="grid-today" style={{ left: todayX }} title={t('Today, {date}', { date: formatDate(today) })} />
            </div>

            <DependencyArrows
              groups={groups}
              showGroups={showGroups}
              collapsed={collapsed}
              rangeStart={range.start}
              ppd={ppd}
              left={labelWidth}
              width={trackWidth}
            />

            {groups.map(({ project, tasks }) => {
              const isCollapsed = collapsed.has(project.id);
              const sorted = sortForTimeline(tasks);
              return (
                <div key={project.id} role="rowgroup">
                  {showGroups && (
                    <GroupRow
                      project={project}
                      tasks={tasks}
                      rangeStart={range.start}
                      ppd={ppd}
                      collapsed={isCollapsed}
                      onToggle={() => toggleGroup(project.id)}
                    />
                  )}
                  {!isCollapsed &&
                    sorted.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        color={project.color}
                        assignee={task.assigneeId ? usersById.get(task.assigneeId) : undefined}
                        rangeStart={range.start}
                        ppd={ppd}
                        today={today}
                        readOnly={project.status === 'archived'}
                        onOpen={onOpenTask}
                        onReschedule={reschedule}
                        onHover={setHover}
                      />
                    ))}
                  {!isCollapsed && showGroups && tasks.length === 0 && (
                    <div className="timeline-row">
                      <div className="timeline-label muted" style={{ paddingLeft: 40 }}>
                        {t('No tasks')}
                      </div>
                      <div className="timeline-track" style={{ width: trackWidth }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {hover && <TimelineTooltip info={hover} assignee={hover.task.assigneeId ? usersById.get(hover.task.assigneeId) : undefined} today={today} />}
    </div>
  );
}

const GROUP_ROW = 40;
const TASK_ROW = 36;

/**
 * Arrows from each task to the tasks that wait for it. Red when the waiting
 * task is planned to start before the one it waits for ends.
 */
function DependencyArrows({
  groups,
  showGroups,
  collapsed,
  rangeStart,
  ppd,
  left,
  width,
}: {
  groups: TimelineGroup[];
  showGroups: boolean;
  collapsed: Set<number>;
  rangeStart: string;
  ppd: number;
  left: number;
  width: number;
}) {
  const { paths, height } = useMemo(() => {
    const rows = new Map<number, { y: number; start: number; end: number; task: Task }>();
    let y = 0;
    for (const { project, tasks } of groups) {
      if (showGroups) y += GROUP_ROW;
      if (collapsed.has(project.id)) continue;
      const sorted = sortForTimeline(tasks);
      if (showGroups && sorted.length === 0) y += TASK_ROW;
      for (const task of sorted) {
        const span = taskSpan(task);
        if (span) {
          const startX = diffDays(span.start, rangeStart) * ppd;
          const endX = span.milestone ? startX + ppd / 2 + 8 : (diffDays(span.end, span.start) + 1) * ppd + startX;
          rows.set(task.id, { y: y + TASK_ROW / 2, start: span.milestone ? startX + ppd / 2 - 8 : startX, end: endX, task });
        }
        y += TASK_ROW;
      }
    }
    const out: { d: string; late: boolean; key: string }[] = [];
    for (const to of rows.values()) {
      for (const blockerId of to.task.blockedByIds) {
        const from = rows.get(blockerId);
        if (!from) continue;
        const late =
          from.task.status !== 'done' &&
          !!from.task.dueDate &&
          !!(to.task.startDate ?? to.task.dueDate) &&
          (to.task.startDate ?? to.task.dueDate)! <= from.task.dueDate!;
        const x1 = from.end + 2;
        const x2 = to.start - 3;
        const bend = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
        const d =
          x2 > x1 + 16
            ? `M${x1} ${from.y} H${bend} V${to.y} H${x2}`
            : `M${x1} ${from.y} H${x1 + 8} V${(from.y + to.y) / 2} H${x2 - 10} V${to.y} H${x2}`;
        out.push({ d, late, key: `${blockerId}-${to.task.id}` });
      }
    }
    return { paths: out, height: y };
  }, [groups, showGroups, collapsed, rangeStart, ppd]);

  if (paths.length === 0) return null;
  return (
    <svg className="tl-deps" style={{ left, width, height }} width={width} height={height} aria-hidden>
      <defs>
        <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className="tl-arrow-head" />
        </marker>
        <marker id="tl-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className="tl-arrow-head is-late" />
        </marker>
      </defs>
      {paths.map((p) => (
        <path key={p.key} d={p.d} className={`tl-dep ${p.late ? 'is-late' : ''}`} markerEnd={`url(#${p.late ? 'tl-arrow-late' : 'tl-arrow'})`} />
      ))}
    </svg>
  );
}

/** Scheduled tasks by start date, then tasks without dates. */
function sortForTimeline(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const sa = taskSpan(a);
    const sb = taskSpan(b);
    if (!sa && !sb) return a.position - b.position || a.id - b.id;
    if (!sa) return 1;
    if (!sb) return -1;
    return sa.start.localeCompare(sb.start) || sa.end.localeCompare(sb.end) || a.id - b.id;
  });
}

function GroupRow({
  project,
  tasks,
  rangeStart,
  ppd,
  collapsed,
  onToggle,
}: {
  project: Project;
  tasks: Task[];
  rangeStart: string;
  ppd: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  let start = project.startDate;
  let end = project.dueDate;
  for (const task of tasks) {
    const span = taskSpan(task);
    if (!span) continue;
    if (!project.startDate && (!start || span.start < start)) start = span.start;
    if (!project.dueDate && (!end || span.end > end)) end = span.end;
  }
  const done = tasks.filter((task) => task.status === 'done').length;
  const progress = tasks.length ? done / tasks.length : 0;
  const barStyle =
    start && end && start <= end
      ? ({
          left: diffDays(start, rangeStart) * ppd,
          width: (diffDays(end, start) + 1) * ppd,
          '--bar': `var(--cat-${project.color})`,
        } as CSSProperties)
      : null;

  return (
    <div className="timeline-row group-row" role="row">
      <div className="timeline-label group-label">
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('Expand {name}', { name: project.name }) : t('Collapse {name}', { name: project.name })}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <ProjectDot color={project.color} />
        <Link to={`/projects/${project.id}/timeline`} className="group-name truncate">
          {project.name}
        </Link>
        <span className="muted num group-count">
          {done}/{tasks.length}
        </span>
      </div>
      <div className="timeline-track">
        {barStyle && (
          <div
            className="tl-summary"
            style={barStyle}
            title={t('{name}: {dates} · {percent} of tasks done', {
              name: project.name,
              dates: formatRange(start, end),
              percent: `${Math.round(progress * 100)}%`,
            })}
          >
            <div className="tl-summary-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

interface DragState {
  mode: DragMode;
  originX: number;
  delta: number;
  moved: boolean;
  pointerId: number;
}

const TaskRow = memo(function TaskRow({
  task,
  color,
  assignee,
  rangeStart,
  ppd,
  today,
  readOnly,
  onOpen,
  onReschedule,
  onHover,
}: {
  task: Task;
  color: ColorName;
  assignee: User | undefined;
  rangeStart: string;
  ppd: number;
  today: string;
  readOnly: boolean;
  onOpen: (id: number) => void;
  onReschedule: (task: Task, dates: { startDate: string | null; dueDate: string | null }) => void;
  onHover: (info: HoverInfo | null) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const preview = drag ? applyDrag(task, drag.mode, drag.delta) : task;
  const span = taskSpan(preview);
  const overdue = task.status !== 'done' && !!task.dueDate && task.dueDate < today;
  const resizable = !!task.startDate && !!task.dueDate && !readOnly;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0 || event.pointerType === 'touch') return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle as DragMode | undefined;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onHover(null);
    setDrag({ mode: handle ?? 'move', originX: event.clientX, delta: 0, moved: false, pointerId: event.pointerId });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.originX;
    const delta = Math.round(dx / ppd);
    const moved = drag.moved || Math.abs(dx) > 3;
    if (delta !== drag.delta || moved !== drag.moved) setDrag({ ...drag, delta, moved });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { moved, delta, mode } = drag;
    setDrag(null);
    if (!moved) onOpen(task.id);
    else if (delta !== 0) onReschedule(task, applyDrag(task, mode, delta));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(task.id);
      return;
    }
    if (readOnly || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    const mode: DragMode = event.shiftKey && resizable ? 'end' : event.altKey && resizable ? 'start' : 'move';
    onReschedule(task, applyDrag(task, mode, step));
  };

  const label = (
    <div className="timeline-label task-label" onClick={() => onOpen(task.id)}>
      <StatusIcon status={task.status} />
      <span className={`task-label-title truncate ${task.status === 'done' ? 'is-done' : ''}`} title={task.title}>
        {task.title}
      </span>
      <Avatar user={assignee ?? null} size="xs" />
    </div>
  );

  if (!span) {
    return (
      <div className="timeline-row" role="row">
        {label}
        <div className="timeline-track">
          <button type="button" className="tl-nodates" onClick={() => onOpen(task.id)}>
            {t('No dates · set them in the task')}
          </button>
        </div>
      </div>
    );
  }

  const left = diffDays(span.start, rangeStart) * ppd;
  const width = (diffDays(span.end, span.start) + 1) * ppd;
  const aria = `${task.title}. ${formatRange(preview.startDate, preview.dueDate)}. ${t(TASK_STATUS_LABELS[task.status])}.${
    readOnly ? '' : ` ${t('Press Enter to open, arrow keys to move by a day, Shift plus arrow to change the due date.')}`
  }`;

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => setDrag(null),
    onKeyDown,
    onMouseMove: (e: React.MouseEvent) => !drag && onHover({ task, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => onHover(null),
  };

  return (
    <div className="timeline-row" role="row">
      {label}
      <div className="timeline-track">
        {span.milestone ? (
          <div
            className={`tl-milestone ${task.status === 'done' ? 'is-done' : ''} ${drag ? 'is-dragging' : ''} ${readOnly ? 'is-readonly' : ''}`}
            style={{ left: left + ppd / 2 - 8, '--bar': `var(--cat-${color})` } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-label={aria}
            {...handlers}
          />
        ) : (
          <div
            className={`tl-bar ${task.status === 'done' ? 'is-done' : ''} ${drag ? 'is-dragging' : ''} ${readOnly ? 'is-readonly' : ''}`}
            style={{ left, width, '--bar': `var(--cat-${color})` } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-label={aria}
            {...handlers}
          >
            {resizable && <span className="tl-handle is-start" data-handle="start" />}
            {resizable && <span className="tl-handle is-end" data-handle="end" />}
          </div>
        )}
        {overdue && !drag && (
          <span className="tl-flag" style={{ left: left + (span.milestone ? ppd / 2 + 12 : width + 6) }} title={t('Overdue')}>
            <StatusGlyph tone="critical" size={13} />
          </span>
        )}
        {drag?.moved && (
          <span className="tl-drag-label" style={{ left: Math.max(0, left) }}>
            {formatRange(preview.startDate, preview.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
});

function TimelineTooltip({ info, assignee, today }: { info: HoverInfo; assignee: User | undefined; today: string }) {
  const { task } = info;
  const span = taskSpan(task);
  const days = span ? diffDays(span.end, span.start) + 1 : 0;
  const overdue = task.status !== 'done' && !!task.dueDate && task.dueDate < today;
  const left = Math.min(info.x + 14, window.innerWidth - 300);
  const top = Math.min(info.y + 16, window.innerHeight - 120);
  return (
    <div className="tooltip" style={{ left, top }} role="tooltip">
      <strong>{task.title}</strong>
      <div>
        {formatRange(task.startDate, task.dueDate)}
        {span && !span.milestone && ` · ${tn('{count} day', '{count} days', days)}`}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 4 }}>
        <StatusIcon status={task.status} /> {t(TASK_STATUS_LABELS[task.status])} · {assignee?.name ?? t('Unassigned')}
      </div>
      {overdue && (
        <div className="row" style={{ gap: 6, marginTop: 4, color: 'var(--text)' }}>
          <StatusGlyph tone="critical" size={12} /> {t('Overdue since {date}', { date: formatDate(task.dueDate!) })}
        </div>
      )}
    </div>
  );
}
