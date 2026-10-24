import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Archive, Ellipsis, Eye, Link2, Pencil, Repeat, Trash2, X } from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type Comment,
  type Project,
  type Recurrence,
  type Task,
  type TaskPriority,
  type User,
} from '../../../shared/types';
import { describeRecurrence } from '../../../shared/recurrence';
import { ApiError, errorMessage } from '../../api/client';
import { undoDelete, useMarkRead, useNotifications } from '../../api/inbox';
import { useQueryClient } from '@tanstack/react-query';
import {
  useActivity,
  useAddComment,
  useComments,
  useDeleteComment,
  useDeleteTask,
  useEditComment,
  useProjects,
  useTask,
  useUpdateTask,
  useUsers,
  type TaskPatch,
} from '../../api/queries';
import { canChangeWork, useCurrentUser } from '../../auth/session';
import { Avatar } from '../../components/Avatar';
import { DueChip } from '../../components/Bits';
import { ErrorNotice, PageLoading, Spinner, useConfirm, useToast } from '../../components/Feedback';
import { UserSelect } from '../../components/Form';
import { PriorityIcon, ProjectDot, StatusIcon } from '../../components/Icons';
import { Menu, MenuItem } from '../../components/Menu';
import { Modal } from '../../components/Modal';
import { formatDateTime, timeAgo } from '../../lib/format';
import { useAutosize, useNow } from '../../lib/hooks';
import { describeActivity } from '../activity/describe';
import { nextCopyMessage } from '../board/KanbanBoard';
import { LabelList, LabelPicker } from '../labels/Labels';
import { Attachments } from './Attachments';
import { Checklist } from './Checklist';
import { Dependencies } from './Dependencies';
import { MentionText, MentionTextarea } from './Mentions';

export function TaskDrawer({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  return (
    <Modal open={taskId !== null} onClose={onClose} title="Task" className="drawer" header={<></>} labelledBy="task-title">
      {taskId !== null && <TaskDetails key={taskId} taskId={taskId} onClose={onClose} />}
    </Modal>
  );
}

/** Dates typed digit by digit pass through years like 0002; only save plausible ones. */
function plausibleDate(value: string): boolean {
  return value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900);
}

/** People who can be given a task in this project: team members who can see it. */
export function assignableUsers(users: User[], project: Project | undefined): User[] {
  return users.filter(
    (u) =>
      u.role !== 'guest' &&
      (!project ||
        project.visibility === 'team' ||
        u.role === 'admin' ||
        u.id === project.ownerId ||
        project.memberIds.includes(u.id)),
  );
}

/** People who can see the project, who can be @mentioned in its comments. */
export function mentionableUsers(users: User[], project: Project | undefined): User[] {
  return users.filter(
    (u) =>
      u.isActive &&
      (!project ||
        u.role === 'admin' ||
        u.id === project.ownerId ||
        project.memberIds.includes(u.id) ||
        (project.visibility === 'team' && u.role !== 'guest')),
  );
}

const REPEAT_OPTIONS: { label: string; value: Recurrence | null }[] = [
  { label: 'Doesn’t repeat', value: null },
  { label: 'Every day', value: { freq: 'daily', interval: 1 } },
  { label: 'Every week', value: { freq: 'weekly', interval: 1 } },
  { label: 'Every 2 weeks', value: { freq: 'weekly', interval: 2 } },
  { label: 'Every month', value: { freq: 'monthly', interval: 1 } },
  { label: 'Every 3 months', value: { freq: 'monthly', interval: 3 } },
  { label: 'Every year', value: { freq: 'yearly', interval: 1 } },
];

const repeatKey = (r: Recurrence | null) => (r ? `${r.freq}:${r.interval}` : '');

