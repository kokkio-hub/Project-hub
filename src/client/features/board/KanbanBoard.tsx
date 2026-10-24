import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus } from 'lucide-react';
import { TASK_STATUSES, TASK_STATUS_LABELS, type Task, type TaskStatus, type User } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { qk, useCreateTask, useMoveTask, type TaskQuery } from '../../api/queries';
import { Avatar } from '../../components/Avatar';
import { DueChip } from '../../components/Bits';
import { useToast } from '../../components/Feedback';
import { PriorityIcon, StatusIcon } from '../../components/Icons';
import { useAutosize } from '../../lib/hooks';

type Columns = Record<TaskStatus, number[]>;

function groupByStatus(tasks: Task[]): Columns {
  const columns: Columns = { todo: [], in_progress: [], review: [], done: [] };
  const sorted = [...tasks].sort((a, b) => a.position - b.position || a.id - b.id);
  for (const task of sorted) columns[task.status].push(task.id);
  return columns;
}

function isStatus(id: UniqueIdentifier): id is TaskStatus {
  return typeof id === 'string' && (TASK_STATUSES as readonly string[]).includes(id);
}

interface BoardProps {
  projectId: number;
  /** Tasks to show (already filtered). */
  tasks: Task[];
  /** The query whose cache holds this project's tasks, updated optimistically on drop. */
  cacheKey: TaskQuery;
  usersById: Map<number, User>;
  readOnly: boolean;
  onOpenTask: (id: number) => void;
}

