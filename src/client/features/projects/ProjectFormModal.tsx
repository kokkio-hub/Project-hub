import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { COLOR_NAMES, PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ColorName, type Project, type ProjectStatus } from '../../../shared/types';
import { ApiError } from '../../api/client';
import { useCreateProject, useProjects, useUpdateProject, useUsers } from '../../api/queries';
import { useCurrentUser } from '../../auth/session';
import { ErrorNotice, Spinner, useToast } from '../../components/Feedback';
import { ColorPicker, Field, UserSelect } from '../../components/Form';
import { Modal } from '../../components/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Edit this project; omit to create a new one. */
  project?: Project;
}

export function ProjectFormModal({ open, onClose, project }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={project ? 'Project settings' : 'New project'} wide>
      {open && <ProjectForm project={project} onClose={onClose} />}
    </Modal>
  );
}

function suggestColor(projects: Project[] | undefined): ColorName {
  const counts = new Map<string, number>();
  for (const p of projects ?? []) counts.set(p.color, (counts.get(p.color) ?? 0) + 1);
  let best: ColorName = COLOR_NAMES[0];
  for (const color of COLOR_NAMES) if ((counts.get(color) ?? 0) < (counts.get(best) ?? 0)) best = color;
  return best;
}

function ProjectForm({ project, onClose }: { project?: Project; onClose: () => void }) {
  const me = useCurrentUser();
  const { users } = useUsers();
  const { data: projects } = useProjects();
  const create = useCreateProject();
  const update = useUpdateProject();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    color: project?.color ?? suggestColor(projects),
    status: project?.status ?? ('active' as ProjectStatus),
    ownerId: project ? project.ownerId : me.id,
    startDate: project?.startDate ?? '',
    dueDate: project?.dueDate ?? '',
  });
  const mutation = project ? update : create;
  const fields = mutation.error instanceof ApiError ? mutation.error.fields : {};
  // Clear a server error as soon as the form is edited again.
  const errorShown = mutation.error !== null;
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (errorShown) resetMutation();
  }, [form]);
  const dateError = form.startDate && form.dueDate && form.startDate > form.dueDate ? 'Must be on or after the start date' : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dateError) return;
    const input = {
      name: form.name,
      description: form.description,
      color: form.color,
      status: form.status,
      ownerId: form.ownerId,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
    };
    if (project) {
      update.mutate(
        { id: project.id, patch: input },
        {
          onSuccess: () => {
            toast.success('Project updated');
            onClose();
          },
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: (created) => {
          onClose();
          navigate(`/projects/${created.id}`);
        },
      });
    }
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body">
        <div className="form-grid">
          {mutation.error && !Object.keys(fields).length && (
            <div className="span-2">
              <ErrorNotice error={mutation.error} />
            </div>
          )}
          <Field label="Name" htmlFor="project-name" error={fields.name} className="span-2">
            <input
              id="project-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Website redesign"
              autoFocus
              maxLength={120}
            />
          </Field>
          <Field label="Description" htmlFor="project-description" error={fields.description} className="span-2">
            <textarea
              id="project-description"
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What is this project about?"
            />
          </Field>
          <Field label="Start date" htmlFor="project-start" error={fields.startDate}>
            <input
              id="project-start"
              type="date"
              className="input"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label="Due date" htmlFor="project-due" error={dateError ?? fields.dueDate}>
            <input
              id="project-due"
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              aria-invalid={Boolean(dateError)}
            />
          </Field>
          <Field label="Owner" htmlFor="project-owner" error={fields.ownerId} hint="The owner and admins can change settings.">
            <UserSelect
              id="project-owner"
              users={users}
              value={form.ownerId}
              onChange={(ownerId) => setForm({ ...form, ownerId })}
              unassignedLabel="No owner"
            />
          </Field>
          {project ? (
            <Field label="Status" htmlFor="project-status">
              <select
                id="project-status"
                className="select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <span />
          )}
          <Field label="Colour" className="span-2">
            <ColorPicker label="Project colour" value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </Field>
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !form.name.trim()}>
          {mutation.isPending && <Spinner size={16} />}
          {project ? 'Save changes' : 'Create project'}
        </button>
      </div>
    </form>
  );
}
