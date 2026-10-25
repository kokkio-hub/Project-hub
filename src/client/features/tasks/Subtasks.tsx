import { useMemo, useState, type FormEvent } from 'react';
import { CornerLeftUp, Plus } from 'lucide-react';
import { MAX_SUBTASKS, type Task } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useCreateTask, useTask, useTasks, useUpdateTask, useUsers } from '../../api/queries';
import { Avatar } from '../../components/Avatar';
import { DueChip, Meter } from '../../components/Bits';
import { Spinner, useToast } from '../../components/Feedback';
import { useOpenTask } from '../../lib/hooks';
import { nextCopyMessage } from '../board/KanbanBoard';
import { t } from '../../i18n';

/** "Subtask of …": a link back to the main task. */
export function ParentLink({ parentId }: { parentId: number }) {
  const parent = useTask(parentId);
  const openTask = useOpenTask();
  return (
    <button type="button" className="parent-link" onClick={() => openTask(parentId)}>
      <CornerLeftUp size={14} aria-hidden />
      <span className="truncate">{t('Subtask of {title}', { title: parent.data?.title ?? '…' })}</span>
    </button>
  );
}

/** A task's subtasks in its details: tick them off, open them, add new ones. */
export function Subtasks({ task, readOnly }: { task: Task; readOnly: boolean }) {
  const query = useMemo(() => ({ projectId: task.projectId }), [task.projectId]);
  const tasks = useTasks(query);
  const { byId } = useUsers();
  const create = useCreateTask();
  const update = useUpdateTask();
  const openTask = useOpenTask();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const subtasks = useMemo(
    () => (tasks.data ?? []).filter((x) => x.parentId === task.id).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.id - b.id),
    [tasks.data, task.id],
  );
  const done = subtasks.filter((x) => x.status === 'done').length;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    create.mutate(
      { projectId: task.projectId, title, parentId: task.id, status: 'todo' },
      { onSuccess: () => setDraft(''), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const toggle = (subtask: Task, finished: boolean) =>
    update.mutate(
      { id: subtask.id, patch: { status: finished ? 'done' : 'todo' } },
      {
        onSuccess: (result) => {
          if (result.next) toast.success(nextCopyMessage(result.next));
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  if (readOnly && subtasks.length === 0) return null;

  return (
    <section className="drawer-section">
      <h3 className="section-title">
        {t('Subtasks')} {subtasks.length > 0 && <span className="muted num">{done}/{subtasks.length}</span>}
      </h3>
      {subtasks.length > 0 && (
        <div className="meter-row" style={{ marginBottom: 8 }}>
          <Meter value={done / subtasks.length} label={t('Subtask progress')} />
        </div>
      )}
      {tasks.isPending ? (
        <Spinner />
      ) : (
        subtasks.length > 0 && (
          <ul className="subtasks">
            {subtasks.map((subtask) => {
              const finished = subtask.status === 'done';
              return (
                <li key={subtask.id} className={`subtask ${finished ? 'is-done' : ''}`}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={finished}
                    disabled={readOnly}
                    aria-label={finished ? t('Reopen {title}', { title: subtask.title }) : t('Finish {title}', { title: subtask.title })}
                    onChange={(e) => toggle(subtask, e.target.checked)}
                  />
                  <button type="button" className="subtask-title" onClick={() => openTask(subtask.id)}>
                    <span className="truncate">{subtask.title}</span>
                  </button>
                  <DueChip dueDate={subtask.dueDate} status={subtask.status} showIcon={false} />
                  {subtask.assigneeId !== null && <Avatar user={byId.get(subtask.assigneeId) ?? null} size="xs" />}
                </li>
              );
            })}
          </ul>
        )
      )}
      {!readOnly &&
        subtasks.length < MAX_SUBTASKS &&
        (adding ? (
          <form className="row" style={{ gap: 6, marginTop: 6 }} onSubmit={submit}>
            <input
              className="input input-sm"
              value={draft}
              maxLength={200}
              autoFocus
              placeholder={t('Subtask title')}
              aria-label={t('New subtask')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(false);
                  setDraft('');
                }
              }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending || !draft.trim()}>
              {t('Add')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              {t('Done')}
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> {t('Add subtask')}
          </button>
        ))}
    </section>
  );
}
