import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  Ellipsis,
  ListChecks,
  ListTree,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react';
import {
  MAX_COLUMNS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type BoardColumn,
  type CustomField,
  type GroupBy,
  type Label,
  type Project,
  type Task,
  type TaskStatus,
  type User,
} from '../../../shared/types';
import { describeRecurrence } from '../../../shared/recurrence';
import { errorMessage } from '../../api/client';
import { useAddColumn, useDeleteColumn, useReorderColumns, useUpdateColumn } from '../../api/board';
import { qk, useCreateTask, useMoveTask, useUpdateTask, type TaskInput, type TaskQuery } from '../../api/queries';
import { useCurrentUser } from '../../auth/session';
import { Avatar } from '../../components/Avatar';
import { DueChip } from '../../components/Bits';
import { Spinner, useToast } from '../../components/Feedback';
import { PriorityIcon, StatusIcon } from '../../components/Icons';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/Menu';
import { Modal } from '../../components/Modal';
import { formatDate } from '../../lib/format';
import { useAutosize } from '../../lib/hooks';
import { LabelList } from '../labels/Labels';
import { FieldChip } from '../planning/Fields';
import { assignableUsers } from '../tasks/TaskDrawer';
import { buildLanes, laneOf, lanePatch, validGroupBy, type Lane } from './lanes';
import { t, tn, tr } from '../../i18n';

/** Card ids per cell. A cell is one column in one swimlane: "<lane>~<column id>". */
type Cells = Map<string, number[]>;

/** Toast text after finishing a repeating task. */
export function nextCopyMessage(next: Task): string {
  if (next.dueDate) return t('This task repeats: the next one is due {date}.', { date: formatDate(next.dueDate) });
  if (next.startDate) return t('This task repeats: the next one starts {date}.', { date: formatDate(next.startDate) });
  return t('This task repeats: the next one has been added.');
}

const cellKey = (lane: string, columnId: number) => `${lane}~${columnId}`;
const dropId = (cell: string) => `cell~${cell}`;
const isCellId = (id: UniqueIdentifier): id is string => typeof id === 'string' && id.startsWith('cell~');
const cellOfDropId = (id: string) => id.slice(5);
const laneOfCell = (cell: string) => cell.slice(0, cell.lastIndexOf('~'));
const columnOfCell = (cell: string) => Number(cell.slice(cell.lastIndexOf('~') + 1));

/** Tasks by cell, in board order. Tasks whose column no longer exists go to the first column of their stage. */
function group(columns: BoardColumn[], lanes: Lane[], tasks: Task[], laneFor: (task: Task) => string): Cells {
  const map: Cells = new Map();
  for (const lane of lanes) for (const c of columns) map.set(cellKey(lane.key, c.id), []);
  const sorted = [...tasks].sort((a, b) => a.position - b.position || a.id - b.id);
  for (const task of sorted) {
    let id = task.columnId;
    if (id === null || !columns.some((c) => c.id === id)) id = (columns.find((c) => c.stage === task.status) ?? columns[0])?.id ?? null;
    if (id === null) continue;
    map.get(cellKey(laneFor(task), id))?.push(task.id);
  }
  return map;
}

const sameCells = (a: Cells, b: Cells) => [...a.entries()].every(([k, v]) => (b.get(k) ?? []).join() === v.join());

function readCollapsed(storageKey: string): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]);
  } catch {
    return new Set<string>();
  }
}

/** Rows people folded away, remembered per project and grouping in this browser. */
function useCollapsedLanes(projectId: number, groupBy: GroupBy) {
  const storageKey = `ph.lanes.${projectId}.${groupBy}`;
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));
  useEffect(() => setCollapsed(readCollapsed(storageKey)), [storageKey]);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Private browsing: remember it for this visit only.
      }
      return next;
    });
  return { collapsed, toggle };
}

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
  /** Split the board into rows. */
  groupBy?: GroupBy;
  /** Titles of main tasks, shown on subtask cards. */
  parentTitles?: Map<number, string>;
}

