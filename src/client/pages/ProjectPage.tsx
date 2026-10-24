import { useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Archive, ArchiveRestore, CalendarRange, Ellipsis, FolderX, Kanban, List, Plus, Settings, Trash2 } from 'lucide-react';
import { localToday } from '../../shared/dates';
import { computeProjectHealth } from '../../shared/health';
import { PROJECT_STATUS_LABELS } from '../../shared/types';
import { ApiError, errorMessage } from '../api/client';
import { useDeleteProject, useProject, useTasks, useUpdateProject, useUsers } from '../api/queries';
import { canManageProject, useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { Meter } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading, useConfirm, useToast } from '../components/Feedback';
import { HealthBadge, healthTone, ProjectDot } from '../components/Icons';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu';
import { KanbanBoard } from '../features/board/KanbanBoard';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { applyFilters, DEFAULT_FILTERS, isFiltering, TaskFilters } from '../features/tasks/filters';
import { NewTaskModal } from '../features/tasks/NewTaskModal';
import { TaskTable } from '../features/tasks/TaskTable';
import { Timeline } from '../features/timeline/Timeline';
import { formatRange, percent } from '../lib/format';
import { useOpenTask } from '../lib/hooks';

type View = 'board' | 'timeline' | 'list';

export function ProjectPage() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const validId = Number.isInteger(projectId) && projectId > 0;
  const view: View = params.view === 'timeline' || params.view === 'list' ? params.view : 'board';
  const me = useCurrentUser();
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const project = useProject(validId ? projectId : undefined);
  const cacheKey = useMemo(() => ({ projectId }), [projectId]);
  const tasks = useTasks(cacheKey, { enabled: validId });
  const { users, byId } = useUsers();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const update = useUpdateProject();
  const remove = useDeleteProject();
  const confirm = useConfirm();
  const toast = useToast();

  useDocumentTitle(project.data?.name);

  const visibleTasks = useMemo(() => applyFilters(tasks.data ?? [], filters, me.id), [tasks.data, filters, me.id]);

  const notFound = (
    <div className="page">
      <EmptyState icon={<FolderX size={22} />} title="Project not found">
        It may have been deleted, or the link is wrong.
      </EmptyState>
    </div>
  );
  if (!validId) return notFound;
  if (project.isPending) return <PageLoading />;
  if (project.isError) {
    const missing = project.error instanceof ApiError && project.error.status === 404;
    if (missing) return notFound;
    return (
      <div className="page">
        <ErrorNotice error={project.error} onRetry={() => void project.refetch()} />
      </div>
    );
  }

  const p = project.data;
  const manage = canManageProject(me, p);
  const archived = p.status === 'archived';
  const owner = p.ownerId ? byId.get(p.ownerId) : undefined;
  const health = computeProjectHealth(
    {
      status: p.status,
      startDate: p.startDate,
      dueDate: p.dueDate,
      createdAt: p.createdAt,
      total: p.counts.total,
      done: p.counts.done,
      overdue: p.counts.overdue,
    },
    localToday(),
  );

  const setStatus = (status: 'archived' | 'active') =>
    update.mutate(
      { id: p.id, patch: { status } },
      {
        onSuccess: () => toast.success(status === 'archived' ? 'Project archived' : 'Project restored'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const deleteProject = async () => {
    const ok = await confirm({
      title: `Delete “${p.name}”?`,
      message: `This permanently deletes the project and its ${p.counts.total} tasks and their comments. Archiving keeps everything but hides it.`,
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    remove.mutate(p.id, {
      onSuccess: () => {
        toast.success('Project deleted');
        navigate('/projects');
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const base = `/projects/${p.id}`;

  return (
    <div className="page page-wide">
      <header className="page-header project-header">
        <div className="titles">
          <div className="row" style={{ gap: 10 }}>
            <ProjectDot color={p.color} size="lg" />
            <h1 className="truncate">{p.name}</h1>
            <span className="badge">{PROJECT_STATUS_LABELS[p.status]}</span>
          </div>
          {p.description && <p className="subtitle project-description">{p.description}</p>}
          <div className="project-meta">
            <span className="row" style={{ gap: 6 }} title="Project owner">
              <Avatar user={owner ?? null} size="xs" title={null} />
              {owner?.name ?? 'No owner'}
            </span>
            <span className="row secondary" style={{ gap: 6 }}>
              <CalendarRange size={14} aria-hidden />
              {formatRange(p.startDate, p.dueDate)}
            </span>
            <HealthBadge health={health.health} reason={health.reason} />
            <span className="meter-row" style={{ minWidth: 200 }}>
              <Meter value={health.progress} tone={healthTone(health.health)} label={`${p.name} progress`} />
              <span className="meter-value">{percent(health.progress)}</span>
              <span className="muted num" style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
                {p.counts.done}/{p.counts.total} done
              </span>
            </span>
          </div>
        </div>
        <div className="actions">
          {!archived && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New task
            </button>
          )}
          {manage && (
            <>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Settings size={16} /> Settings
              </button>
              <Menu
                trigger={(props) => (
                  <button type="button" className="btn" aria-label="More project actions" {...props} style={{ padding: '0 9px' }}>
                    <Ellipsis size={17} />
                  </button>
                )}
              >
                {archived ? (
                  <MenuItem icon={<ArchiveRestore size={16} />} onSelect={() => setStatus('active')}>
                    Restore project
                  </MenuItem>
                ) : (
                  <MenuItem icon={<Archive size={16} />} onSelect={() => setStatus('archived')}>
                    Archive project
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem icon={<Trash2 size={16} />} danger onSelect={deleteProject}>
                  Delete project
                </MenuItem>
              </Menu>
            </>
          )}
        </div>
      </header>

      {archived && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Archive size={16} aria-hidden />
          This project is archived. Its tasks are read-only and hidden from the dashboard.
        </div>
      )}

      <nav className="tabs" aria-label="Project views" style={{ marginBottom: 16 }}>
        <NavLink to={base} end className="tab">
          <Kanban size={16} aria-hidden /> Board
        </NavLink>
        <NavLink to={`${base}/timeline`} className="tab">
          <CalendarRange size={16} aria-hidden /> Timeline
        </NavLink>
        <NavLink to={`${base}/list`} className="tab">
          <List size={16} aria-hidden /> List
        </NavLink>
      </nav>

      <TaskFilters value={filters} onChange={setFilters} users={users} showHideDone={view !== 'board'}>
        {isFiltering(filters) && tasks.data && (
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            Showing {visibleTasks.length} of {tasks.data.length}
          </span>
        )}
      </TaskFilters>

      {tasks.isPending ? (
        <PageLoading />
      ) : tasks.isError ? (
        <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : view === 'board' ? (
        <KanbanBoard
          projectId={p.id}
          tasks={visibleTasks}
          cacheKey={cacheKey}
          usersById={byId}
          readOnly={archived}
          onOpenTask={openTask}
        />
      ) : view === 'timeline' ? (
        <Timeline groups={[{ project: p, tasks: visibleTasks }]} showGroups={false} usersById={byId} onOpenTask={openTask} />
      ) : visibleTasks.length === 0 ? (
        <div className="card">
          <EmptyState icon={<List size={22} />} title={tasks.data.length ? 'No tasks match the filters' : 'No tasks yet'}>
            {tasks.data.length ? 'Try clearing the filters.' : 'Create the first task for this project.'}
          </EmptyState>
        </div>
      ) : (
        <TaskTable tasks={visibleTasks} usersById={byId} onOpenTask={openTask} />
      )}

      <ProjectFormModal open={editing} onClose={() => setEditing(false)} project={p} />
      <NewTaskModal open={creating} onClose={() => setCreating(false)} projectId={p.id} />
    </div>
  );
}