export function RepeatSelect({
  value,
  onChange,
  disabled,
  id,
  className = 'select select-sm',
}: {
  value: Recurrence | null;
  onChange: (value: Recurrence | null) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const options = REPEAT_OPTIONS.some((o) => repeatKey(o.value) === repeatKey(value))
    ? REPEAT_OPTIONS
    : [...REPEAT_OPTIONS, { label: describeRecurrence(value!), value }];
  return (
    <select
      id={id}
      className={className}
      value={repeatKey(value)}
      disabled={disabled}
      aria-label="Repeats"
      onChange={(e) => onChange(options.find((o) => repeatKey(o.value) === e.target.value)?.value ?? null)}
    >
      {options.map((o) => (
        <option key={repeatKey(o.value)} value={repeatKey(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DrawerHeader({ children, onClose }: { children?: ReactNode; onClose: () => void }) {
  return (
    <div className="drawer-header">
      {children}
      <span className="spacer" />
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close task">
        <X size={18} />
      </button>
    </div>
  );
}

/** Opening a task marks its notifications as read. */
function useReadOnOpen(taskId: number) {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const unread = data?.notifications.some((n) => n.taskId === taskId && !n.readAt) ?? false;
  const done = useRef(false);
  useEffect(() => {
    if (unread && !done.current) {
      done.current = true;
      markRead.mutate({ taskId });
    }
  }, [unread, taskId, markRead]);
}

function TaskDetails({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const me = useCurrentUser();
  // Set once this task is deleted from here. The drawer is closing by then; showing
  // nothing keeps it from reloading the task and its sections, which are gone.
  const [deleted, setDeleted] = useState(false);
  const task = useTask(deleted ? null : taskId);
  const { data: projects } = useProjects(true, 'include');
  const { users, byId } = useUsers();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  useReadOnOpen(taskId);
  const projectsById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);

  if (deleted) return null;
  if (task.isPending) {
    return (
      <>
        <DrawerHeader onClose={onClose} />
        <PageLoading />
      </>
    );
  }
  if (task.isError) {
    const gone = task.error instanceof ApiError && task.error.status === 404;
    return (
      <>
        <DrawerHeader onClose={onClose} />
        <div className="drawer-body">
          <ErrorNotice error={gone ? new Error('This task no longer exists. It may have been deleted, or you don’t have access to it.') : task.error} />
        </div>
      </>
    );
  }

  const t = task.data;
  const project = projectsById.get(t.projectId);
  const archived = project?.status === 'archived';
  const guest = !canChangeWork(me);
  const readOnly = archived || guest;
  const manager = me.role === 'admin' || (project?.ownerId ?? null) === me.id;
  const canDelete = !guest && (manager || t.createdBy === me.id);
  const creator = t.createdBy ? byId.get(t.createdBy) : undefined;
  const columns = [...(project?.columns ?? [])].sort((a, b) => a.position - b.position);
  const column = columns.find((c) => c.id === t.columnId);

  const save = (patch: TaskPatch) =>
    update.mutate(
      { id: t.id, patch },
      {
        onSuccess: (result) => {
          if (result.next) toast.success(nextCopyMessage(result.next));
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  const setStart = (value: string) => {
    if (!plausibleDate(value)) return;
    const startDate = value || null;
    const patch: TaskPatch = { startDate };
    if (startDate && t.dueDate && startDate > t.dueDate) patch.dueDate = startDate;
    save(patch);
  };
  const setDue = (value: string) => {
    if (!plausibleDate(value)) return;
    const dueDate = value || null;
    const patch: TaskPatch = { dueDate };
    if (dueDate && t.startDate && dueDate < t.startDate) patch.startDate = dueDate;
    save(patch);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?task=${t.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.info(url);
    }
  };

  const deleteTask = async () => {
    const ok = await confirm({
      title: 'Delete this task?',
      message: `“${t.title}” moves to the trash. You can restore it from there for 30 days.`,
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (!ok) return;
    const item = { kind: 'task' as const, id: t.id };
    setDeleted(true);
    onClose();
    remove.mutateAsync(t.id).then(
      () =>
        toast.success('Task moved to the trash', {
          label: 'Undo',
          onClick: () =>
            void undoDelete(queryClient, item).then(
              () => toast.success('Task restored'),
              (error) => toast.error(errorMessage(error)),
            ),
        }),
      (error) => toast.error(errorMessage(error)),
    );
  };

  return (
    <>
      <DrawerHeader onClose={onClose}>
        {project && (
          <Link to={`/projects/${project.id}`} className="drawer-project" onClick={onClose}>
            <ProjectDot color={project.color} />
            <span className="truncate">{project.name}</span>
          </Link>
        )}
        <span className="muted num" style={{ fontSize: 'var(--text-sm)' }}>
          #{t.id}
        </span>
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={copyLink} aria-label="Copy link to task" title="Copy link">
          <Link2 size={17} />
        </button>
        {canDelete && !archived && (
          <Menu
            trigger={(props) => (
              <button type="button" className="icon-btn" aria-label="More actions" {...props}>
                <Ellipsis size={18} />
              </button>
            )}
          >
            <MenuItem icon={<Trash2 size={16} />} danger onSelect={deleteTask}>
              Delete task
            </MenuItem>
          </Menu>
        )}
      </DrawerHeader>

      <div className="drawer-body">
        {archived && (
          <div className="alert alert-info" style={{ marginBottom: 14 }}>
            <Archive size={16} aria-hidden />
            This project is archived, so its tasks are read-only.
          </div>
        )}
        {guest && !archived && (
          <div className="alert alert-info" style={{ marginBottom: 14 }}>
            <Eye size={16} aria-hidden />
            You’re a guest here: you can read everything and leave comments.
          </div>
        )}

        <TitleEditor task={t} readOnly={readOnly} onSave={(title) => save({ title })} />

        <dl className="props">
          <dt>Column</dt>
          <dd>
            <StatusIcon status={t.status} />
            {readOnly ? (
              <span>{column?.name ?? TASK_STATUS_LABELS[t.status]}</span>
            ) : (
              <select
                className="select select-sm"
                value={t.columnId ?? ''}
                aria-label="Column"
                onChange={(e) => save({ columnId: Number(e.target.value) })}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.name.toLowerCase() !== TASK_STATUS_LABELS[c.stage].toLowerCase() ? ` (${TASK_STATUS_LABELS[c.stage]})` : ''}
                  </option>
                ))}
              </select>
            )}
          </dd>

          <dt>Priority</dt>
          <dd>
            <PriorityIcon priority={t.priority} />
            <select
              className="select select-sm"
              value={t.priority}
              disabled={readOnly}
              aria-label="Priority"
              onChange={(e) => save({ priority: e.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </dd>

          <dt>Assignee</dt>
          <dd>
            <Avatar user={t.assigneeId ? byId.get(t.assigneeId) : null} size="sm" />
            <UserSelect
              users={assignableUsers(users, project)}
              value={t.assigneeId}
              onChange={(assigneeId) => save({ assigneeId })}
              className="select select-sm"
              disabled={readOnly}
            />
          </dd>

          <dt>Start date</dt>
          <dd>
            <input
              type="date"
              className="input input-sm"
              value={t.startDate ?? ''}
              max={t.dueDate ?? undefined}
              disabled={readOnly}
              aria-label="Start date"
              onChange={(e) => setStart(e.target.value)}
            />
          </dd>

          <dt>Due date</dt>
          <dd>
            <input
              type="date"
              className="input input-sm"
              value={t.dueDate ?? ''}
              disabled={readOnly}
              aria-label="Due date"
              onChange={(e) => setDue(e.target.value)}
            />
            <DueChip dueDate={t.dueDate} status={t.status} showIcon />
          </dd>

          <dt>Repeats</dt>
          <dd>
            <Repeat size={14} className="secondary" aria-hidden />
            <RepeatSelect value={t.recurrence} onChange={(recurrence) => save({ recurrence })} disabled={readOnly} />
          </dd>

          <dt>Labels</dt>
          <dd className="labels-prop">
            <LabelList ids={t.labelIds} labels={project?.labels ?? []} size="md" />
            {!readOnly && project && (
              <LabelPicker projectId={project.id} labels={project.labels} value={t.labelIds} onChange={(labelIds) => save({ labelIds })} />
            )}
            {readOnly && t.labelIds.length === 0 && <span className="muted">None</span>}
          </dd>

          <dt>Project</dt>
          <dd>
            <select
              className="select select-sm"
              value={t.projectId}
              disabled={readOnly}
              aria-label="Project"
              onChange={(e) => save({ projectId: Number(e.target.value) })}
            >
              {(projects ?? [])
                .filter((p) => (p.status !== 'archived' && p.isTemplate === project?.isTemplate) || p.id === t.projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </dd>
        </dl>

        <DescriptionEditor task={t} readOnly={readOnly} onSave={(description) => save({ description })} />

        <Checklist taskId={t.id} readOnly={readOnly} />

        <Dependencies task={t} projectsById={projectsById} readOnly={readOnly} />

        <Attachments
          taskId={t.id}
          readOnly={readOnly}
          usersById={byId}
          canDelete={(a) => !guest && (a.userId === me.id || manager)}
        />

        <Comments taskId={t.id} readOnly={archived} people={mentionableUsers(users, project)} />

        <History taskId={t.id} />

        <p className="drawer-meta">
          Created {creator ? `by ${creator.name} ` : ''}
          {formatDateTime(t.createdAt)}
          {t.completedAt && ` · Completed ${formatDateTime(t.completedAt)}`}
        </p>
      </div>
    </>
  );
}

function TitleEditor({ task, readOnly, onSave }: { task: Task; readOnly: boolean; onSave: (title: string) => void }) {
  const [value, setValue] = useState(task.title);
  const ref = useAutosize(value);
  const latest = useRef({ value, saved: task.title, onSave, readOnly });
  latest.current = { value, saved: task.title, onSave, readOnly };
  useEffect(() => setValue(task.title), [task.title]);

  // Save an unsaved edit if the drawer closes while typing (e.g. with Escape).
  useEffect(
    () => () => {
      const { value: v, saved, onSave: save, readOnly: ro } = latest.current;
      if (!ro && v.trim() && v.trim() !== saved) save(v.trim());
    },
    [],
  );

  const commit = () => {
    const title = value.trim();
    if (!title) setValue(task.title);
    else if (title !== task.title) onSave(title);
  };

  return (
    <textarea
      ref={ref}
      id="task-title"
      className="title-input"
      value={value}
      rows={1}
      maxLength={200}
      readOnly={readOnly}
      aria-label="Task title"
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function DescriptionEditor({
  task,
  readOnly,
  onSave,
}: {
  task: Task;
  readOnly: boolean;
  onSave: (description: string) => void;
}) {
  const [value, setValue] = useState(task.description);
  const [focused, setFocused] = useState(false);
  const ref = useAutosize(value);
  const latest = useRef({ value, saved: task.description, onSave, readOnly });
  latest.current = { value, saved: task.description, onSave, readOnly };

  useEffect(() => {
    if (!focused) setValue(task.description);
  }, [task.description, focused]);

  // Save unsaved edits if the drawer closes while typing.
  useEffect(
    () => () => {
      const { value: v, saved, onSave: save, readOnly: ro } = latest.current;
      if (!ro && v !== saved) save(v);
    },
    [],
  );

  if (readOnly && !task.description) return null;

  return (
    <section className="drawer-section">
      <h3 className="section-title">Description</h3>
      <textarea
        ref={ref}
        className="textarea description-input"
        value={value}
        placeholder={readOnly ? 'No description.' : 'Add details, links or acceptance criteria…'}
        readOnly={readOnly}
        onFocus={() => setFocused(true)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (value !== task.description) onSave(value);
        }}
        rows={3}
        aria-label="Description"
      />
    </section>
  );
}

function Comments({ taskId, readOnly, people }: { taskId: number; readOnly: boolean; people: User[] }) {
  const me = useCurrentUser();
  const { byId, users } = useUsers();
  const { data: comments, isPending } = useComments(taskId);
  const add = useAddComment(taskId);
  const [draft, setDraft] = useState('');
  const ref = useAutosize(draft);
  const toast = useToast();
  useNow(60_000);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    add.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <section className="drawer-section">
      <h3 className="section-title">
        Comments {comments && comments.length > 0 && <span className="muted">{comments.length}</span>}
      </h3>
      {isPending ? (
        <Spinner />
      ) : (
        <ul className="comments">
          {comments?.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              taskId={taskId}
              people={people.length ? people : users}
              author={comment.userId ? byId.get(comment.userId) : undefined}
              canEdit={comment.userId === me.id && !readOnly}
              canDelete={(comment.userId === me.id || me.role === 'admin') && !readOnly}
            />
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="comment-composer">
          <Avatar user={me} size="sm" />
          <div className="stack" style={{ gap: 8, flex: 1 }}>
            <MentionTextarea
              textareaRef={ref}
              className="textarea"
              rows={2}
              value={draft}
              people={people.filter((p) => p.id !== me.id)}
              placeholder="Write a comment… Type @ to mention someone."
              aria-label="New comment"
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {draft.trim() && (
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={add.isPending}>
                  {add.isPending && <Spinner size={14} />}
                  Comment
                </button>
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                  <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function CommentItem({
  comment,
  taskId,
  people,
  author,
  canEdit,
  canDelete,
}: {
  comment: Comment;
  taskId: number;
  people: User[];
  author: User | undefined;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(comment.body);
  const edit = useEditComment(taskId);
  const remove = useDeleteComment(taskId);
  const confirm = useConfirm();
  const toast = useToast();

  const save = () => {
    const body = value.trim();
    if (!body || body === comment.body) {
      setEditing(false);
      setValue(comment.body);
      return;
    }
    edit.mutate(
      { id: comment.id, body },
      { onSuccess: () => setEditing(false), onError: (error) => toast.error(errorMessage(error)) },
    );
  };

  const del = async () => {
    if (!(await confirm({ title: 'Delete comment?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) {
      return;
    }
    remove.mutate(comment.id, { onError: (error) => toast.error(errorMessage(error)) });
  };

  return (
    <li className="comment">
      <Avatar user={author ?? null} size="sm" />
      <div className="comment-main">
        <div className="comment-head">
          <strong>{author?.name ?? 'Former member'}</strong>
          {author?.role === 'guest' && <span className="badge">Guest</span>}
          <span className="muted" title={formatDateTime(comment.createdAt)}>
            {timeAgo(comment.createdAt)}
            {comment.updatedAt !== comment.createdAt && ' · edited'}
          </span>
          <span className="spacer" />
          {canEdit && !editing && (
            <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label="Edit comment">
              <Pencil size={13} />
            </button>
          )}
          {canDelete && !editing && (
            <button type="button" className="icon-btn icon-btn-sm" onClick={del} aria-label="Delete comment">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {editing ? (
          <div className="stack" style={{ gap: 8 }}>
            <MentionTextarea
              className="textarea"
              value={value}
              people={people}
              onChange={setValue}
              autoFocus
              aria-label="Edit comment"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  e.preventDefault();
                  setEditing(false);
                  setValue(comment.body);
                }
              }}
            />
            <div className="row">
              <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={edit.isPending}>
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setEditing(false);
                  setValue(comment.body);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="comment-body">
            <MentionText text={comment.body} people={people} />
          </p>
        )}
      </div>
    </li>
  );
}

function History({ taskId }: { taskId: number }) {
  const [open, setOpen] = useState(false);
  const { byId } = useUsers();
  const { data: activity } = useActivity({ taskId, limit: 50 }, { enabled: open });
  return (
    <details className="drawer-section history" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="section-title">History</summary>
      {open && !activity && <Spinner />}
      <ul className="history-list">
        {activity?.map((item) => (
          <li key={item.id}>
            <span>{describeActivity(item, byId, 'task')}</span>
            <span className="muted" title={formatDateTime(item.createdAt)}>
              {timeAgo(item.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
