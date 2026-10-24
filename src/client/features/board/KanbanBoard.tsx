import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { ArrowLeft, ArrowRight, Ellipsis, ListChecks, Lock, MessageSquare, Paperclip, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';
import {
  MAX_COLUMNS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type BoardColumn,
  type Label,
  type Project,
  type Task,
  type TaskStatus,
  type User,
} from '../../../shared/types';
import { describeRecurrence } from '../../../shared/recurrence';
import { errorMessage } from '../../api/client';
import { useAddColumn, useDeleteColumn, useReorderColumns, useUpdateColumn } from '../../api/board';
import { qk, useCreateTask, useMoveTask, type TaskQuery } from '../../api/queries';
import { Avatar } from '../../components/Avatar';
import { DueChip } from '../../components/Bits';
import { Spinner, useToast } from '../../components/Feedback';
import { PriorityIcon, StatusIcon } from '../../components/Icons';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/Menu';
import { Modal } from '../../components/Modal';
import { formatDate } from '../../lib/format';
import { useAutosize } from '../../lib/hooks';
import { LabelList } from '../labels/Labels';

type Columns = Map<number, number[]>;

/** Toast text after finishing a repeating task. */
export function nextCopyMessage(next: Task): string {
  const when = next.dueDate ? `due ${formatDate(next.dueDate)}` : next.startDate ? `starting ${formatDate(next.startDate)}` : 'added';
  return `This task repeats: the next one is ${when}.`;
}

const dropId = (columnId: number) => `col-${columnId}`;
const isColumnId = (id: UniqueIdentifier): id is string => typeof id === 'string' && id.startsWith('col-');
const columnIdOf = (id: string) => Number(id.slice(4));

/** Tasks by column, in board order. Tasks whose column no longer exists go to the first column of their stage. */
function group(columns: BoardColumn[], tasks: Task[]): Columns {
  const map: Columns = new Map(columns.map((c) => [c.id, []]));
  const sorted = [...tasks].sort((a, b) => a.position - b.position || a.id - b.id);
  for (const task of sorted) {
    let id = task.columnId;
    if (id === null || !map.has(id)) id = (columns.find((c) => c.stage === task.status) ?? columns[0])?.id ?? null;
    if (id !== null) map.get(id)!.push(task.id);
  }
  return map;
}

const sameColumns = (a: Columns, b: Columns) => [...a.entries()].every(([k, v]) => (b.get(k) ?? []).join() === v.join());

interface BoardProps {
  project: Project;
  /** Tasks to show (already filtered). */
  tasks: Task[];
  /** The query whose cache holds this project's tasks, updated optimistically on drop. */
  cacheKey: TaskQuery;
  usersById: Map<number, User>;
  readOnly: boolean;
  /** The owner and admins can change the columns. */
  canEditColumns: boolean;
  onOpenTask: (id: number) => void;
}

export function KanbanBoard({ project, tasks, cacheKey, usersById, readOnly, canEditColumns, onOpenTask }: BoardProps) {
  const qc = useQueryClient();
  const move = useMoveTask();
  const toast = useToast();
  const columnsList = useMemo(() => [...project.columns].sort((a, b) => a.position - b.position || a.id - b.id), [project.columns]);
  const [columns, setColumns] = useState<Columns>(() => group(columnsList, tasks));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const originColumn = useRef<number | null>(null);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const columnById = useMemo(() => new Map(columnsList.map((c) => [c.id, c])), [columnsList]);

  // Follow server data, except mid-drag (a teammate's change must not yank the card away).
  useEffect(() => {
    if (activeId === null) setColumns(group(columnsList, tasks));
  }, [tasks, columnsList, activeId]);

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

  const columnOf = (id: UniqueIdentifier): number | undefined => {
    if (isColumnId(id)) return columnIdOf(id);
    for (const [columnId, ids] of columns) if (ids.includes(Number(id))) return columnId;
    return undefined;
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(Number(active.id));
    originColumn.current = columnOf(active.id) ?? null;
  };

  // Moving across columns while dragging, so the card previews its new place.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(active.id);
    const to = columnOf(over.id);
    if (from === undefined || to === undefined || from === to) return;
    const id = Number(active.id);
    setColumns((prev) => {
      const target = (prev.get(to) ?? []).filter((x) => x !== id);
      let index = target.length;
      if (!isColumnId(over.id)) {
        const overIndex = target.indexOf(Number(over.id));
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      target.splice(index, 0, id);
      const next = new Map(prev);
      next.set(from, (prev.get(from) ?? []).filter((x) => x !== id));
      next.set(to, target);
      return next;
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = Number(active.id);
    const to = over ? columnOf(over.id) : undefined;
    const task = tasksById.get(id);
    const column = to !== undefined ? columnById.get(to) : undefined;
    if (!over || to === undefined || !task || !column) {
      setColumns(group(columnsList, tasks));
      setActiveId(null);
      return;
    }

    let items = columns.get(to) ?? [];
    if (!isColumnId(over.id)) {
      const oldIndex = items.indexOf(id);
      const newIndex = items.indexOf(Number(over.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) items = arrayMove(items, oldIndex, newIndex);
    }
    const next = new Map(columns);
    next.set(to, items);
    const index = items.indexOf(id);
    const afterId = index > 0 ? items[index - 1]! : null;
    const unchanged = to === originColumn.current && sameColumns(group(columnsList, tasks), next);

    setColumns(next);
    if (!unchanged) {
      // Update the cache first so the board doesn't flicker back while the request is in flight.
      const places = new Map<number, { columnId: number; status: TaskStatus; position: number }>();
      for (const [columnId, ids] of next) {
        const stage = columnById.get(columnId)?.stage ?? 'todo';
        ids.forEach((taskId, position) => places.set(taskId, { columnId, status: stage, position }));
      }
      qc.setQueryData<Task[]>(qk.tasks(cacheKey), (old) =>
        old?.map((t) => {
          const place = places.get(t.id);
          if (!place) return t;
          const completedAt = place.status === 'done' ? (t.completedAt ?? new Date().toISOString()) : null;
          return { ...t, ...place, completedAt };
        }),
      );
      move.mutate(
        { id, columnId: to, afterId },
        {
          onSuccess: (result) => {
            if (result.next) toast.success(nextCopyMessage(result.next));
          },
          onError: (error) => toast.error(`Couldn't move the task: ${errorMessage(error)}`),
        },
      );
    }
    setActiveId(null);
  };

  const nameOf = (id: UniqueIdentifier | undefined) => {
    const c = id !== undefined ? columnOf(id) : undefined;
    return c !== undefined ? (columnById.get(c)?.name ?? 'a column') : undefined;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${tasksById.get(Number(active.id))?.title ?? 'task'}.`,
    onDragOver: ({ active, over }) => {
      const name = nameOf(over?.id);
      return name ? `${tasksById.get(Number(active.id))?.title ?? 'Task'} is over ${name}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const name = nameOf(over?.id);
      const title = tasksById.get(Number(active.id))?.title ?? 'Task';
      return name ? `${title} dropped in ${name}.` : `${title} dropped.`;
    },
    onDragCancel: ({ active }) => `Moving ${tasksById.get(Number(active.id))?.title ?? 'task'} was cancelled.`,
  };

  const activeTask = activeId !== null ? tasksById.get(activeId) : undefined;
  const showAdd = canEditColumns && !readOnly && columnsList.length < MAX_COLUMNS;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setColumns(group(columnsList, tasks));
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
      <div
        className={`board ${showAdd ? (addingColumn ? 'is-adding' : 'has-add') : ''}`}
        style={{ '--board-cols': columnsList.length } as React.CSSProperties}
      >
        {columnsList.map((column, index) => (
          <BoardColumnView
            key={column.id}
            column={column}
            index={index}
            columns={columnsList}
            project={project}
            taskIds={columns.get(column.id) ?? []}
            tasksById={tasksById}
            usersById={usersById}
            readOnly={readOnly}
            canEdit={canEditColumns && !readOnly}
            onOpenTask={onOpenTask}
          />
        ))}
        {showAdd && <AddColumn projectId={project.id} open={addingColumn} onOpenChange={setAddingColumn} />}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            labels={project.labels}
            assignee={activeTask.assigneeId ? usersById.get(activeTask.assigneeId) : undefined}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumnView({
  column,
  index,
  columns,
  project,
  taskIds,
  tasksById,
  usersById,
  readOnly,
  canEdit,
  onOpenTask,
}: {
  column: BoardColumn;
  index: number;
  columns: BoardColumn[];
  project: Project;
  taskIds: number[];
  tasksById: Map<number, Task>;
  usersById: Map<number, User>;
  readOnly: boolean;
  canEdit: boolean;
  onOpenTask: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(column.id), disabled: readOnly });
  const [composing, setComposing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = useUpdateColumn();
  const reorder = useReorderColumns(project.id);
  const toast = useToast();

  const moveColumn = (delta: number) => {
    const ids = columns.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const setStage = (stage: TaskStatus) =>
    update.mutate({ id: column.id, patch: { stage } }, { onError: (e) => toast.error(errorMessage(e)) });

  return (
    <section className={`board-column ${isOver ? 'is-over' : ''}`} aria-label={column.name}>
      <header className="board-column-header">
        <StatusIcon status={column.stage} />
        {renaming ? (
          <RenameColumn column={column} onDone={() => setRenaming(false)} />
        ) : (
          <h3 className="truncate" title={`${column.name} (${TASK_STATUS_LABELS[column.stage]})`}>
            {column.name}
          </h3>
        )}
        <span className="board-count num">{taskIds.length}</span>
        <span className="spacer" />
        {!readOnly && !renaming && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => setComposing(true)}
            aria-label={`Add task to ${column.name}`}
            title="Add task"
          >
            <Plus size={16} />
          </button>
        )}
        {canEdit && !renaming && (
          <Menu
            trigger={(props) => (
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Options for column ${column.name}`} {...props}>
                <Ellipsis size={16} />
              </button>
            )}
          >
            <MenuItem icon={<Pencil size={16} />} onSelect={() => setRenaming(true)}>
              Rename
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Counts as</MenuLabel>
            {TASK_STATUSES.map((stage) => (
              <MenuItem key={stage} icon={<StatusIcon status={stage} size={16} />} onSelect={() => setStage(stage)}>
                {TASK_STATUS_LABELS[stage]}
                {column.stage === stage && <span className="muted" style={{ marginLeft: 'auto' }}>✓</span>}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<ArrowLeft size={16} />} onSelect={() => moveColumn(-1)} disabled={index === 0}>
              Move left
            </MenuItem>
            <MenuItem icon={<ArrowRight size={16} />} onSelect={() => moveColumn(1)} disabled={index === columns.length - 1}>
              Move right
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setDeleting(true)}>
              Delete column…
            </MenuItem>
          </Menu>
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
                labels={project.labels}
                assignee={task.assigneeId ? usersById.get(task.assigneeId) : undefined}
                disabled={readOnly}
                onOpen={onOpenTask}
              />
            );
          })}
          {taskIds.length === 0 && !composing && <div className="board-empty">No tasks</div>}
          {composing ? (
            <QuickAdd projectId={project.id} column={column} onDone={() => setComposing(false)} />
          ) : (
            !readOnly && (
              <button type="button" className="board-add" onClick={() => setComposing(true)}>
                <Plus size={15} aria-hidden /> Add task
              </button>
            )
          )}
        </div>
      </SortableContext>
      <DeleteColumnDialog column={column} columns={columns} count={taskIds.length} open={deleting} onClose={() => setDeleting(false)} />
    </section>
  );
}

function RenameColumn({ column, onDone }: { column: BoardColumn; onDone: () => void }) {
  const [name, setName] = useState(column.name);
  const update = useUpdateColumn();
  const toast = useToast();
  const save = () => {
    const value = name.trim();
    if (!value || value === column.name) {
      onDone();
      return;
    }
    update.mutate({ id: column.id, patch: { name: value } }, { onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) });
  };
  return (
    <input
      className="input input-sm column-name-input"
      value={name}
      maxLength={40}
      autoFocus
      aria-label="Column name"
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}

function DeleteColumnDialog({
  column,
  columns,
  count,
  open,
  onClose,
}: {
  column: BoardColumn;
  columns: BoardColumn[];
  count: number;
  open: boolean;
  onClose: () => void;
}) {
  const others = columns.filter((c) => c.id !== column.id);
  const [moveTo, setMoveTo] = useState<number>(others.find((c) => c.stage === column.stage)?.id ?? others[0]?.id ?? 0);
  const remove = useDeleteColumn();
  const toast = useToast();
  const lastDone = column.stage === 'done' && !others.some((c) => c.stage === 'done');
  const lastOpen = column.stage !== 'done' && !others.some((c) => c.stage !== 'done');

  const submit = () =>
    remove.mutate(
      { id: column.id, moveTo },
      {
        onSuccess: () => {
          toast.success(`Column “${column.name}” deleted`);
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete “${column.name}”?`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={remove.isPending || lastDone || lastOpen || !moveTo}>
            {remove.isPending && <Spinner size={16} />}
            Delete column
          </button>
        </>
      }
    >
      <div className="modal-body stack" style={{ gap: 12 }}>
        {lastDone || lastOpen ? (
          <p className="secondary">
            A board needs at least one column for {lastDone ? 'finished' : 'unfinished'} work. Add another one first, or change what this column
            counts as.
          </p>
        ) : (
          <>
            <p className="secondary">
              {count === 0 ? 'The column is empty.' : `Its ${count === 1 ? 'task moves' : `${count} tasks move`} to another column.`}
            </p>
            <label className="field">
              <span className="field-label">Move tasks to</span>
              <select className="select" value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

function AddColumn({ projectId, open, onOpenChange: setOpen }: { projectId: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('');
  const [stage, setStage] = useState<TaskStatus>('in_progress');
  const add = useAddColumn(projectId);
  const toast = useToast();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    add.mutate(
      { name: name.trim(), stage },
      {
        onSuccess: () => {
          setName('');
          setOpen(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  if (!open) {
    return (
      <button type="button" className="board-add-column" onClick={() => setOpen(true)} aria-label="Add column" title="Add column">
        <Plus size={18} aria-hidden />
      </button>
    );
  }
  return (
    <form className="board-column board-new-column" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Column name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder="e.g. Waiting for client" />
      </label>
      <label className="field">
        <span className="field-label">Counts as</span>
        <select className="select" value={stage} onChange={(e) => setStage(e.target.value as TaskStatus)}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="field-hint">Progress and the dashboard use this.</span>
      </label>
      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={add.isPending || !name.trim()}>
          Add column
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const SortableCard = memo(function SortableCard({
  task,
  labels,
  assignee,
  disabled,
  onOpen,
}: {
  task: Task;
  labels: Label[];
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
      // A read-only board can't be dragged, but its cards still open: don't announce them as disabled.
      aria-disabled={undefined}
      aria-roledescription={disabled ? 'Task' : 'Draggable task'}
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        // Enter opens the task, unless it is being used to drop a card picked up with the keyboard.
        if (event.key === 'Enter' && !isDragging && !event.defaultPrevented) onOpen(task.id);
      }}
    >
      <TaskCard task={task} labels={labels} assignee={assignee} />
    </div>
  );
});

export function TaskCard({
  task,
  labels,
  assignee,
  overlay,
}: {
  task: Task;
  labels: Label[];
  assignee: User | undefined;
  overlay?: boolean;
}) {
  const blocked = task.openBlockerCount > 0 && task.status !== 'done';
  return (
    <article className={`task-card ${overlay ? 'is-overlay' : ''} ${task.status === 'done' ? 'is-done' : ''}`}>
      {task.labelIds.length > 0 && <LabelList ids={task.labelIds} labels={labels} />}
      <p className="task-card-title">{task.title}</p>
      <div className="task-card-meta">
        <PriorityIcon priority={task.priority} />
        {blocked && (
          <span className="chip chip-blocked" title={`Waiting for ${task.openBlockerCount} other ${task.openBlockerCount === 1 ? 'task' : 'tasks'}`}>
            <Lock size={12} aria-hidden />
            Blocked
          </span>
        )}
        <DueChip dueDate={task.dueDate} status={task.status} />
        {task.recurrence && (
          <span className="chip" title={describeRecurrence(task.recurrence)}>
            <Repeat size={13} aria-label={describeRecurrence(task.recurrence)} />
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span
            className={`chip ${task.checklistDone === task.checklistTotal ? 'chip-complete' : ''}`}
            title={`${task.checklistDone} of ${task.checklistTotal} checklist items done`}
          >
            <ListChecks size={13} aria-hidden />
            {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="chip" title={`${task.attachmentCount} ${task.attachmentCount === 1 ? 'file' : 'files'}`}>
            <Paperclip size={13} aria-hidden />
            {task.attachmentCount}
          </span>
        )}
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

function QuickAdd({ projectId, column, onDone }: { projectId: number; column: BoardColumn; onDone: () => void }) {
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
      { projectId, title: value, columnId: column.id },
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
        aria-label={`New task in ${column.name}`}
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
