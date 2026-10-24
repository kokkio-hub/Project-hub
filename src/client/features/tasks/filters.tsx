import { Search, X } from 'lucide-react';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type Label, type Task, type TaskPriority, type User } from '../../../shared/types';

export interface TaskFilterState {
  q: string;
  /** 'all', 'me', 'none' (unassigned) or a user id. */
  assignee: string;
  priority: 'all' | TaskPriority;
  /** 'all' or a label id. */
  label: string;
  hideDone: boolean;
}

export const DEFAULT_FILTERS: TaskFilterState = { q: '', assignee: 'all', priority: 'all', label: 'all', hideDone: false };

export function isFiltering(f: TaskFilterState): boolean {
  return f.q.trim() !== '' || f.assignee !== 'all' || f.priority !== 'all' || f.label !== 'all' || f.hideDone;
}

export function applyFilters(tasks: Task[], f: TaskFilterState, meId: number): Task[] {
  const q = f.q.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.hideDone && t.status === 'done') return false;
    if (f.priority !== 'all' && t.priority !== f.priority) return false;
    if (f.assignee === 'me' && t.assigneeId !== meId) return false;
    if (f.assignee === 'none' && t.assigneeId !== null) return false;
    if (/^\d+$/.test(f.assignee) && t.assigneeId !== Number(f.assignee)) return false;
    if (f.label !== 'all' && !t.labelIds.includes(Number(f.label))) return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
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
  children,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  users: User[];
  showHideDone?: boolean;
  /** The project's labels, to filter by. */
  labels?: Label[];
  children?: React.ReactNode;
}) {
  const active = users.filter((u) => u.isActive && u.role !== 'guest');
  return (
    <div className="toolbar" role="search">
      <div className="search">
        <Search size={15} aria-hidden />
        <input
          className="input"
          type="search"
          placeholder="Filter tasks…"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          aria-label="Filter tasks by text"
        />
      </div>
      <select
        className="select select-sm"
        style={{ width: 'auto', minWidth: 150 }}
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
        aria-label="Filter by assignee"
      >
        <option value="all">Everyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
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
        aria-label="Filter by priority"
      >
        <option value="all">Any priority</option>
        {[...TASK_PRIORITIES].reverse().map((p) => (
          <option key={p} value={p}>
            {TASK_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      {labels && labels.length > 0 && (
        <select
          className="select select-sm"
          style={{ width: 'auto', minWidth: 120 }}
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          aria-label="Filter by label"
        >
          <option value="all">Any label</option>
          {labels.map((l) => (
            <option key={l.id} value={String(l.id)}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {showHideDone && (
        <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="checkbox"
            checked={value.hideDone}
            onChange={(e) => onChange({ ...value, hideDone: e.target.checked })}
          />
          Hide done
        </label>
      )}
      {isFiltering(value) && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(DEFAULT_FILTERS)}>
          <X size={14} /> Clear
        </button>
      )}
      <span className="spacer" />
      {children}
    </div>
  );
}
