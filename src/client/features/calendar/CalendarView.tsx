import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CalendarX2, ChevronLeft, ChevronRight, Diamond, Plus } from 'lucide-react';
import { addDays, addMonths, diffDays, localToday, startOfMonth, startOfWeek, weekdayIndex } from '../../../shared/dates';
import { weekdayInitials } from '../../../shared/i18n/dates';
import type { ColorName, Milestone, Task, User } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useUpdateTask, type TaskPatch } from '../../api/queries';
import { Avatar } from '../../components/Avatar';
import { useToast } from '../../components/Feedback';
import { PriorityIcon } from '../../components/Icons';
import { formatDate, formatDateLong, formatRange, monthYear } from '../../lib/format';
import { currentLang, t, tn } from '../../i18n';

export type CalendarMode = 'month' | 'week';

export interface CalendarMilestone extends Milestone {
  color: ColorName;
  projectName?: string;
}

interface Props {
  tasks: Task[];
  milestones: CalendarMilestone[];
  usersById: Map<number, User>;
  /** The colour a task is drawn in (its project's). */
  colorOf: (task: Task) => ColorName;
  /** Whether this person may move the task to another day. */
  canMove: (task: Task) => boolean;
  onOpenTask: (id: number) => void;
  /** Adds a task on a day (not offered when left out). */
  onAddTask?: (date: string) => void;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  /** Shown before the task title, e.g. the project name in the calendar of everything. */
  prefixOf?: (task: Task) => string | undefined;
}

/** The day a task is shown on: its due date, else its start date. */
export const calendarDay = (task: Task) => task.dueDate ?? task.startDate;

/** Moving a task to a day keeps its length: the start date moves along with the due date. */
export function reschedule(task: Task, day: string | null): TaskPatch {
  if (day === null) return { startDate: null, dueDate: null };
  if (task.dueDate) {
    const shift = diffDays(day, task.dueDate);
    return { dueDate: day, startDate: task.startDate ? addDays(task.startDate, shift) : null };
  }
  if (task.startDate) return { startDate: day };
  return { dueDate: day };
}

const MONTH_ROWS = 6;
const SHOWN_PER_DAY = 3;
const UNSCHEDULED = 'unscheduled';

