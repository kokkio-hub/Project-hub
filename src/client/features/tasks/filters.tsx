import { SlidersHorizontal, Search, X } from 'lucide-react';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type CustomField,
  type Label,
  type Milestone,
  type Task,
  type TaskPriority,
  type User,
} from '../../../shared/types';
import { Popover } from '../../components/Popover';
import { t, tn } from '../../i18n';

export interface TaskFilterState {
  q: string;
  /** 'all', 'me', 'none' (unassigned) or a user id. */
  assignee: string;
  priority: 'all' | TaskPriority;
  /** 'all' or a label id. */
  label: string;
  /** 'all', 'none' (no milestone) or a milestone id. */
  milestone: string;
  /** Field id → a dropdown choice id, 'true' (a ticked box) or 'none' (empty). */
  fields: Record<string, string>;
  hideDone: boolean;
}

export const DEFAULT_FILTERS: TaskFilterState = { q: '', assignee: 'all', priority: 'all', label: 'all', milestone: 'all', fields: {}, hideDone: false };

/** Fields people can filter by: dropdowns and checkboxes. */
export const filterableFields = (fields: CustomField[] | undefined) => (fields ?? []).filter((f) => f.type === 'select' || f.type === 'checkbox');

export function isFiltering(f: TaskFilterState): boolean {
  return (
    f.q.trim() !== '' ||
    f.assignee !== 'all' ||
    f.priority !== 'all' ||
    f.label !== 'all' ||
    f.milestone !== 'all' ||
    Object.keys(f.fields).length > 0 ||
    f.hideDone
  );
}

export function applyFilters(tasks: Task[], f: TaskFilterState, meId: number): Task[] {
  const q = f.q.trim().toLowerCase();
  return tasks.filter((task) => {
    if (f.hideDone && task.status === 'done') return false;
    if (f.priority !== 'all' && task.priority !== f.priority) return false;
    if (f.assignee === 'me' && task.assigneeId !== meId) return false;
    if (f.assignee === 'none' && task.assigneeId !== null) return false;
    if (/^\d+$/.test(f.assignee) && task.assigneeId !== Number(f.assignee)) return false;
    if (f.label !== 'all' && !task.labelIds.includes(Number(f.label))) return false;
    if (f.milestone === 'none' && task.milestoneId !== null) return false;
    if (/^\d+$/.test(f.milestone) && task.milestoneId !== Number(f.milestone)) return false;
    for (const [fieldId, wanted] of Object.entries(f.fields)) {
      const value = task.fieldValues[fieldId];
      if (wanted === 'none' ? value !== undefined : value !== wanted) return false;
    }
    if (q && !task.title.toLowerCase().includes(q) && !task.description.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** One row of filters above the board, timeline or list. */
export function TaskFilters({
  value,
  onChange,
  users,
  showHideDone = true,
  labels,
  milestones,
  fields,
  children,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  users: User[];
  showHideDone?: boolean;
  /** The project's labels, to filter by. */
  labels?: Label[];
  milestones?: Milestone[];
  fields?: CustomField[];
  children?: React.ReactNode;
}) {
  const active = users.filter((u) => u.isActive && u.role !== 'guest');
  const byField = filterableFields(fields);
  const fieldFilters = Object.keys(value.fields).length;
  return (
    <div className="toolbar" role="search">
      <div className="search">
        <Search size={15} aria-hidden />
        <input
          className="input"
          type="search"
          placeholder={t('Filter tasks…')}
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          aria-label={t('Filter tasks by text')}
        />
      </div>
      <select
        className="select select-sm"
        style={{ width: 'auto', minWidth: 150 }}
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
        aria-label={t('Filter by assignee')}
      >
        <option value="all">{t('Everyone')}</option>
        <option value="me">{t('Assigned to me')}</option>
        <option value="none">{t('Unassigned')}</option>
        {active.map((u) => (
          <option key={u.id} value={String(u.id)}>
            {u.name}
          </option>
        ))}
      </select>
      <select
        className="select select-sm"
        style={{ width: 'auto', minWidth: 130 }}
        value={value.priority}
        onChange={(e) => onChange({ ...value, priority: e.target.value as TaskFilterState['priority'] })}
        aria-label={t('Filter by priority')}
      >
        <option value="all">{t('Any priority')}</option>
        {[...TASK_PRIORITIES].reverse().map((p) => (
          <option key={p} value={p}>
            {t(TASK_PRIORITY_LABELS[p])}
          </option>
        ))}
      </select>
      {labels && labels.length > 0 && (
        <select
          className="select select-sm"
          style={{ width: 'auto', minWidth: 120 }}
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          aria-label={t('Filter by label')}
        >
          <option value="all">{t('Any label')}</option>
          {labels.map((l) => (
            <option key={l.id} value={String(l.id)}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {milestones && milestones.length > 0 && (
        <select
          className="select select-sm"
          style={{ width: 'auto', minWidth: 130 }}
          value={value.milestone}
          onChange={(e) => onChange({ ...value, milestone: e.target.value })}
          aria-label={t('Filter by milestone')}
        >
          <option value="all">{t('Any milestone')}</option>
          <option value="none">{t('No milestone')}</option>
          {milestones.map((m) => (
            <option key={m.id} value={String(m.id)}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      {byField.length > 0 && (
        <Popover
          label={t('Filter by field')}
          width={300}
          trigger={(props) => (
            <button type="button" className={`btn btn-sm ${fieldFilters ? 'is-active' : ''}`} {...props}>
              <SlidersHorizontal size={14} aria-hidden />
              {fieldFilters ? tn('{count} field', '{count} fields', fieldFilters) : t('Fields')}
            </button>
          )}
        >
          {() => (
            <div className="stack" style={{ gap: 10, padding: 12 }}>
              {byField.map((field) => (
                <label key={field.id} className="field">
                  <span className="field-label">{field.name}</span>
                  <select
                    className="select select-sm"
                    value={value.fields[field.id] ?? ''}
                    onChange={(e) => {
                      const next = { ...value.fields };
                      if (e.target.value) next[field.id] = e.target.value;
                      else delete next[field.id];
                      onChange({ ...value, fields: next });
                    }}
                  >
                    <option value="">{t('Any')}</option>
                    {field.type === 'checkbox' ? (
                      <>
                        <option value="true">{t('Ticked')}</option>
                        <option value="none">{t('Not ticked')}</option>
                      </>
                    ) : (
                      <>
                        {field.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                        <option value="none">{t('Empty')}</option>
                      </>
                    )}
                  </select>
                </label>
              ))}
            </div>
          )}
        </Popover>
      )}
      {showHideDone && (
        <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="checkbox"
            checked={value.hideDone}
            onChange={(e) => onChange({ ...value, hideDone: e.target.checked })}
          />
          {t('Hide done')}
        </label>
      )}
      {isFiltering(value) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(DEFAULT_FILTERS)}>
          <X size={14} /> {t('Clear')}
        </button>
      )}
      {children && <div className="toolbar-end">{children}</div>}
    </div>
  );
}
