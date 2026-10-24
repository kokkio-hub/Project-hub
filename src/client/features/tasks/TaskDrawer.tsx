import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Archive, Ellipsis, Link2, Pencil, Trash2, X } from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Comment,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../../shared/types';
import { ApiError, errorMessage } from '../../api/client';
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
import { useCurrentUser } from '../../auth/session';
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

function TaskDetails({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const me = useCurrentUser();
  const task = useTask(taskId);
  const { data: projects } = useProjects(true);
  const { users, byId } = useUsers();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const confirm = useConfirm();
  const toast = useToast();

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
          <ErrorNotice error={gone ? new Error('This task no longer exists. It may have been deleted.') : task.error} />
        </div>
      </>
    );
  }

  const t = task.data;
  const project = projects?.find((p) => p.id === t.projectId);
  const readOnly = project?.status === 'archived';
  const canDelete = me.role === 'admin' || t.createdBy === me.id || project?.ownerId === me.id;
  const creator = t.createdBy ? byId.get(t.createdBy) : undefined;

  const save = (patch: TaskPatch) =>
    update.mutate({ id: t.id, patch }, { onError: (error) => toast.error(errorMessage(error)) });

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
      message: `“${t.title}” and its comments will be permanently deleted.`,
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (!ok) return;
    remove.mutate(t.id, {
      onSuccess: () => {
        toast.success('Task deleted');
        onClose();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
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
        {canDelete && !readOnly && (
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
        {readOnly && (
          <div className="alert alert-info" style={{ marginBottom: 14 }}>
            <Archive size={16} aria-hidden />
            This project is archived, so its tasks are read-only.
          </div>
        )}

        <TitleEditor task={t} readOnly={readOnly} onSave={(title) => save({ title })} />

        <dl className="props">
          <dt>Status</dt>
          <dd>
            <StatusIcon status={t.status} />
            <select
              className="select select-sm"
              value={t.status}
              disabled={readOnly}
              aria-label="Status"
              onChange={(e) => save({ status: e.target.value as TaskStatus })}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
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
              users={users}
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
                .filter((p) => p.status !== 'archived' || p.id === t.projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </dd>
        </dl>

        <DescriptionEditor task={t} readOnly={readOnly} onSave={(description) => save({ description })} />

        <Comments taskId={t.id} readOnly={readOnly} />

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
  const latest = useRef({ value, saved: task.title, onSave });
  latest.current = { value, saved: task.title, onSave };
  useEffect(() => setValue(task.title), [task.title]);

  // Save an unsaved edit if the drawer closes while typing (e.g. with Escape).
  useEffect(
    () => () => {
      const { value: v, saved, onSave: save } = latest.current;
      if (v.trim() && v.trim() !== saved) save(v.trim());
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
  const latest = useRef({ value, saved: task.description, onSave });
  latest.current = { value, saved: task.description, onSave };

  useEffect(() => {
    if (!focused) setValue(task.description);
  }, [task.description, focused]);

  // Save unsaved edits if the drawer closes while typing.
  useEffect(
    () => () => {
      const { value: v, saved, onSave: save } = latest.current;
      if (v !== saved) save(v);
    },
    [],
  );

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

function Comments({ taskId, readOnly }: { taskId: number; readOnly: boolean }) {
  const me = useCurrentUser();
  const { byId } = useUsers();
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
            <textarea
              ref={ref}
              className="textarea"
              rows={2}
              value={draft}
              placeholder="Write a comment…"
              aria-label="New comment"
              onChange={(e) => setDraft(e.target.value)}
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
  author,
  canEdit,
  canDelete,
}: {
  comment: Comment;
  taskId: number;
  author: ReturnType<typeof useUsers>['users'][number] | undefined;
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
            <textarea
              className="textarea"
              value={value}
              onChange={(e) => setValue(e.target.value)}
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
          <p className="comment-body">{comment.body}</p>
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