export function KanbanBoard({
  project,
  tasks,
  cacheKey,
  usersById,
  readOnly,
  canEditColumns,
  onOpenTask,
  groupBy: requestedGroupBy = 'none',
  parentTitles,
}: BoardProps) {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const move = useMoveTask();
  const update = useUpdateTask();
  const toast = useToast();
  const groupBy = validGroupBy(requestedGroupBy, project);
  const grouped = groupBy !== 'none';
  const columnsList = useMemo(() => [...project.columns].sort((a, b) => a.position - b.position || a.id - b.id), [project.columns]);
  const canAssignMe = me.role !== 'guest' && assignableUsers([me], project).length > 0;
  const lanes = useMemo(
    () => buildLanes({ groupBy, project, tasks, usersById, meId: me.id, canAssignMe }),
    [groupBy, project, tasks, usersById, me.id, canAssignMe],
  );
  const laneFor = useMemo(() => (task: Task) => laneOf(task, groupBy, project), [groupBy, project]);
  const [cells, setCells] = useState<Cells>(() => group(columnsList, lanes, tasks, laneFor));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const originCell = useRef<string | null>(null);
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const columnById = useMemo(() => new Map(columnsList.map((c) => [c.id, c])), [columnsList]);
  const laneByKey = useMemo(() => new Map(lanes.map((l) => [l.key, l])), [lanes]);
  const cardFields = useMemo(() => project.fields.filter((f) => f.showOnCard), [project.fields]);
  const { collapsed, toggle } = useCollapsedLanes(project.id, groupBy);

  // Follow server data, except mid-drag (a teammate's change must not yank the card away).
  useEffect(() => {
    if (activeId === null) setCells(group(columnsList, lanes, tasks, laneFor));
  }, [tasks, columnsList, lanes, laneFor, activeId]);

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

  const cellOf = (id: UniqueIdentifier): string | undefined => {
    if (isCellId(id)) return cellOfDropId(id);
    for (const [cell, ids] of cells) if (ids.includes(Number(id))) return cell;
    return undefined;
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(Number(active.id));
    originCell.current = cellOf(active.id) ?? null;
  };

  // Moving across cells while dragging, so the card previews its new place.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = cellOf(active.id);
    const to = cellOf(over.id);
    if (from === undefined || to === undefined || from === to) return;
    const id = Number(active.id);
    setCells((prev) => {
      const target = (prev.get(to) ?? []).filter((x) => x !== id);
      let index = target.length;
      if (!isCellId(over.id)) {
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
    const to = over ? cellOf(over.id) : undefined;
    const task = tasksById.get(id);
    const columnId = to !== undefined ? columnOfCell(to) : undefined;
    const column = columnId !== undefined ? columnById.get(columnId) : undefined;
    const origin = originCell.current;
    if (!over || to === undefined || !task || !column || origin === null) {
      setCells(group(columnsList, lanes, tasks, laneFor));
      setActiveId(null);
      return;
    }

    let items = cells.get(to) ?? [];
    if (!isCellId(over.id)) {
      const oldIndex = items.indexOf(id);
      const newIndex = items.indexOf(Number(over.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) items = arrayMove(items, oldIndex, newIndex);
    }
    const next = new Map(cells);
    next.set(to, items);

    // The place in the column, counted across all rows (the server keeps one order per column).
    const columnOrder = lanes.flatMap((lane) => next.get(cellKey(lane.key, column.id)) ?? []);
    const index = columnOrder.indexOf(id);
    const afterId = index > 0 ? columnOrder[index - 1]! : null;
    const before = group(columnsList, lanes, tasks, laneFor);
    const moved = !(columnOfCell(origin) === column.id && sameCells(before, next));
    const patch = lanePatch(groupBy, project, task, laneOfCell(origin), laneOfCell(to));

    setCells(next);
    if (moved) {
      // Update the cache first so the board doesn't flicker back while the request is in flight.
      const places = new Map<number, { columnId: number; status: TaskStatus; position: number }>();
      for (const c of columnsList) {
        lanes.flatMap((lane) => next.get(cellKey(lane.key, c.id)) ?? []).forEach((taskId, position) => places.set(taskId, { columnId: c.id, status: c.stage, position }));
      }
      qc.setQueryData<Task[]>(qk.tasks(cacheKey), (old) =>
        old?.map((x) => {
          const place = places.get(x.id);
          if (!place) return x;
          const completedAt = place.status === 'done' ? (x.completedAt ?? new Date().toISOString()) : null;
          return { ...x, ...place, completedAt };
        }),
      );
      move.mutate(
        { id, columnId: column.id, afterId },
        {
          onSuccess: (result) => {
            if (result.next) toast.success(nextCopyMessage(result.next));
          },
          onError: (error) => toast.error(t('Couldn’t move the task: {error}', { error: errorMessage(error) })),
        },
      );
    }
    if (patch) {
      update.mutate({ id, patch }, { onError: (error) => toast.error(t('Couldn’t move the task: {error}', { error: errorMessage(error) })) });
    }
    setActiveId(null);
  };

  const placeOf = (id: UniqueIdentifier | undefined) => {
    const cell = id !== undefined ? cellOf(id) : undefined;
    if (cell === undefined) return undefined;
    const column = columnById.get(columnOfCell(cell))?.name ?? t('a column');
    const lane = laneByKey.get(laneOfCell(cell));
    return grouped && lane ? t('{column} in {lane}', { column, lane: lane.name }) : column;
  };

  const titleOf = (id: UniqueIdentifier) => tasksById.get(Number(id))?.title ?? t('the task');
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('Picked up {title}.', { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => {
      const name = placeOf(over?.id);
      return name ? t('{title} is over {column}.', { title: titleOf(active.id), column: name }) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const name = placeOf(over?.id);
      return name
        ? t('{title} dropped in {column}.', { title: titleOf(active.id), column: name })
        : t('{title} dropped.', { title: titleOf(active.id) });
    },
    onDragCancel: ({ active }) => t('Moving {title} was cancelled.', { title: titleOf(active.id) }),
  };

  const activeTask = activeId !== null ? tasksById.get(activeId) : undefined;
  const showAdd = canEditColumns && !readOnly && columnsList.length < MAX_COLUMNS;
  const columnCount = (columnId: number) => lanes.reduce((n, lane) => n + (cells.get(cellKey(lane.key, columnId))?.length ?? 0), 0);
  const cardProps = { labels: project.labels, fields: cardFields, parentTitles, usersById };

  const renderCell = (lane: Lane, column: BoardColumn) => (
    <BoardCell
      key={cellKey(lane.key, column.id)}
      cell={cellKey(lane.key, column.id)}
      lane={lane}
      column={column}
      projectId={project.id}
      taskIds={cells.get(cellKey(lane.key, column.id)) ?? []}
      tasksById={tasksById}
      card={cardProps}
      readOnly={readOnly}
      compact={grouped}
      onOpenTask={onOpenTask}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setCells(group(columnsList, lanes, tasks, laneFor));
        setActiveId(null);
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t(
            'To move a task, press Space to pick it up, use the arrow keys to move it, and press Space again to drop it. Press Enter to open it.',
          ),
        },
      }}
    >
      {grouped ? (
        <div className="board-lanes" style={{ '--board-cols': columnsList.length } as React.CSSProperties}>
          <div className="board-lanes-head">
            {columnsList.map((column, index) => (
              <div key={column.id} className="board-column board-column-head">
                <ColumnHeader
                  column={column}
                  index={index}
                  columns={columnsList}
                  projectId={project.id}
                  count={columnCount(column.id)}
                  readOnly={readOnly}
                  canEdit={canEditColumns && !readOnly}
                />
              </div>
            ))}
          </div>
          {lanes.map((lane) => {
            const count = columnsList.reduce((n, c) => n + (cells.get(cellKey(lane.key, c.id))?.length ?? 0), 0);
            const isCollapsed = collapsed.has(lane.key);
            return (
              <section key={lane.key} className={`board-lane ${isCollapsed ? 'is-collapsed' : ''}`} aria-label={lane.name}>
                <button type="button" className="board-lane-header" aria-expanded={!isCollapsed} onClick={() => toggle(lane.key)}>
                  {isCollapsed ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
                  {lane.icon}
                  <span className="truncate">{lane.name}</span>
                  <span className="board-count num">{count}</span>
                </button>
                {!isCollapsed && <div className="board-lane-row">{columnsList.map((column) => renderCell(lane, column))}</div>}
              </section>
            );
          })}
        </div>
      ) : (
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
              projectId={project.id}
              count={columnCount(column.id)}
              readOnly={readOnly}
              canEdit={canEditColumns && !readOnly}
            >
              {renderCell(lanes[0]!, column)}
            </BoardColumnView>
          ))}
          {showAdd && <AddColumn projectId={project.id} open={addingColumn} onOpenChange={setAddingColumn} />}
        </div>
      )}
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {activeTask ? <TaskCard task={activeTask} {...cardProps} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumnView({ column, children, ...header }: ColumnHeaderProps & { children: ReactNode }) {
  return (
    <section className="board-column" aria-label={column.name}>
      <ColumnHeader column={column} {...header} />
      {children}
    </section>
  );
}

interface ColumnHeaderProps {
  column: BoardColumn;
  index: number;
  columns: BoardColumn[];
  projectId: number;
  count: number;
  readOnly: boolean;
  canEdit: boolean;
}

function ColumnHeader({ column, index, columns, projectId, count, readOnly, canEdit }: ColumnHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = useUpdateColumn();
  const reorder = useReorderColumns(projectId);
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
    <header className="board-column-header">
      <StatusIcon status={column.stage} />
      {renaming ? (
        <RenameColumn column={column} onDone={() => setRenaming(false)} />
      ) : (
        <h3 className="truncate" title={`${column.name} (${t(TASK_STATUS_LABELS[column.stage])})`}>
          {column.name}
        </h3>
      )}
      <span className="board-count num">{count}</span>
      <span className="spacer" />
      {canEdit && !renaming && !readOnly && (
        <Menu
          trigger={(props) => (
            <button type="button" className="icon-btn icon-btn-sm" aria-label={t('Options for column {name}', { name: column.name })} {...props}>
              <Ellipsis size={16} />
            </button>
          )}
        >
          <MenuItem icon={<Pencil size={16} />} onSelect={() => setRenaming(true)}>
            {t('Rename')}
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>{t('Counts as')}</MenuLabel>
          {TASK_STATUSES.map((stage) => (
            <MenuItem key={stage} icon={<StatusIcon status={stage} size={16} />} onSelect={() => setStage(stage)}>
              {t(TASK_STATUS_LABELS[stage])}
              {column.stage === stage && <span className="muted" style={{ marginLeft: 'auto' }}>✓</span>}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<ArrowLeft size={16} />} onSelect={() => moveColumn(-1)} disabled={index === 0}>
            {t('Move left')}
          </MenuItem>
          <MenuItem icon={<ArrowRight size={16} />} onSelect={() => moveColumn(1)} disabled={index === columns.length - 1}>
            {t('Move right')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setDeleting(true)}>
            {t('Delete column…')}
          </MenuItem>
        </Menu>
      )}
      <DeleteColumnDialog column={column} columns={columns} count={count} open={deleting} onClose={() => setDeleting(false)} />
    </header>
  );
}

interface CardProps {
  labels: Label[];
  fields: CustomField[];
  parentTitles?: Map<number, string>;
  usersById: Map<number, User>;
}

/** One column in one row: the cards, and a way to add a task right there. */
function BoardCell({
  cell,
  lane,
  column,
  projectId,
  taskIds,
  tasksById,
  card,
  readOnly,
  compact,
  onOpenTask,
}: {
  cell: string;
  lane: Lane;
  column: BoardColumn;
  projectId: number;
  taskIds: number[];
  tasksById: Map<number, Task>;
  card: CardProps;
  readOnly: boolean;
  /** In a swimlane: no "No tasks" box, so empty rows stay short. */
  compact: boolean;
  onOpenTask: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(cell), disabled: readOnly });
  const [composing, setComposing] = useState(false);
  const where = lane.name ? t('{column} in {lane}', { column: column.name, lane: lane.name }) : column.name;
  return (
    <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className={`board-column-body ${isOver ? 'is-over' : ''} ${compact ? 'board-cell' : ''}`} aria-label={compact ? where : undefined}>
        {taskIds.map((id) => {
          const task = tasksById.get(id);
          if (!task) return null;
          return <SortableCard key={id} task={task} card={card} disabled={readOnly} onOpen={onOpenTask} />;
        })}
        {taskIds.length === 0 && !composing && !compact && <div className="board-empty">{t('No tasks')}</div>}
        {composing ? (
          <QuickAdd projectId={projectId} column={column} where={where} defaults={lane.defaults} onDone={() => setComposing(false)} />
        ) : (
          !readOnly && (
            <button type="button" className="board-add" onClick={() => setComposing(true)} aria-label={t('Add task to {name}', { name: where })}>
              <Plus size={15} aria-hidden /> {compact ? '' : t('Add task')}
            </button>
          )
        )}
      </div>
    </SortableContext>
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
      aria-label={t('Column name')}
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
          toast.success(t('Column “{name}” deleted', { name: column.name }));
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Delete “{name}”?', { name: column.name })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={remove.isPending || lastDone || lastOpen || !moveTo}>
            {remove.isPending && <Spinner size={16} />}
            {t('Delete column')}
          </button>
        </>
      }
    >
      <div className="modal-body stack" style={{ gap: 12 }}>
        {lastDone || lastOpen ? (
          <p className="secondary">
            {lastDone
              ? t('A board needs at least one column for finished work. Add another one first, or change what this column counts as.')
              : t('A board needs at least one column for unfinished work. Add another one first, or change what this column counts as.')}
          </p>
        ) : (
          <>
            <p className="secondary">
              {count === 0
                ? t('The column is empty.')
                : tn('Its task moves to another column.', 'Its {count} tasks move to another column.', count)}
            </p>
            <label className="field">
              <span className="field-label">{t('Move tasks to')}</span>
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
      <button type="button" className="board-add-column" onClick={() => setOpen(true)} aria-label={t('Add column')} title={t('Add column')}>
        <Plus size={18} aria-hidden />
      </button>
    );
  }
  return (
    <form className="board-column board-new-column" onSubmit={submit}>
      <label className="field">
        <span className="field-label">{t('Column name')}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder={t('e.g. Waiting for client')} />
      </label>
      <label className="field">
        <span className="field-label">{t('Counts as')}</span>
        <select className="select" value={stage} onChange={(e) => setStage(e.target.value as TaskStatus)}>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(TASK_STATUS_LABELS[s])}
            </option>
          ))}
        </select>
        <span className="field-hint">{t('Progress and the dashboard use this.')}</span>
      </label>
      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={add.isPending || !name.trim()}>
          {t('Add column')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

const SortableCard = memo(function SortableCard({
  task,
  card,
  disabled,
  onOpen,
}: {
  task: Task;
  card: CardProps;
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
      aria-roledescription={disabled ? t('Task') : t('Draggable task')}
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        // Enter opens the task, unless it is being used to drop a card picked up with the keyboard.
        if (event.key === 'Enter' && !isDragging && !event.defaultPrevented) onOpen(task.id);
      }}
    >
      <TaskCard task={task} {...card} />
    </div>
  );
});

