import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarRange,
  Copy,
  Diamond,
  Download,
  Ellipsis,
  Eye,
  FolderX,
  Kanban,
  LayoutTemplate,
  List,
  Lock,
  Plus,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { localToday } from '../../shared/dates';
import { computeProjectHealth } from '../../shared/health';
import { PROJECT_STATUS_LABELS, type GroupBy, type ProjectView, type SavedView } from '../../shared/types';
import { ApiError, errorMessage } from '../api/client';
import { undoDelete } from '../api/inbox';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteProject, useProject, useTasks, useUpdateProject, useUsers } from '../api/queries';
import { useViews } from '../api/planning';
import { canChangeWork, canManageProject, useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { Meter } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading, useConfirm, useToast } from '../components/Feedback';
import { HealthBadge, healthTone, ProjectDot } from '../components/Icons';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu';
import { KanbanBoard } from '../features/board/KanbanBoard';
import { groupOptions, validGroupBy } from '../features/board/lanes';
import { CalendarView } from '../features/calendar/CalendarView';
import { FieldsDialog } from '../features/planning/FieldsDialog';
import { MilestonesDialog } from '../features/planning/MilestonesDialog';
import { fromSettings, readDisplay, toSettings, viewChanged, viewPath, writeDisplay, type DisplayState } from '../features/planning/views';
import { ViewsMenu } from '../features/planning/ViewsMenu';
import { DuplicateDialog } from '../features/projects/DuplicateDialog';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { applyFilters, DEFAULT_FILTERS, isFiltering, TaskFilters } from '../features/tasks/filters';
import { NewTaskModal } from '../features/tasks/NewTaskModal';
import { TaskTable } from '../features/tasks/TaskTable';
import { Timeline } from '../features/timeline/Timeline';
import { formatDate, formatRange, percent } from '../lib/format';
import { useOpenTask } from '../lib/hooks';
import { t, tn, tr } from '../i18n';

const VIEWS: ProjectView[] = ['board', 'list', 'timeline', 'calendar'];

