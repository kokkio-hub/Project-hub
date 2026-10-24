import { useMemo, useState } from 'react';
import { useProjects, useTasks, useUsers } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { ErrorNotice, PageLoading } from '../components/Feedback';
import { applyFilters, DEFAULT_FILTERS, TaskFilters } from '../features/tasks/filters';
import { Timeline, type TimelineGroup } from '../features/timeline/Timeline';
import { useOpenTask } from '../lib/hooks';

export function TimelinePage() {
  useDocumentTitle('Timeline');
  const me = useCurrentUser();
  const projects = useProjects();
  const tasks = useTasks({});
  const { users, byId } = useUsers();
  const openTask = useOpenTask();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const groups = useMemo<TimelineGroup[]>(() => {
    const visible = applyFilters(tasks.data ?? [], filters, me.id);
    // When narrowing by text, person or priority, hide projects with no matching tasks.
    const narrowing = filters.q.trim() !== '' || filters.assignee !== 'all' || filters.priority !== 'all';
    return (projects.data ?? [])
      .filter((p) => p.status === 'active' || p.status === 'on_hold' || (includeCompleted && p.status === 'completed'))
      .map((project) => ({ project, tasks: visible.filter((t) => t.projectId === project.id) }))
      .filter((g) => !narrowing || g.tasks.length > 0);
  }, [projects.data, tasks.data, filters, includeCompleted, me.id]);

  return (
    <div className="page page-wide">
      <header className="page-header">
        <div className="titles">
          <h1>Timeline</h1>
          <p className="subtitle">All projects over time. Drag a bar to move a task, drag its ends to change the dates.</p>
        </div>
      </header>

      <TaskFilters value={filters} onChange={setFilters} users={users}>
        <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
          />
          Include completed projects
        </label>
      </TaskFilters>

      {projects.isPending || tasks.isPending ? (
        <PageLoading />
      ) : projects.isError || tasks.isError ? (
        <ErrorNotice error={projects.error ?? tasks.error} onRetry={() => void Promise.all([projects.refetch(), tasks.refetch()])} />
      ) : (
        <Timeline groups={groups} showGroups usersById={byId} onOpenTask={openTask} />
      )}
    </div>
  );
}