export function TaskCard({
  task,
  labels,
  fields = [],
  parentTitles,
  usersById,
  overlay,
}: CardProps & {
  task: Task;
  overlay?: boolean;
}) {
  const blocked = task.openBlockerCount > 0 && task.status !== 'done';
  const assignee = task.assigneeId ? usersById.get(task.assigneeId) : undefined;
  const parentTitle = task.parentId !== null ? parentTitles?.get(task.parentId) : undefined;
  const shownFields = fields.filter((f) => task.fieldValues[f.id] !== undefined);
  return (
    <article className={`task-card ${overlay ? 'is-overlay' : ''} ${task.status === 'done' ? 'is-done' : ''}`}>
      {parentTitle && (
        <span className="task-card-parent truncate" title={t('Subtask of {title}', { title: parentTitle })}>
          <CornerLeftUp size={12} aria-hidden /> {parentTitle}
        </span>
      )}
      {task.labelIds.length > 0 && <LabelList ids={task.labelIds} labels={labels} />}
      <p className="task-card-title">{task.title}</p>
      {shownFields.length > 0 && (
        <span className="task-card-fields">
          {shownFields.map((f) => (
            <FieldChip key={f.id} field={f} value={task.fieldValues[f.id]} />
          ))}
        </span>
      )}
      <div className="task-card-meta">
        <PriorityIcon priority={task.priority} />
        {blocked && (
          <span className="chip chip-blocked" title={tn('Waiting for {count} other task', 'Waiting for {count} other tasks', task.openBlockerCount)}>
            <Lock size={12} aria-hidden />
            {t('Blocked')}
          </span>
        )}
        <DueChip dueDate={task.dueDate} status={task.status} />
        {task.recurrence && (
          <span className="chip" title={describeRecurrence(task.recurrence, tr())}>
            <Repeat size={13} aria-label={describeRecurrence(task.recurrence, tr())} />
          </span>
        )}
        {task.subtaskTotal > 0 && (
          <span
            className={`chip ${task.subtaskDone === task.subtaskTotal ? 'chip-complete' : ''}`}
            title={t('{done} of {total} subtasks done', { done: task.subtaskDone, total: task.subtaskTotal })}
          >
            <ListTree size={13} aria-hidden />
            {task.subtaskDone}/{task.subtaskTotal}
          </span>
        )}
        {task.checklistTotal > 0 && (
          <span
            className={`chip ${task.checklistDone === task.checklistTotal ? 'chip-complete' : ''}`}
            title={t('{done} of {total} checklist items done', { done: task.checklistDone, total: task.checklistTotal })}
          >
            <ListChecks size={13} aria-hidden />
            {task.checklistDone}/{task.checklistTotal}
          </span>
        )}
        {task.attachmentCount > 0 && (
          <span className="chip" title={tn('{count} file', '{count} files', task.attachmentCount)}>
            <Paperclip size={13} aria-hidden />
            {task.attachmentCount}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="chip" title={tn('{count} comment', '{count} comments', task.commentCount)}>
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

function QuickAdd({
  projectId,
  column,
  where,
  defaults,
  onDone,
}: {
  projectId: number;
  column: BoardColumn;
  /** The column (and row) name, for the label. */
  where: string;
  /** Values from the row the task is added in. */
  defaults: Partial<TaskInput>;
  onDone: () => void;
}) {
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
      { ...defaults, projectId, title: value, columnId: column.id },
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
        placeholder={t('Task title… (Enter to add, Esc to close)')}
        aria-label={t('New task in {name}', { name: where })}
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
          {t('Add')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}
