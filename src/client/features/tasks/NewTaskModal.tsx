import { useEffect, useState, type FormEvent } from 'react';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from '../../../shared/types';
import { ApiError } from '../../api/client';
import { useCreateTask, useProjects, useUsers } from '../../api/queries';
import { ErrorNotice, Spinner, useToast } from '../../components/Feedback';
import { Field, UserSelect } from '../../components/Form';
import { Modal } from '../../components/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fixed project; when omitted the form shows a project picker. */
  projectId?: number;
  defaults?: { status?: TaskStatus; assigneeId?: number | null };
  onCreated?: (taskId: number) => void;
}

export function NewTaskModal({ open, onClose, projectId, defaults, onCreated }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="New task" wide>
      {open && <NewTaskForm projectId={projectId} defaults={defaults} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function NewTaskForm({ projectId, defaults, onClose, onCreated }: Omit<Props, 'open'>) {
  const { users } = useUsers();
  const { data: projects } = useProjects();
  const create = useCreateTask();
  const toast = useToast();
  const writable = (projects ?? []).filter((p) => p.status !== 'archived');

  const [form, setForm] = useState({
    projectId: projectId ?? 0,
    title: '',
    description: '',
    status: defaults?.status ?? ('todo' as TaskStatus),
    priority: 'medium' as TaskPriority,
    assigneeId: defaults?.assigneeId ?? (null as number | null),
    startDate: '',
    dueDate: '',
  });
  const [addAnother, setAddAnother] = useState(false);
  const chosenProject = form.projectId || writable[0]?.id || 0;
  const fields = create.error instanceof ApiError ? create.error.fields : {};
  // Clear a server error as soon as the form is edited again.
  const errorShown = create.error !== null;
  const resetMutation = create.reset;
  useEffect(() => {
    if (errorShown) resetMutation();
  }, [form]);
  const dateError = form.startDate && form.dueDate && form.startDate > form.dueDate ? 'Must be on or after the start date' : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || dateError || !chosenProject) return;
    create.mutate(
      {
        projectId: chosenProject,
        title: form.title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        assigneeId: form.assigneeId,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
      },
      {
        onSuccess: (task) => {
          toast.success('Task created');
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
          <Field label="Title" htmlFor="task-new-title" error={fields.title} className="span-2">
            <input
              id="task-new-title"
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="What needs to be done?"
              maxLength={200}
              autoFocus
            />
          </Field>
          {projectId === undefined && (
            <Field label="Project" htmlFor="task-new-project" error={fields.projectId} className="span-2">
              <select
                id="task-new-project"
                className="select"
                value={chosenProject}
                onChange={(e) => setForm({ ...form, projectId: Number(e.target.value) })}
              >
                {writable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Description" htmlFor="task-new-description" className="span-2">
            <textarea
              id="task-new-description"
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional details"
            />
          </Field>
          <Field label="Status" htmlFor="task-new-status">
            <select
              id="task-new-status"
              className="select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority" htmlFor="task-new-priority">
            <select
              id="task-new-priority"
              className="select"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee" htmlFor="task-new-assignee" error={fields.assigneeId} className="span-2">
            <UserSelect id="task-new-assignee" users={users} value={form.assigneeId} onChange={(assigneeId) => setForm({ ...form, assigneeId })} />
          </Field>
          <Field label="Start date" htmlFor="task-new-start">
            <input
              id="task-new-start"
              type="date"
              className="input"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label="Due date" htmlFor="task-new-due" error={dateError ?? fields.dueDate}>
            <input
              id="task-new-due"
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              aria-invalid={Boolean(dateError)}
            />
          </Field>
        </div>
      </div>
      <div className="modal-footer">
        <label className="row" style={{ gap: 6, marginRight: 'auto', fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <input type="checkbox" className="checkbox" checked={addAnother} onChange={(e) => setAddAnother(e.target.checked)} />
          Create another
        </label>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={create.isPending || !form.title.trim() || !chosenProject}>
          {create.isPending && <Spinner size={16} />}
          Create task
        </button>
      </div>
    </form>
  );
}
