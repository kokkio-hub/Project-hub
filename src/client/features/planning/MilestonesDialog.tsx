import { useState, type FormEvent } from 'react';
import { Diamond, Pencil, Plus, Trash2 } from 'lucide-react';
import { localToday } from '../../../shared/dates';
import { MAX_MILESTONES, type Milestone, type Project, type Task } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useCreateMilestone, useDeleteMilestone, useUpdateMilestone } from '../../api/planning';
import { Meter } from '../../components/Bits';
import { EmptyState, Spinner, useConfirm, useToast } from '../../components/Feedback';
import { Modal } from '../../components/Modal';
import { formatDate, relativeDay } from '../../lib/format';
import { t, tn } from '../../i18n';

/** Linked open tasks that are due after the milestone: the milestone is at risk. */
export function lateTasksFor(milestone: Milestone, tasks: Task[]): number {
  return tasks.filter((x) => x.milestoneId === milestone.id && x.status !== 'done' && !!x.dueDate && x.dueDate > milestone.date).length;
}

/** The project's milestones: add, rename, move, mark reached and remove them. */
export function MilestonesDialog({
  project,
  tasks,
  open,
  onClose,
  readOnly,
}: {
  project: Project;
  tasks: Task[];
  open: boolean;
  onClose: () => void;
  readOnly: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={t('Milestones')} wide>
      {open && <MilestonesBody project={project} tasks={tasks} readOnly={readOnly} />}
    </Modal>
  );
}

function MilestonesBody({ project, tasks, readOnly }: { project: Project; tasks: Task[]; readOnly: boolean }) {
  const create = useCreateMilestone(project.id);
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState(project.dueDate ?? '');
  const milestones = [...project.milestones].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !date) return;
    create.mutate(
      { name: name.trim(), date },
      {
        onSuccess: () => {
          setName('');
          toast.success(t('Milestone added'));
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <div className="modal-body stack" style={{ gap: 16 }}>
      <p className="secondary">
        {t('Milestones are the moments that matter, like a launch or a client review. Link tasks to them to see whether you’ll make it.')}
      </p>
      {milestones.length === 0 ? (
        <EmptyState icon={<Diamond size={22} />} title={t('No milestones yet')}>
          {readOnly ? t('Nothing here yet.') : t('Add the first one below.')}
        </EmptyState>
      ) : (
        <ul className="milestone-list">
          {milestones.map((m) => (
            <MilestoneRow key={m.id} milestone={m} lateTasks={lateTasksFor(m, tasks)} readOnly={readOnly} />
          ))}
        </ul>
      )}
      {!readOnly && milestones.length < MAX_MILESTONES && (
        <form className="milestone-new" onSubmit={add}>
          <input
            className="input input-sm"
            value={name}
            maxLength={100}
            placeholder={t('New milestone, e.g. Launch')}
            aria-label={t('Milestone name')}
            onChange={(e) => setName(e.target.value)}
          />
          <input type="date" className="input input-sm" value={date} aria-label={t('Milestone date')} onChange={(e) => setDate(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim() || !date || create.isPending}>
            {create.isPending ? <Spinner size={14} /> : <Plus size={14} />} {t('Add milestone')}
          </button>
        </form>
      )}
    </div>
  );
}

function MilestoneRow({ milestone: m, lateTasks, readOnly }: { milestone: Milestone; lateTasks: number; readOnly: boolean }) {
  const update = useUpdateMilestone();
  const remove = useDeleteMilestone();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [date, setDate] = useState(m.date);
  const [description, setDescription] = useState(m.description);
  const today = localToday();
  const late = !m.reachedAt && m.date < today;

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !date) return;
    update.mutate(
      { id: m.id, patch: { name: name.trim(), date, description } },
      { onSuccess: () => setEditing(false), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const del = async () => {
    const ok = await confirm({
      title: t('Delete the milestone “{name}”?', { name: m.name }),
      message: t('Its tasks stay; they’re just no longer linked to a milestone.'),
      confirmLabel: t('Delete milestone'),
      danger: true,
    });
    if (ok) remove.mutate(m.id, { onError: (e) => toast.error(errorMessage(e)) });
  };

  if (editing) {
    return (
      <li className="milestone-row is-editing">
        <form className="stack" style={{ gap: 8, flex: 1 }} onSubmit={save}>
          <div className="milestone-new">
            <input className="input input-sm" value={name} maxLength={100} autoFocus aria-label={t('Milestone name')} onChange={(e) => setName(e.target.value)} />
            <input type="date" className="input input-sm" value={date} aria-label={t('Milestone date')} onChange={(e) => setDate(e.target.value)} />
          </div>
          <textarea
            className="textarea"
            rows={2}
            value={description}
            maxLength={2000}
            placeholder={t('What does reaching it mean? (optional)')}
            aria-label={t('Description')}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="row">
            <button type="submit" className="btn btn-primary btn-sm" disabled={update.isPending || !name.trim() || !date}>
              {t('Save')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditing(false);
                setName(m.name);
                setDate(m.date);
                setDescription(m.description);
              }}
            >
              {t('Cancel')}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`milestone-row ${m.reachedAt ? 'is-reached' : ''} ${late ? 'is-late' : ''}`}>
      <input
        type="checkbox"
        className="checkbox"
        checked={m.reachedAt !== null}
        disabled={readOnly}
        aria-label={m.reachedAt ? t('Mark {name} as not reached', { name: m.name }) : t('Mark {name} as reached', { name: m.name })}
        onChange={(e) => update.mutate({ id: m.id, patch: { reached: e.target.checked } }, { onError: (err) => toast.error(errorMessage(err)) })}
      />
      <div className="milestone-main">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Diamond size={14} className="milestone-icon" aria-hidden />
          <strong className="truncate">{m.name}</strong>
          <span className="secondary num">
            {formatDate(m.date)}
            {relativeDay(m.date, today) !== formatDate(m.date) && ` · ${relativeDay(m.date, today)}`}
          </span>
          {m.reachedAt ? (
            <span className="badge badge-success">{t('Reached')}</span>
          ) : late ? (
            <span className="badge badge-critical">{t('Date has passed')}</span>
          ) : (
            lateTasks > 0 && (
              <span className="badge badge-warning">{tn('{count} task due after it', '{count} tasks due after it', lateTasks)}</span>
            )
          )}
        </div>
        {m.description && <p className="secondary milestone-description">{m.description}</p>}
        {m.taskCount > 0 ? (
          <div className="meter-row">
            <Meter value={m.doneCount / m.taskCount} label={t('{name} progress', { name: m.name })} tone={late ? 'critical' : lateTasks > 0 ? 'warning' : undefined} />
            <span className="muted num" style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
              {t('{done}/{total} done', { done: m.doneCount, total: m.taskCount })}
            </span>
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('No tasks linked yet. Pick this milestone in a task’s details.')}
          </span>
        )}
      </div>
      {!readOnly && (
        <span className="row" style={{ gap: 2 }}>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label={t('Edit {name}', { name: m.name })}>
            <Pencil size={14} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => void del()} aria-label={t('Delete {name}', { name: m.name })}>
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </li>
  );
}
