import { useMemo, useState } from 'react';
import { useProjects, useTasks, useUsers } from '../api/queries';
import { canChangeWork, useCurrentUser, useDocumentTitle } from '../auth/session';
import { ErrorNotice, PageLoading } from '../components/Feedback';
import { CalendarView, type CalendarMilestone, type CalendarMode } from '../features/calendar/CalendarView';
import { applyFilters, DEFAULT_FILTERS, TaskFilters } from '../features/tasks/filters';
import { NewTaskModal } from '../features/tasks/NewTaskModal';
import { useOpenTask } from '../lib/hooks';
import { t } from '../i18n';

const MODE_KEY = 'ph.calendar.mode';

function readMode(): CalendarMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'week' ? 'week' : 'month';
  } catch {
    return 'month';
  }
}

/** Every project's tasks and milestones on one calendar. */
export function CalendarPage() {
  useDocumentTitle(t('Calendar'));
  const me = useCurrentUser();
  const projects = useProjects();
  const tasks = useTasks({});
  const { users, byId } = useUsers();
  const openTask = useOpenTask();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [mode, setMode] = useState<CalendarMode>(readMode);
  const [projectFilter, setProjectFilter] = useState('all');
  const [newTaskDate, setNewTaskDate] = useState<string | undefined>();

  const active = useMemo(() => (projects.data ?? []).filter((p) => p.status !== 'archived' && !p.isTemplate), [projects.data]);
  const projectsById = useMemo(() => new Map(active.map((p) => [p.id, p])), [active]);
  const shownProjects = projectFilter === 'all' ? active : active.filter((p) => String(p.id) === projectFilter);

  const visible = useMemo(
    () =>
      applyFilters(tasks.data ?? [], filters, me.id).filter(
        (task) => projectsById.has(task.projectId) && (projectFilter === 'all' || String(task.projectId) === projectFilter),
      ),
    [tasks.data, filters, me.id, projectsById, projectFilter],
  );
  const milestones = useMemo<CalendarMilestone[]>(
    () => shownProjects.flatMap((p) => p.milestones.map((m) => ({ ...m, color: p.color, projectName: p.name }))),
    [shownProjects],
  );

  const changeMode = (next: CalendarMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Not remembered in private browsing.
    }
  };

  const canWork = canChangeWork(me);

  return (
    <div className="page page-wide">
      <header className="page-header">
        <div className="titles">
          <h1>{t('Calendar')}</h1>
          <p className="subtitle">{t('Due dates and milestones of all projects. Drag a task to another day to reschedule it.')}</p>
        </div>
      </header>

      <TaskFilters value={filters} onChange={setFilters} users={users} showHideDone>
        <select
          className="select select-sm"
          style={{ width: 'auto', minWidth: 150 }}
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label={t('Filter by project')}
        >
          <option value="all">{t('All projects')}</option>
          {active.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
      </TaskFilters>

      {projects.isPending || tasks.isPending ? (
        <PageLoading />
      ) : projects.isError || tasks.isError ? (
        <ErrorNotice error={projects.error ?? tasks.error} onRetry={() => void Promise.all([projects.refetch(), tasks.refetch()])} />
      ) : (
        <CalendarView
          tasks={visible}
          milestones={milestones}
          usersById={byId}
          colorOf={(task) => projectsById.get(task.projectId)?.color ?? 'blue'}
          canMove={(task) => canWork && projectsById.get(task.projectId)?.status !== 'archived'}
          onOpenTask={openTask}
          onAddTask={canWork ? (date) => setNewTaskDate(date) : undefined}
          mode={mode}
          onModeChange={changeMode}
          prefixOf={projectFilter === 'all' ? (task) => projectsById.get(task.projectId)?.name : undefined}
        />
      )}

      <NewTaskModal
        open={newTaskDate !== undefined}
        onClose={() => setNewTaskDate(undefined)}
        projectId={projectFilter === 'all' ? undefined : Number(projectFilter)}
        defaults={{ dueDate: newTaskDate }}
      />
    </div>
  );
}
