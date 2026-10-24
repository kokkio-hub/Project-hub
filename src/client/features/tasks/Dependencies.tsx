import { useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import type { Project, Task, TaskRef } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useAddBlocker, useDependencies, useRemoveBlocker } from '../../api/board';
import { useSearch } from '../../api/inbox';
import { DueChip } from '../../components/Bits';
import { Spinner, useToast } from '../../components/Feedback';
import { ProjectDot, StatusGlyph, StatusIcon } from '../../components/Icons';
import { Popover } from '../../components/Popover';
import { formatDate } from '../../lib/format';
import { useDebounced, useOpenTask } from '../../lib/hooks';

/** The day a task starts, for comparing with what it waits for. */
function startOf(task: Pick<Task, 'startDate' | 'dueDate'>): string | null {
  return task.startDate ?? task.dueDate;
}

/** Warns when a task is planned to start before something it waits for is due. */
export function scheduleConflict(task: Pick<Task, 'startDate' | 'dueDate'>, blocker: TaskRef): boolean {
  const start = startOf(task);
  return blocker.status !== 'done' && !!start && !!blocker.dueDate && start <= blocker.dueDate;
}

export function Dependencies({
  task,
  projectsById,
  readOnly,
}: {
  task: Task;
  projectsById: Map<number, Project>;
  readOnly: boolean;
}) {
  const deps = useDependencies(task.id);
  const remove = useRemoveBlocker(task.id);
  const openTask = useOpenTask();
  const toast = useToast();
  const blockedBy = deps.data?.blockedBy ?? [];
  const blocking = deps.data?.blocking ?? [];

  if (readOnly && blockedBy.length === 0 && blocking.length === 0) return null;

  const row = (ref: TaskRef, kind: 'blocker' | 'blocked') => {
    const project = ref.projectId !== task.projectId ? projectsById.get(ref.projectId) : undefined;
    const conflict = kind === 'blocker' && scheduleConflict(task, ref);
    return (
      <li key={ref.id} className="dep-item">
        <StatusIcon status={ref.status} />
        <button type="button" className={`dep-title ${ref.status === 'done' ? 'is-done' : ''}`} onClick={() => openTask(ref.id)}>
          {project && <ProjectDot color={project.color} />}
          <span className="truncate">{ref.title}</span>
        </button>
        <DueChip dueDate={ref.dueDate} status={ref.status} showIcon={false} />
        {conflict && (
          <span className="dep-warning" title={`This task starts before “${ref.title}” is due (${formatDate(ref.dueDate!)})`}>
            <StatusGlyph tone="warning" size={13} />
            <span className="sr-only">Starts before this is due</span>
          </span>
        )}
        {kind === 'blocker' && !readOnly && (
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={`Stop waiting for ${ref.title}`}
            onClick={() => remove.mutate(ref.id, { onError: (e) => toast.error(errorMessage(e)) })}
          >
            <X size={13} />
          </button>
        )}
      </li>
    );
  };

  const conflicts = blockedBy.filter((b) => scheduleConflict(task, b));

  return (
    <section className="drawer-section">
      <h3 className="section-title">Dependencies</h3>
      {deps.isPending ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {conflicts.length > 0 && (
            <div className="alert alert-warning">
              <StatusGlyph tone="warning" size={16} />
              <span>
                This task is planned to start before{' '}
                {conflicts.length === 1 ? `“${conflicts[0]!.title}” is due` : `${conflicts.length} tasks it waits for are due`}. Move its dates, or
                check the plan.
              </span>
            </div>
          )}
          <div>
            <div className="dep-heading">Waiting for</div>
            {blockedBy.length > 0 ? <ul className="dep-list">{blockedBy.map((b) => row(b, 'blocker'))}</ul> : <p className="muted dep-none">Nothing.</p>}
            {!readOnly && <AddBlocker task={task} exclude={new Set([task.id, ...blockedBy.map((b) => b.id), ...blocking.map((b) => b.id)])} />}
          </div>
          {blocking.length > 0 && (
            <div>
              <div className="dep-heading">Blocking</div>
              <ul className="dep-list">{blocking.map((b) => row(b, 'blocked'))}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AddBlocker({ task, exclude }: { task: Task; exclude: Set<number> }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 150);
  const search = useSearch(debounced);
  const add = useAddBlocker(task.id);
  const toast = useToast();
  const results = (search.data?.tasks ?? []).filter((t) => !exclude.has(t.id));

  return (
    <Popover
      label="Add a task this one waits for"
      width={340}
      trigger={(props) => (
        <button type="button" className="btn btn-ghost btn-sm" {...props}>
          <Plus size={14} /> Add a task it waits for
        </button>
      )}
    >
      {(close) => (
        <div className="picker">
          <input
            className="input input-sm"
            placeholder="Search tasks by name or #number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tasks"
            data-autofocus
          />
          <ul className="picker-list" role="listbox" aria-label="Tasks">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="picker-option"
                  onClick={() =>
                    add.mutate(r.id, {
                      onSuccess: () => {
                        setQuery('');
                        close();
                      },
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <StatusIcon status={r.status} />
                  <span className="truncate">{r.title}</span>
                  <span className="muted num">#{r.id}</span>
                </button>
              </li>
            ))}
            {debounced.trim() && !search.isFetching && results.length === 0 && <li className="muted picker-empty">No matching tasks.</li>}
            {!debounced.trim() && (
              <li className="muted picker-empty">
                <Link2 size={13} aria-hidden /> Type to find the task that has to be finished first.
              </li>
            )}
          </ul>
        </div>
      )}
    </Popover>
  );
}