export function ProjectPage() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const validId = Number.isInteger(projectId) && projectId > 0;
  const view: ProjectView = VIEWS.includes(params.view as ProjectView) ? (params.view as ProjectView) : 'board';
  const me = useCurrentUser();
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const project = useProject(validId ? projectId : undefined);
  const cacheKey = useMemo(() => ({ projectId }), [projectId]);
  const tasks = useTasks(cacheKey, { enabled: validId });
  const { users, byId } = useUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const { views } = useViews();
  const savedParam = Number(searchParams.get('saved'));
  const activeView: SavedView | undefined = views.find((v) => v.id === savedParam && v.projectId === projectId);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [display, setDisplayState] = useState<DisplayState>(() => readDisplay(projectId));
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [newTaskDate, setNewTaskDate] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [copyMode, setCopyMode] = useState<'copy' | 'template' | null>(null);
  const update = useUpdateProject();
  const remove = useDeleteProject();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();

  useDocumentTitle(activeView && project.data ? `${activeView.name} · ${project.data.name}` : project.data?.name);

  // Another project: start from its own remembered grouping, without filters.
  const shownProject = useRef(projectId);
  useEffect(() => {
    if (shownProject.current === projectId) return;
    shownProject.current = projectId;
    setFilters(DEFAULT_FILTERS);
    setDisplayState(readDisplay(projectId));
  }, [projectId]);

  // Opening a saved view (from the sidebar or the menu) brings back its filters and grouping.
  const appliedView = useRef<number | null>(null);
  useEffect(() => {
    if (!activeView) {
      appliedView.current = null;
      return;
    }
    if (appliedView.current === activeView.id) return;
    appliedView.current = activeView.id;
    const saved = fromSettings(activeView.settings);
    setFilters(saved.filters);
    setDisplayState(saved.display);
  }, [activeView]);

  const setDisplay = (patch: Partial<DisplayState>) =>
    setDisplayState((prev) => {
      const next = { ...prev, ...patch };
      if (!activeView) writeDisplay(projectId, next);
      return next;
    });

  const allTasks = tasks.data;
  const visibleTasks = useMemo(() => applyFilters(allTasks ?? [], filters, me.id), [allTasks, filters, me.id]);
  // The board shows main tasks; their cards count the subtasks. Other views show everything.
  const boardTasks = useMemo(
    () => (display.showSubtasks ? visibleTasks : visibleTasks.filter((x) => x.parentId === null)),
    [visibleTasks, display.showSubtasks],
  );
  const parentTitles = useMemo(() => new Map((allTasks ?? []).map((x) => [x.id, x.title])), [allTasks]);
  const settings = useMemo(() => toSettings(filters, display), [filters, display]);

  const notFound = (
    <div className="page">
      <EmptyState icon={<FolderX size={22} />} title={t('Project not found')}>
        {t('It may have been deleted, the link is wrong, or it’s a private project you haven’t been added to.')}
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
  const guest = !canChangeWork(me);
  const archived = p.status === 'archived';
  const readOnly = archived || guest;
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
    tr(),
  );

  const setStatus = (status: 'archived' | 'active') =>
    update.mutate(
      { id: p.id, patch: { status } },
      {
        onSuccess: () => toast.success(status === 'archived' ? t('Project archived') : t('Project restored')),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const deleteProject = async () => {
    const ok = await confirm({
      title: t('Delete “{name}”?', { name: p.name }),
      message: tn(
        'The project and its {count} task move to the trash, where they stay for 30 days before they’re removed for good. Archiving keeps everything but hides it.',
        'The project and its {count} tasks move to the trash, where they stay for 30 days before they’re removed for good. Archiving keeps everything but hides it.',
        p.counts.total,
      ),
      confirmLabel: t('Move to trash'),
      danger: true,
    });
    if (!ok) return;
    const item = { kind: 'project' as const, id: p.id };
    // Leave the page first, so it doesn't try to reload a project that is gone.
    navigate('/projects');
    remove.mutateAsync(p.id).then(
      () =>
        toast.success(t('Project moved to the trash'), {
          label: t('Undo'),
          onClick: () =>
            void undoDelete(queryClient, item).then(
              () => toast.success(t('Project restored')),
              (e) => toast.error(errorMessage(e)),
            ),
        }),
      (e) => toast.error(errorMessage(e)),
    );
  };

  const groupBy: GroupBy = validGroupBy(display.groupBy, p);
  const subtaskCount = (allTasks ?? []).filter((x) => x.parentId !== null).length;
  const changed = activeView ? viewChanged(activeView, { view, settings }) : false;
  const tab = (to: ProjectView) => viewPath(p.id, to, activeView?.id);
  const today = localToday();
  const nextMilestone = [...p.milestones].filter((m) => !m.reachedAt).sort((a, b) => a.date.localeCompare(b.date))[0];
  const openSaved = (saved: SavedView) => {
    appliedView.current = null;
    navigate(viewPath(p.id, saved.view, saved.id));
  };
  const closeSaved = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('saved');
      return next;
    });
    setFilters(DEFAULT_FILTERS);
    setDisplayState(readDisplay(p.id));
  };

  return (
    <div className="page page-wide">
      <header className="page-header project-header">
        <div className="titles">
          <div className="row" style={{ gap: 10 }}>
            <ProjectDot color={p.color} size="lg" />
            <h1 className="truncate">{p.name}</h1>
            {p.isTemplate ? (
              <span className="badge badge-accent">
                <LayoutTemplate size={12} aria-hidden /> {t('Template')}
              </span>
            ) : (
              <span className="badge">{t(PROJECT_STATUS_LABELS[p.status])}</span>
            )}
            {p.visibility === 'private' && (
              <span className="badge" title={t('Only the people on this project and admins can see it')}>
                <Lock size={12} aria-hidden /> {t('Private')}
              </span>
            )}
          </div>
          {p.description && <p className="subtitle project-description">{p.description}</p>}
          <div className="project-meta">
            <span className="row" style={{ gap: 6 }} title={t('Project owner')}>
              <Avatar user={owner ?? null} size="xs" title={null} />
              {owner?.name ?? t('No owner')}
            </span>
            <span className="row secondary" style={{ gap: 6 }}>
              <CalendarRange size={14} aria-hidden />
              {formatRange(p.startDate, p.dueDate)}
            </span>
            {!p.isTemplate && <HealthBadge health={health.health} reason={health.reason} />}
            {!p.isTemplate && (
              <span className="meter-row" style={{ minWidth: 200 }}>
                <Meter value={health.progress} tone={healthTone(health.health)} label={t('{name} progress', { name: p.name })} />
                <span className="meter-value">{percent(health.progress)}</span>
                <span className="muted num" style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
                  {t('{done}/{total} done', { done: p.counts.done, total: p.counts.total })}
                </span>
              </span>
            )}
            {p.memberIds.length > 0 && (
              <span className="avatar-stack" title={tn('{count} person added to this project', '{count} people added to this project', p.memberIds.length)}>
                {p.memberIds.slice(0, 5).map((id) => (
                  <Avatar key={id} user={byId.get(id) ?? null} size="xs" />
                ))}
                {p.memberIds.length > 5 && <span className="muted num">+{p.memberIds.length - 5}</span>}
              </span>
            )}
            {nextMilestone && (
              <button
                type="button"
                className={`chip chip-button ${nextMilestone.date < today ? 'chip-overdue' : ''}`}
                onClick={() => setMilestonesOpen(true)}
                title={t('Next milestone')}
              >
                <Diamond size={13} aria-hidden />
                {t('{name} · {date}', { name: nextMilestone.name, date: formatDate(nextMilestone.date) })}
              </button>
            )}
          </div>
        </div>
        <div className="actions">
          {p.isTemplate && !guest && (
            <button type="button" className="btn btn-primary" onClick={() => setUsingTemplate(true)}>
              <LayoutTemplate size={16} /> {t('Use this template')}
            </button>
          )}
          {!readOnly && (
            <button type="button" className={`btn ${p.isTemplate ? '' : 'btn-primary'}`} onClick={() => setCreating(true)}>
              <Plus size={16} /> {t('New task')}
            </button>
          )}
          {manage && (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Settings size={16} /> {t('Settings')}
            </button>
          )}
          <Menu
            trigger={(props) => (
              <button type="button" className="btn" aria-label={t('More project actions')} {...props} style={{ padding: '0 9px' }}>
                <Ellipsis size={17} />
              </button>
            )}
          >
            {!guest && (
              <MenuItem icon={<Copy size={16} />} onSelect={() => setCopyMode('copy')}>
                {t('Duplicate project…')}
              </MenuItem>
            )}
            {!guest && !p.isTemplate && (
              <MenuItem icon={<LayoutTemplate size={16} />} onSelect={() => setCopyMode('template')}>
                {t('Save as template…')}
              </MenuItem>
            )}
            <MenuItem icon={<Diamond size={16} />} onSelect={() => setMilestonesOpen(true)}>
              {t('Milestones…')}
            </MenuItem>
            {manage && !archived && (
              <MenuItem icon={<SlidersHorizontal size={16} />} onSelect={() => setFieldsOpen(true)}>
                {t('Custom fields…')}
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<Download size={16} />} onSelect={() => (window.location.href = `/api/projects/${p.id}/export.csv`)}>
              {t('Export tasks (CSV)')}
            </MenuItem>
            {manage && (
              <>
                <MenuSeparator />
                {archived ? (
                  <MenuItem icon={<ArchiveRestore size={16} />} onSelect={() => setStatus('active')}>
                    {t('Restore project')}
                  </MenuItem>
                ) : (
                  !p.isTemplate && (
                    <MenuItem icon={<Archive size={16} />} onSelect={() => setStatus('archived')}>
                      {t('Archive project')}
                    </MenuItem>
                  )
                )}
                <MenuItem icon={<Trash2 size={16} />} danger onSelect={deleteProject}>
                  {p.isTemplate ? t('Delete template') : t('Delete project')}
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      {archived && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Archive size={16} aria-hidden />
          {t('This project is archived. Its tasks are read-only and hidden from the dashboard.')}
        </div>
      )}
      {p.isTemplate && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <LayoutTemplate size={16} aria-hidden />
          {t('This is a template. Its tasks don’t count as work. Use it to start new projects with the same columns, labels and tasks.')}
        </div>
      )}
      {guest && !archived && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Eye size={16} aria-hidden />
          {t('You’re a guest on this project: you can follow along and comment on tasks.')}
        </div>
      )}

      <nav className="tabs" aria-label={t('Project views')} style={{ marginBottom: 16 }}>
        <NavLink to={tab('board')} end className={() => `tab ${view === 'board' ? 'active' : ''}`}>
          <Kanban size={16} aria-hidden /> {t('Board')}
        </NavLink>
        <NavLink to={tab('timeline')} className={() => `tab ${view === 'timeline' ? 'active' : ''}`}>
          <CalendarRange size={16} aria-hidden /> {t('Timeline')}
        </NavLink>
        <NavLink to={tab('calendar')} className={() => `tab ${view === 'calendar' ? 'active' : ''}`}>
          <CalendarDays size={16} aria-hidden /> {t('Calendar')}
        </NavLink>
        <NavLink to={tab('list')} className={() => `tab ${view === 'list' ? 'active' : ''}`}>
          <List size={16} aria-hidden /> {t('List')}
        </NavLink>
      </nav>

      <TaskFilters
        value={filters}
        onChange={setFilters}
        users={users}
        showHideDone={view !== 'board'}
        labels={p.labels}
        milestones={p.milestones}
        fields={p.fields}
      >
        {isFiltering(filters) && allTasks && (
          <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('Showing {shown} of {total}', { shown: visibleTasks.length, total: allTasks.length })}
          </span>
        )}
        {view === 'board' && (
          <>
            <select
              className="select select-sm"
              style={{ width: 'auto' }}
              value={groupBy}
              onChange={(e) => setDisplay({ groupBy: e.target.value as GroupBy })}
              aria-label={t('Group by')}
              title={t('Group by')}
            >
              {groupOptions(p).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {subtaskCount > 0 && (
              <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={display.showSubtasks}
                  onChange={(e) => setDisplay({ showSubtasks: e.target.checked })}
                />
                {t('Show subtasks')}
              </label>
            )}
          </>
        )}
        <ViewsMenu projectId={p.id} view={view} settings={settings} active={activeView} changed={changed} onOpen={openSaved} onClose={closeSaved} />
      </TaskFilters>

      {tasks.isPending ? (
        <PageLoading />
      ) : tasks.isError ? (
        <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : view === 'board' ? (
        <KanbanBoard
          project={p}
          tasks={boardTasks}
          cacheKey={cacheKey}
          usersById={byId}
          readOnly={readOnly}
          canEditColumns={manage}
          onOpenTask={openTask}
          groupBy={groupBy}
          parentTitles={display.showSubtasks ? parentTitles : undefined}
        />
      ) : view === 'timeline' ? (
        <Timeline groups={[{ project: p, tasks: visibleTasks }]} showGroups={false} usersById={byId} onOpenTask={openTask} />
      ) : view === 'calendar' ? (
        <CalendarView
          tasks={visibleTasks}
          milestones={p.milestones.map((m) => ({ ...m, color: p.color }))}
          usersById={byId}
          colorOf={() => p.color}
          canMove={() => !readOnly}
          onOpenTask={openTask}
          onAddTask={readOnly ? undefined : (date) => setNewTaskDate(date)}
          mode={display.calendarMode}
          onModeChange={(calendarMode) => setDisplay({ calendarMode })}
          prefixOf={(task) => (task.parentId !== null ? parentTitles.get(task.parentId) : undefined)}
        />
      ) : visibleTasks.length === 0 ? (
        <div className="card">
          <EmptyState icon={<List size={22} />} title={allTasks?.length ? t('No tasks match the filters') : t('No tasks yet')}>
            {allTasks?.length ? t('Try clearing the filters.') : readOnly ? t('Nothing here yet.') : t('Create the first task for this project.')}
          </EmptyState>
        </div>
      ) : (
        <TaskTable
          tasks={visibleTasks}
          usersById={byId}
          columns={p.columns}
          labels={p.labels}
          milestones={p.milestones}
          fields={p.fields}
          parentTitles={parentTitles}
          onOpenTask={openTask}
        />
      )}

      <ProjectFormModal open={editing} onClose={() => setEditing(false)} project={p} />
      <ProjectFormModal open={usingTemplate} onClose={() => setUsingTemplate(false)} templateId={p.id} />
      <NewTaskModal open={creating} onClose={() => setCreating(false)} projectId={p.id} />
      <NewTaskModal
        open={newTaskDate !== undefined}
        onClose={() => setNewTaskDate(undefined)}
        projectId={p.id}
        defaults={{ dueDate: newTaskDate }}
      />
      <MilestonesDialog project={p} tasks={allTasks ?? []} open={milestonesOpen} onClose={() => setMilestonesOpen(false)} readOnly={readOnly} />
      {manage && <FieldsDialog project={p} open={fieldsOpen} onClose={() => setFieldsOpen(false)} />}
      <DuplicateDialog project={p} mode={copyMode} onClose={() => setCopyMode(null)} />
    </div>
  );
}