export function KanbanBoard({ projectId, tasks, cacheKey, usersById, readOnly, onOpenTask }: BoardProps) {
  const qc = useQueryClient();
  const move = useMoveTask();
  const toast = useToast();
  const [columns, setColumns] = useState<Columns>(() => groupByStatus(tasks));
  const [activeId, setActiveId] = useState<number | null>(null);
  const originStatus = useRef<TaskStatus | null>(null);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Follow server data, except mid-drag (a teammate's change must not yank the card away).
  useEffect(() => {
    if (activeId === null) setColumns(groupByStatus(tasks));
  }, [tasks, activeId]);

  // Mouse drags start after a few pixels (so clicks still open cards); touch needs a short
  // press-and-hold, so swiping still scrolls the board on phones.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const columnOf = (id: UniqueIdentifier): TaskStatus | undefined =>
    isStatus(id) ? id : TASK_STATUSES.find((s) => columns[s].includes(Number(id)));

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(Number(active.id));
    originStatus.current = columnOf(active.id) ?? null;
  };

  // Moving across columns while dragging, so the card previews its new place.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(active.id);
    const to = columnOf(over.id);
    if (!from || !to || from === to) return;
    const id = Number(active.id);
    setColumns((prev) => {
      const target = prev[to].filter((x) => x !== id);
      let index = target.length;
      if (!isStatus(over.id)) {
        const overIndex = target.indexOf(Number(over.id));
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      target.splice(index, 0, id);
      return { ...prev, [from]: prev[from].filter((x) => x !== id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = Number(active.id);
    const to = over ? columnOf(over.id) : undefined;
    const task = tasksById.get(id);
    if (!over || !to || !task) {
      setColumns(groupByStatus(tasks));
      setActiveId(null);
      return;
    }

    let items = columns[to];
    if (!isStatus(over.id)) {
      const oldIndex = items.indexOf(id);
      const newIndex = items.indexOf(Number(over.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) items = arrayMove(items, oldIndex, newIndex);
    }
    const next = { ...columns, [to]: items };
    const index = items.indexOf(id);
    const afterId = index > 0 ? items[index - 1]! : null;
    const unchanged = to === originStatus.current && groupByStatus(tasks)[to].join() === items.join();

    setColumns(next);
    if (!unchanged) {
      // Update the cache first so the board doesn't flicker back while the request is in flight.
      const positions = new Map<number, { status: TaskStatus; position: number }>();
      for (const status of TASK_STATUSES) next[status].forEach((taskId, position) => positions.set(taskId, { status, position }));
      qc.setQueryData<Task[]>(qk.tasks(cacheKey), (old) =>
        old?.map((t) => {
          const place = positions.get(t.id);
          if (!place) return t;
          const completedAt = place.status === 'done' ? (t.completedAt ?? new Date().toISOString()) : null;
          return { ...t, ...place, completedAt };
        }),
      );
      move.mutate(
        { id, status: to, afterId },
        { onError: (error) => toast.error(`Couldn't move the task: ${errorMessage(error)}`) },
      );
    }
    setActiveId(null);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${tasksById.get(Number(active.id))?.title ?? 'task'}.`,
    onDragOver: ({ active, over }) => {
      const status = over ? columnOf(over.id) : undefined;
      return status ? `${tasksById.get(Number(active.id))?.title ?? 'Task'} is over ${TASK_STATUS_LABELS[status]}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const status = over ? columnOf(over.id) : undefined;
      const title = tasksById.get(Number(active.id))?.title ?? 'Task';
      return status ? `${title} dropped in ${TASK_STATUS_LABELS[status]}.` : `${title} dropped.`;
    },
    onDragCancel: ({ active }) => `Moving ${tasksById.get(Number(active.id))?.title ?? 'task'} was cancelled.`,
  };

  const activeTask = activeId !== null ? tasksById.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setColumns(groupByStatus(tasks));
        setActiveId(null);
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move a task, press Space to pick it up, use the arrow keys to move it, and press Space again to drop it. Press Enter to open it.',
        },
      }}
    >
      <div className="board">
        {TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            projectId={projectId}
            taskIds={columns[status]}
            tasksById={tasksById}
            usersById={usersById}
            readOnly={readOnly}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {activeTask ? (
          <TaskCard task={activeTask} assignee={activeTask.assigneeId ? usersById.get(activeTask.assigneeId) : undefined} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  status,
  projectId,
  taskIds,
  tasksById,
  usersById,
  readOnly,
  onOpenTask,
}: {
  status: TaskStatus;
  projectId: number;
  taskIds: number[];
  tasksById: Map<number, Task>;
  usersById: Map<number, User>;
  readOnly: boolean;
  onOpenTask: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: readOnly });
  const [composing, setComposing] = useState(false);

  return (
    <section className={`board-column ${isOver ? 'is-over' : ''}`} aria-label={TASK_STATUS_LABELS[status]}>
      <header className="board-column-header">
        <StatusIcon status={status} />
        <h3>{TASK_STATUS_LABELS[status]}</h3>
        <span className="board-count num">{taskIds.length}</span>
        <span className="spacer" />
        {!readOnly && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => setComposing(true)}
            aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`}
            title="Add task"
          >
            <Plus size={16} />
          </button>
        )}
      </header>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="board-column-body">
          {taskIds.map((id) => {
            const task = tasksById.get(id);
            if (!task) return null;
            return (
              <SortableCard
                key={id}
                task={task}
                assignee={task.assigneeId ? usersById.get(task.assigneeId) : undefined}
                disabled={readOnly}
                onOpen={onOpenTask}
              />
            );
          })}
          {taskIds.length === 0 && !composing && <div className="board-empty">No tasks</div>}
          {composing ? (
            <QuickAdd projectId={projectId} status={status} onDone={() => setComposing(false)} />
          ) : (
            !readOnly && (
              <button type="button" className="board-add" onClick={() => setComposing(true)}>
                <Plus size={15} aria-hidden /> Add task
              </button>
            )
          )}
        </div>
      </SortableContext>
    </section>
  );
}

const SortableCard = memo(function SortableCard({
  task,
  assignee,
  disabled,
  onOpen,
}: {
  task: Task;
  assignee: User | undefined;
  disabled: boolean;
  onOpen: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`sortable ${isDragging ? 'is-placeholder' : ''}`}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable task"
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        // Enter opens the task, unless it is being used to drop a card picked up with the keyboard.
        if (event.key === 'Enter' && !isDragging && !event.defaultPrevented) onOpen(task.id);
      }}
    >
      <TaskCard task={task} assignee={assignee} />
    </div>
  );
});

export function TaskCard({ task, assignee, overlay }: { task: Task; assignee: User | undefined; overlay?: boolean }) {
  return (
    <article className={`task-card ${overlay ? 'is-overlay' : ''} ${task.status === 'done' ? 'is-done' : ''}`}>
      <p className="task-card-title">{task.title}</p>
      <div className="task-card-meta">
        <PriorityIcon priority={task.priority} />
        <DueChip dueDate={task.dueDate} status={task.status} />
        {task.commentCount > 0 && (
          <span className="chip" title={`${task.commentCount} comments`}>
            <MessageSquare size={13} aria-hidden />
            {task.commentCount}
          </span>
        )}
        <span className="spacer" />
        {(assignee || task.assigneeId === null) && <Avatar user={assignee ?? null} size="sm" />}
      </div>
    </article>
  );
}

function QuickAdd({ projectId, status, onDone }: { projectId: number; status: TaskStatus; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const create = useCreateTask();
  const toast = useToast();
  const ref = useAutosize(title);

  const submit = () => {
    const value = title.trim();
    if (!value) {
      onDone();
      return;
    }
    create.mutate(
      { projectId, title: value, status },
      {
        onSuccess: () => setTitle(''),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <div className="quick-add">
      <textarea
        ref={ref}
        className="textarea"
        rows={2}
        autoFocus
        value={title}
        placeholder="Task title… (Enter to add, Esc to close)"
        aria-label={`New task in ${TASK_STATUS_LABELS[status]}`}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onDone();
          }
        }}
        onBlur={() => {
          if (!title.trim()) onDone();
        }}
      />
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={submit} disabled={create.isPending}>
          Add
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
