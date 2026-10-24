import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Project } from '../../../shared/types';
import { ApiError } from '../../api/client';
import { useDuplicateProject } from '../../api/board';
import { ErrorNotice, Spinner, useToast } from '../../components/Feedback';
import { Field } from '../../components/Form';
import { Modal } from '../../components/Modal';

/** Copy a project, or save it as a template for future projects. */
export function DuplicateDialog({
  project,
  mode,
  onClose,
}: {
  project: Project;
  /** "copy" makes a working copy; "template" saves a template. */
  mode: 'copy' | 'template' | null;
  onClose: () => void;
}) {
  return (
    <Modal open={mode !== null} onClose={onClose} title={mode === 'template' ? 'Save as template' : 'Duplicate project'}>
      {mode && <DuplicateForm project={project} mode={mode} onClose={onClose} />}
    </Modal>
  );
}

function DuplicateForm({ project, mode, onClose }: { project: Project; mode: 'copy' | 'template'; onClose: () => void }) {
  const duplicate = useDuplicateProject(project.id);
  const navigate = useNavigate();
  const toast = useToast();
  const template = mode === 'template';
  const [form, setForm] = useState({
    name: template ? `${project.name} (template)` : `${project.name} (copy)`,
    startDate: '',
    includeTasks: true,
    keepAssignees: !template,
    resetProgress: template,
  });
  const fields = duplicate.error instanceof ApiError ? duplicate.error.fields : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    duplicate.mutate(
      {
        name: form.name,
        startDate: form.startDate || null,
        includeTasks: form.includeTasks,
        keepAssignees: form.keepAssignees,
        resetProgress: form.resetProgress,
        asTemplate: template,
      },
      {
        onSuccess: (created) => {
          toast.success(template ? 'Template saved' : 'Project duplicated');
          onClose();
          navigate(`/projects/${created.id}`);
        },
      },
    );
  };

  const check = (key: 'includeTasks' | 'keepAssignees' | 'resetProgress', label: string, disabled = false) => (
    <label className="row" style={{ gap: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" className="checkbox" checked={form[key]} disabled={disabled} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body stack" style={{ gap: 14 }}>
        {duplicate.error && !Object.keys(fields).length && <ErrorNotice error={duplicate.error} />}
        <p className="secondary">
          {template
            ? 'A template keeps the columns, labels and tasks, so new projects can start from it. It doesn’t show up as work on the dashboard.'
            : 'The copy gets the same columns and labels. You become its owner.'}
        </p>
        <Field label="Name" htmlFor="dup-name" error={fields.name}>
          <input id="dup-name" className="input" value={form.name} maxLength={120} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="New start date" htmlFor="dup-start" hint="Optional. Every date moves by the same number of days.">
          <input id="dup-start" type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          {check('includeTasks', 'Copy the tasks, with their checklists and dependencies')}
          {check('keepAssignees', 'Keep who each task is assigned to', !form.includeTasks)}
          {check('resetProgress', 'Start every task from the beginning (first column, checklists unticked)', !form.includeTasks)}
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={duplicate.isPending || !form.name.trim()}>
          {duplicate.isPending && <Spinner size={16} />}
          {template ? 'Save template' : 'Duplicate'}
        </button>
      </div>
    </form>
  );
}
