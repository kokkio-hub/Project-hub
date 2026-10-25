import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Lock, Users } from 'lucide-react';
import {
  COLOR_NAMES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ColorName,
  type Project,
  type ProjectStatus,
  type ProjectVisibility,
  type User,
} from '../../../shared/types';
import { ApiError, errorMessage } from '../../api/client';
import { useSetMembers } from '../../api/board';
import { useCreateProject, useProjects, useUpdateProject, useUsers } from '../../api/queries';
import { useCurrentUser } from '../../auth/session';
import { Avatar } from '../../components/Avatar';
import { ErrorNotice, Spinner, useToast } from '../../components/Feedback';
import { ColorPicker, Field, UserSelect } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { LabelManager } from '../labels/LabelManager';
import { t } from '../../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Edit this project; omit to create a new one. */
  project?: Project;
  /** When creating: start from this template. */
  templateId?: number;
  /** When creating: make a template instead of a project. */
  asTemplate?: boolean;
}

export function ProjectFormModal({ open, onClose, project, templateId, asTemplate }: Props) {
  const title = project ? (project.isTemplate ? t('Template settings') : t('Project settings')) : asTemplate ? t('New template') : t('New project');
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {open && <ProjectForm project={project} onClose={onClose} templateId={templateId} asTemplate={asTemplate} />}
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

/** Pick who is on a project: everyone active, guests included. */
export function MemberPicker({ users, value, onChange, ownerId }: { users: User[]; value: number[]; onChange: (ids: number[]) => void; ownerId: number | null }) {
  const people = users.filter((u) => u.isActive || value.includes(u.id));
  if (people.length === 0) return <p className="muted member-empty">{t('No guests yet. Add guests on the Team page first.')}</p>;
  return (
    <ul className="member-picker">
      {people.map((u) => {
        const owner = u.id === ownerId;
        const checked = owner || value.includes(u.id);
        return (
          <li key={u.id}>
            <label className={`member-option ${owner ? 'is-owner' : ''}`}>
              <input
                type="checkbox"
                className="checkbox"
                checked={checked}
                disabled={owner}
                onChange={(e) => onChange(e.target.checked ? [...value, u.id] : value.filter((id) => id !== u.id))}
              />
              <Avatar user={u} size="sm" title={null} />
              <span className="truncate">{u.name}</span>
              {owner && <span className="badge">{t('Owner')}</span>}
              {u.role === 'guest' && <span className="badge">{t('Guest')}</span>}
              {u.role === 'admin' && !owner && <span className="muted member-note">{t('Admin')}</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectForm({
  project,
  onClose,
  templateId,
  asTemplate,
}: {
  project?: Project;
  onClose: () => void;
  templateId?: number;
  asTemplate?: boolean;
}) {
  const me = useCurrentUser();
  const { users } = useUsers();
  const { data: projects } = useProjects();
  const { data: templates } = useProjects(false, 'only');
  const create = useCreateProject();
  const update = useUpdateProject();
  const setMembers = useSetMembers(project?.id ?? 0);
  const toast = useToast();
  const navigate = useNavigate();
  const isTemplate = project?.isTemplate ?? asTemplate ?? false;

  const [form, setForm] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    color: project?.color ?? suggestColor(projects),
    status: project?.status ?? ('active' as ProjectStatus),
    visibility: project?.visibility ?? ('team' as ProjectVisibility),
    ownerId: project ? project.ownerId : me.id,
    startDate: project?.startDate ?? '',
    dueDate: project?.dueDate ?? '',
    memberIds: project?.memberIds ?? ([] as number[]),
    fromTemplateId: templateId ?? 0,
    keepAssignees: false,
  });
  const template = useMemo(() => templates?.find((item) => item.id === form.fromTemplateId), [templates, form.fromTemplateId]);
  const mutation = project ? update : create;
  const fields = mutation.error instanceof ApiError ? mutation.error.fields : {};
  // Clear a server error as soon as the form is edited again.
  const errorShown = mutation.error !== null;
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (errorShown) resetMutation();
  }, [form]);
  // Starting from a template: take over its description and colour unless already typed.
  useEffect(() => {
    if (!template || project) return;
    setForm((f) => ({ ...f, description: f.description || template.description, color: template.color }));
  }, [template, project]);
  const dateError = form.startDate && form.dueDate && form.startDate > form.dueDate ? t('Must be on or after the start date') : undefined;
  const owners = users.filter((u) => u.role !== 'guest');
  const membersChanged = project ? [...form.memberIds].sort().join() !== [...project.memberIds].sort().join() : false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dateError) return;
    const input = {
      name: form.name,
      description: form.description,
      color: form.color,
      status: form.status,
      visibility: form.visibility,
      ownerId: form.ownerId,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
    };
    if (project) {
      update.mutate(
        { id: project.id, patch: input },
        {
          onSuccess: () => {
            if (membersChanged) {
              setMembers.mutate(form.memberIds, {
                onError: (e) => toast.error(t('Saved, but the people couldn’t be updated: {error}', { error: errorMessage(e) })),
              });
            }
            toast.success(isTemplate ? t('Template updated') : t('Project updated'));
            onClose();
          },
        },
      );
    } else {
      create.mutate(
        {
          ...input,
          memberIds: form.memberIds,
          isTemplate,
          ...(form.fromTemplateId ? { fromTemplateId: form.fromTemplateId, keepAssignees: form.keepAssignees } : {}),
        },
        {
          onSuccess: (created) => {
            onClose();
            navigate(`/projects/${created.id}`);
          },
        },
      );
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
          {!project && !isTemplate && (templates?.length ?? 0) > 0 && (
            <Field label={t('Start from')} htmlFor="project-template" className="span-2" hint={template ? t('Columns, labels and tasks are copied. Dates move with the start date.') : undefined}>
              <select
                id="project-template"
                className="select"
                value={form.fromTemplateId}
                onChange={(e) => setForm({ ...form, fromTemplateId: Number(e.target.value) })}
              >
                <option value={0}>{t('A blank project')}</option>
                {templates!.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t('Template: {name}', { name: item.name })}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('Name')} htmlFor="project-name" error={fields.name} className="span-2">
            <input
              id="project-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={isTemplate ? t('e.g. Client website') : t('e.g. Website redesign')}
              autoFocus
              maxLength={120}
            />
          </Field>
          <Field label={t('Description')} htmlFor="project-description" error={fields.description} className="span-2">
            <textarea
              id="project-description"
              className="textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('What is this project about?')}
            />
          </Field>
          <Field label={t('Start date')} htmlFor="project-start" error={fields.startDate}>
            <input
              id="project-start"
              type="date"
              className="input"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label={t('Due date')} htmlFor="project-due" error={dateError ?? fields.dueDate} hint={template && !form.dueDate ? t('Leave empty to follow the template.') : undefined}>
            <input
              id="project-due"
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              aria-invalid={Boolean(dateError)}
            />
          </Field>
          <Field label={t('Owner')} htmlFor="project-owner" error={fields.ownerId} hint={t('The owner and admins can change settings.')}>
            <UserSelect
              id="project-owner"
              users={owners}
              value={form.ownerId}
              onChange={(ownerId) => setForm({ ...form, ownerId })}
              unassignedLabel={t('No owner')}
            />
          </Field>
          {project && !isTemplate ? (
            <Field label={t('Status')} htmlFor="project-status">
              <select
                id="project-status"
                className="select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(PROJECT_STATUS_LABELS[s])}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <span />
          )}
          {template && (
            <label className="row span-2" style={{ gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={form.keepAssignees}
                onChange={(e) => setForm({ ...form, keepAssignees: e.target.checked })}
              />
              {t('Keep who the template’s tasks are assigned to')}
            </label>
          )}
          <Field label={t('Colour')} className="span-2">
            <ColorPicker label={t('Project colour')} value={form.color} onChange={(color) => setForm({ ...form, color })} />
          </Field>

          <fieldset className="plain-fieldset field span-2">
            <legend className="field-label">{t('Who can see it')}</legend>
            <div className="radio-cards">
              <label className="radio-card">
                <input type="radio" name="visibility" checked={form.visibility === 'team'} onChange={() => setForm({ ...form, visibility: 'team' })} />
                <div>
                  <strong>
                    <Users size={14} aria-hidden /> {t('The whole team')}
                  </strong>
                  <span>{t('Every member can see and work on it. Guests only if you add them below.')}</span>
                </div>
              </label>
              <label className="radio-card">
                <input
                  type="radio"
                  name="visibility"
                  checked={form.visibility === 'private'}
                  onChange={() => setForm({ ...form, visibility: 'private' })}
                />
                <div>
                  <strong>
                    <Lock size={14} aria-hidden /> {t('Only the people added')}
                  </strong>
                  <span>{t('Private: the owner, the people below and admins.')}</span>
                </div>
              </label>
            </div>
          </fieldset>
          <Field
            label={form.visibility === 'private' ? t('People on this project') : t('Guests and extra people')}
            className="span-2"
            hint={
              form.visibility === 'private'
                ? t('Only these people (and admins) can open the project.')
                : t('Members already see team projects. Add guests here to share it with them.')
            }
          >
            <MemberPicker
              users={form.visibility === 'private' ? users : users.filter((u) => u.role === 'guest' || form.memberIds.includes(u.id))}
              value={form.memberIds}
              onChange={(memberIds) => setForm({ ...form, memberIds })}
              ownerId={form.ownerId}
            />
          </Field>

          {project && (
            <div className="span-2">
              <span className="field-label">{t('Labels')}</span>
              <LabelManager project={project} />
            </div>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={mutation.isPending || !form.name.trim()}>
          {mutation.isPending && <Spinner size={16} />}
          {project ? t('Save changes') : isTemplate ? t('Create template') : t('Create project')}
        </button>
      </div>
    </form>
  );
}
