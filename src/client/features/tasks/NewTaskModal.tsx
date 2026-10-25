import { useEffect, useState, type FormEvent } from 'react';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type Recurrence, type TaskPriority, type TaskStatus } from '../../../shared/types';
import { ApiError } from '../../api/client';
import { useCreateTask, useProjects, useUsers } from '../../api/queries';
import { ErrorNotice, Spinner, useToast } from '../../components/Feedback';
import { Field, UserSelect } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { LabelList, LabelPicker } from '../labels/Labels';
import { assignableUsers, RepeatSelect } from './TaskDrawer';
import { t } from '../../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fixed project; when omitted the form shows a project picker. */
  projectId?: number;
  defaults?: { status?: TaskStatus; assigneeId?: number | null; dueDate?: string };
  onCreated?: (taskId: number) => void;
}

export function NewTaskModal({ open, onClose, projectId, defaults, onCreated }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={t('New task')} wide>
      {open && <NewTaskForm projectId={projectId} defaults={defaults} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function NewTaskForm({ projectId, defaults, onClose, onCreated }: Omit<Props, 'open'>) {
  const { users } = useUsers();
  const { data: projects } = useProjects(false, 'include');
  const create = useCreateTask();
  const toast = useToast();
  const writable = (projects ?? []).filter((p) => p.status !== 'archived' && (!p.isTemplate || p.id === projectId));

  const [form, setForm] = useState({
    projectId: projectId ?? 0,
    title: '',
    description: '',
    columnId: 0,
    priority: 'medium' as TaskPriority,
    assigneeId: defaults?.assigneeId ?? (null as number | null),
    startDate: '',
    dueDate: defaults?.dueDate ?? '',
    labelIds: [] as number[],
    recurrence: null as Recurrence | null,
  });
  const [addAnother, setAddAnother] = useState(false);
  const chosenProject = form.projectId || writable.find((p) => !p.isTemplate)?.id || 0;
  const project = writable.find((p) => p.id === chosenProject);
  const columns = [...(project?.columns ?? [])].sort((a, b) => a.position - b.position);
  const wantedStage: TaskStatus = defaults?.status ?? 'todo';
  const chosenColumn = columns.some((c) => c.id === form.columnId) ? form.columnId : (columns.find((c) => c.stage === wantedStage) ?? columns[0])?.id ?? 0;
  const fields = create.error instanceof ApiError ? create.error.fields : {};
  // Clear a server error as soon as the form is edited again.
  const errorShown = create.error !== null;
  const resetMutation = create.reset;
  useEffect(() => {
    if (errorShown) resetMutation();
  }, [form]);
  const dateError = form.startDate && form.dueDate && form.startDate > form.dueDate ? t('Must be on or after the start date') : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || dateError || !chosenProject) return;
    create.mutate(
      {
        projectId: chosenProject,
        title: form.title,
        description: form.description,
        ...(chosenColumn ? { columnId: chosenColumn } : {}),
        priority: form.priority,
        assigneeId: form.assigneeId,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        labelIds: form.labelIds,
        recurrence: form.recurrence,
      },
      {
        onSuccess: (task) => {
          toast.success(t('Task created'));
          onCreated?.(task.id);
          if (addAnother) setForm((f) => ({ ...f, title: '', description: '' }));
          else onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body">
        <div className="form-grid">
          {create.error && !Object.keys(fields).length && (
            <div className="span-2">
              <ErrorNotice error={create.error} />
            </div>
          )}
          <Field label={t('Title')} htmlFor="task-new-title" error={fields.title} className="span-2">
            <input
              id="task-new-title"
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('What needs to be done?')}
              maxLength={200}
              autoFocus
            />
          </Field>
          {projectId === undefined && (
            <Field label={t('Project')} htmlFor="task-new-project" error={fields.projectId} className="span-2">
              <select
                id="task-new-project"
                className="select"
                value={chosenProject}
                onChange={(e) => setForm({ ...form, projectId: Number(e.target.value), columnId: 0, labelIds: [] })}
              >
                {writable.filter((p) => !p.isTemplate).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('Description')} htmlFor="task-new-description" className="span-2">
            <textarea
              id="task-new-description"
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('Optional details')}
            />
          </Field>
          <Field label={t('Column')} htmlFor="task-new-column">
            <select
              id="task-new-column"
              className="select"
              value={chosenColumn}
              onChange={(e) => setForm({ ...form, columnId: Number(e.target.value) })}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Priority')} htmlFor="task-new-priority">
            <select
              id="task-new-priority"
              className="select"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(TASK_PRIORITY_LABELS[p])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Assignee')} htmlFor="task-new-assignee" error={fields.assigneeId} className="span-2">
            <UserSelect
              id="task-new-assignee"
              users={assignableUsers(users, project)}
              value={form.assigneeId}
              onChange={(assigneeId) => setForm({ ...form, assigneeId })}
            />
          </Field>
          <Field label={t('Start date')} htmlFor="task-new-start">
            <input
              id="task-new-start"
              type="date"
              className="input"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label={t('Due date')} htmlFor="task-new-due" error={dateError ?? fields.dueDate}>
            <input
              id="task-new-due"
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              aria-invalid={Boolean(dateError)}
            />
          </Field>
          <Field label={t('Repeats')} htmlFor="task-new-repeat" hint={form.recurrence ? t('When it’s done, the next one is created.') : undefined}>
            <RepeatSelect id="task-new-repeat" className="select" value={form.recurrence} onChange={(recurrence) => setForm({ ...form, recurrence })} />
          </Field>
          <div className="field">
            <span className="field-label">{t('Labels')}</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', minHeight: 36 }}>
              <LabelList ids={form.labelIds} labels={project?.labels ?? []} size="md" />
              {project && (
                <LabelPicker projectId={project.id} labels={project.labels} value={form.labelIds} onChange={(labelIds) => setForm({ ...form, labelIds })} />
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <label className="row" style={{ gap: 6, marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <input type="checkbox" className="checkbox" checked={addAnother} onChange={(e) => setAddAnother(e.target.checked)} />
          {t('Create another')}
        </label>
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !form.title.trim() || !chosenProject}>
          {create.isPending && <Spinner size={16} />}
          {t('Create task')}
        </button>
      </div>
    </form>
  );
}