/** A month or week of tasks and milestones. Drag a task to another day to reschedule it. */
export function CalendarView({ tasks, milestones, usersById, colorOf, canMove, onOpenTask, onAddTask, mode, onModeChange, prefixOf }: Props) {
  const today = localToday();
  const [anchor, setAnchor] = useState(today);
  const [activeId, setActiveId] = useState<number | null>(null);
  const update = useUpdateTask();
  const toast = useToast();
  const lang = currentLang();

  const first = mode === 'month' ? startOfWeek(startOfMonth(anchor)) : startOfWeek(anchor);
  const days = useMemo(() => Array.from({ length: mode === 'month' ? MONTH_ROWS * 7 : 7 }, (_, i) => addDays(first, i)), [first, mode]);
  const last = days[days.length - 1]!;
  const monthStart = startOfMonth(anchor);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const day = calendarDay(task);
      if (!day || day < first || day > last) continue;
      const list = map.get(day) ?? [];
      list.push(task);
      map.set(day, list);
    }
    // Open work first, the most urgent on top.
    const rank = { urgent: 0, high: 1, medium: 2, low: 3 } as const;
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || rank[a.priority] - rank[b.priority] || a.id - b.id);
    }
    return map;
  }, [tasks, first, last]);

  const milestonesByDay = useMemo(() => {
    const map = new Map<string, CalendarMilestone[]>();
    for (const m of milestones) {
      if (m.date < first || m.date > last) continue;
      map.set(m.date, [...(map.get(m.date) ?? []), m]);
    }
    return map;
  }, [milestones, first, last]);

  const unscheduled = useMemo(() => tasks.filter((x) => !calendarDay(x) && x.status !== 'done'), [tasks]);
  const tasksById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    const task = tasksById.get(Number(active.id));
    if (!task || !over) return;
    const target = String(over.id);
    const day = target === UNSCHEDULED ? null : target;
    if (day === calendarDay(task)) return;
    update.mutate(
      { id: task.id, patch: reschedule(task, day) },
      {
        onSuccess: () =>
          toast.success(
            day ? t('“{title}” moved to {date}', { title: task.title, date: formatDate(day) }) : t('Dates removed from “{title}”', { title: task.title }),
          ),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const step = (delta: number) => setAnchor((a) => (mode === 'month' ? addMonths(startOfMonth(a), delta) : addDays(a, delta * 7)));
  const title = mode === 'month' ? monthYear(anchor) : formatRange(first, last);
  const activeTask = activeId !== null ? tasksById.get(activeId) : undefined;
  const chipProps = { usersById, colorOf, canMove, onOpenTask, prefixOf, today, showPrefix: mode === 'week' };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveId(Number(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => t('Picked up {title}.', { title: tasksById.get(Number(active.id))?.title ?? '' }),
          onDragOver: ({ over }) => (over ? (over.id === UNSCHEDULED ? t('Over “No date”.') : formatDateLong(String(over.id))) : undefined),
          onDragEnd: ({ active, over }) =>
            over
              ? t('{title} dropped on {day}.', {
                  title: tasksById.get(Number(active.id))?.title ?? '',
                  day: over.id === UNSCHEDULED ? t('No date') : formatDateLong(String(over.id)),
                })
              : t('{title} dropped.', { title: tasksById.get(Number(active.id))?.title ?? '' }),
          onDragCancel: ({ active }) => t('Moving {title} was cancelled.', { title: tasksById.get(Number(active.id))?.title ?? '' }),
        },
      }}
    >
      <div className={`calendar ${unscheduled.length > 0 ? 'has-side' : ''}`}>
        <div className="calendar-main card">
          <div className="calendar-toolbar">
            <div className="row" style={{ gap: 4 }}>
              <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={mode === 'month' ? t('Previous month') : t('Previous week')}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={mode === 'month' ? t('Next month') : t('Next week')}>
                <ChevronRight size={18} />
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setAnchor(today)}>
                {t('Today')}
              </button>
            </div>
            <h2 className="calendar-title">{title}</h2>
            <div className="segmented" role="group" aria-label={t('Calendar range')}>
              <button type="button" aria-pressed={mode === 'month'} onClick={() => onModeChange('month')}>
                {t('Month')}
              </button>
              <button type="button" aria-pressed={mode === 'week'} onClick={() => onModeChange('week')}>
                {t('Week')}
              </button>
            </div>
          </div>

          <div className={`calendar-grid is-${mode}`} role="grid" aria-label={title}>
            <div className="calendar-weekdays" role="row">
              {weekdayInitials(lang).map((d, i) => (
                <span key={i} role="columnheader" className="calendar-weekday">
                  {mode === 'week' ? `${d} ${Number(addDays(first, i).slice(8))}` : d}
                </span>
              ))}
            </div>
            {Array.from({ length: days.length / 7 }, (_, row) => (
              <div key={row} className="calendar-week" role="row">
                {days.slice(row * 7, row * 7 + 7).map((day) => (
                  <CalendarDay
                    key={day}
                    day={day}
                    mode={mode}
                    outside={mode === 'month' && day.slice(0, 7) !== monthStart.slice(0, 7)}
                    tasks={byDay.get(day) ?? []}
                    milestones={milestonesByDay.get(day) ?? []}
                    chip={chipProps}
                    onShowWeek={() => {
                      setAnchor(day);
                      onModeChange('week');
                    }}
                    onAddTask={onAddTask}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {unscheduled.length > 0 && <Unscheduled tasks={unscheduled} chip={chipProps} />}
      </div>
      <DragOverlay dropAnimation={null}>{activeTask ? <TaskChip task={activeTask} {...chipProps} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

interface ChipProps {
  usersById: Map<number, User>;
  colorOf: (task: Task) => ColorName;
  canMove: (task: Task) => boolean;
  onOpenTask: (id: number) => void;
  prefixOf?: (task: Task) => string | undefined;
  today: string;
  /** Write the prefix out (in the roomier week view); otherwise it's only in the tooltip. */
  showPrefix: boolean;
}

function CalendarDay({
  day,
  mode,
  outside,
  tasks,
  milestones,
  chip,
  onShowWeek,
  onAddTask,
}: {
  day: string;
  mode: CalendarMode;
  outside: boolean;
  tasks: Task[];
  milestones: CalendarMilestone[];
  chip: ChipProps;
  onShowWeek: () => void;
  onAddTask?: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  const isToday = day === chip.today;
  const limit = mode === 'month' ? SHOWN_PER_DAY : Infinity;
  const shown = tasks.slice(0, Math.max(0, limit - milestones.length));
  const hidden = tasks.length - shown.length;
  const weekend = weekdayIndex(day) >= 5;
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={formatDateLong(day)}
      className={`calendar-day ${outside ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${isOver ? 'is-over' : ''} ${weekend ? 'is-weekend' : ''}`}
    >
      <div className="calendar-day-head">
        {mode === 'month' && <span className="calendar-date num">{Number(day.slice(8))}</span>}
        {onAddTask && (
          <button type="button" className="icon-btn icon-btn-sm calendar-add" onClick={() => onAddTask(day)} aria-label={t('Add task on {date}', { date: formatDateLong(day) })}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {milestones.map((m) => (
        <span
          key={m.id}
          className={`calendar-milestone ${m.reachedAt ? 'is-reached' : ''} ${!m.reachedAt && m.date < chip.today ? 'is-late' : ''}`}
          style={{ '--chip-color': `var(--cat-${m.color})` } as React.CSSProperties}
          title={m.projectName ? `${m.projectName}: ${m.name}` : m.name}
        >
          <Diamond size={12} aria-hidden />
          <span className="truncate">{m.name}</span>
        </span>
      ))}
      {shown.map((task) => (
        <TaskChip key={task.id} task={task} {...chip} />
      ))}
      {hidden > 0 && (
        <button type="button" className="calendar-more" onClick={onShowWeek}>
          {tn('{count} more', '{count} more', hidden)}
        </button>
      )}
    </div>
  );
}

function TaskChip({ task, usersById, colorOf, canMove, onOpenTask, prefixOf, today, showPrefix, overlay }: ChipProps & { task: Task; overlay?: boolean }) {
  const movable = canMove(task) && !overlay;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !movable });
  const done = task.status === 'done';
  const late = !done && !!task.dueDate && task.dueDate < today;
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const prefix = prefixOf?.(task);
  const range = task.startDate && task.dueDate && task.startDate !== task.dueDate ? formatRange(task.startDate, task.dueDate) : null;
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`calendar-task ${done ? 'is-done' : ''} ${late ? 'is-late' : ''} ${isDragging ? 'is-placeholder' : ''} ${overlay ? 'is-overlay' : ''}`}
      style={{ '--chip-color': `var(--cat-${colorOf(task)})` } as React.CSSProperties}
      title={[prefix, task.title, range].filter(Boolean).join(' · ')}
      {...attributes}
      {...listeners}
      aria-roledescription={movable ? t('Draggable task') : t('Task')}
      onClick={() => onOpenTask(task.id)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        if (event.key === 'Enter' && !isDragging && !event.defaultPrevented) onOpenTask(task.id);
      }}
    >
      <PriorityIcon priority={task.priority} size={12} />
      <span className="truncate">
        {prefix && showPrefix && <span className="muted">{prefix} · </span>}
        {task.title}
      </span>
      {assignee && <Avatar user={assignee} size="xs" />}
    </button>
  );
}

function Unscheduled({ tasks, chip }: { tasks: Task[]; chip: ChipProps }) {
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED });
  return (
    <aside ref={setNodeRef} className={`calendar-side card ${isOver ? 'is-over' : ''}`} aria-label={t('No date')}>
      <h3 className="section-title">
        <CalendarX2 size={15} aria-hidden /> {t('No date')} <span className="muted num">{tasks.length}</span>
      </h3>
      <p className="muted calendar-side-hint">{t('Drag a task onto a day to plan it.')}</p>
      <div className="calendar-side-list">
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} {...chip} showPrefix />
        ))}
      </div>
    </aside>
  );
}
