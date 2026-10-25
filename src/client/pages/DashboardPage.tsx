import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CircleCheckBig, FolderKanban, Plus } from 'lucide-react';
import type { DashboardData, User } from '../../shared/types';
import { useDashboard, useProjects, useUsers } from '../api/queries';
import { canChangeWork, useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { DueChip, Meter } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading } from '../components/Feedback';
import { HealthBadge, healthTone, ProjectDot, StatusGlyph, StatusIcon } from '../components/Icons';
import { describeActivity } from '../features/activity/describe';
import { ThroughputChart, ThroughputTable, WorkloadChart, WorkloadLegend, WorkloadTable } from '../features/dashboard/Charts';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { firstName, formatDate, formatDateLong, formatDateTime, formatNumber, greeting, percent, timeAgo } from '../lib/format';
import { useNow, useOpenTask } from '../lib/hooks';
import { t, tn } from '../i18n';

export function DashboardPage() {
  useDocumentTitle(t('Dashboard'));
  const me = useCurrentUser();
  const dashboard = useDashboard();
  const { byId } = useUsers();

  return (
    <div className="page">
      <header className="page-header">
        <div className="titles">
          <h1>
            {greeting()}, {firstName(me.name)}
          </h1>
          <p className="subtitle">{dashboard.data ? formatDateLong(dashboard.data.today) : ' '}</p>
        </div>
      </header>

      {dashboard.isPending ? (
        <PageLoading />
      ) : dashboard.isError ? (
        <ErrorNotice error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <div className={dashboard.isRefetching ? 'dash is-refreshing' : 'dash'}>
          <Kpis data={dashboard.data} />
          <div className="dash-grid">
            <div className="dash-col">
              <ProjectsPanel data={dashboard.data} usersById={byId} />
              <WorkloadPanel data={dashboard.data} usersById={byId} />
            </div>
            <div className="dash-col">
              <MyTasksPanel data={dashboard.data} />
              <ThroughputPanel data={dashboard.data} />
              <ActivityPanel data={dashboard.data} usersById={byId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, glyph }: { label: string; value: number; sub: ReactNode; glyph?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {formatNumber(value)}
        {glyph}
      </span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function Kpis({ data }: { data: DashboardData }) {
  const s = data.stats;
  return (
    <div className="kpis">
      <StatTile
        label={t('Open tasks')}
        value={s.openTasks}
        sub={tn('in {count} active project', 'in {count} active projects', s.activeProjects)}
      />
      <StatTile label={t('Due this week')} value={s.dueThisWeek} sub={t('still open, due by Sunday')} />
      <StatTile
        label={t('Overdue')}
        value={s.overdue}
        glyph={s.overdue > 0 ? <StatusGlyph tone="critical" size={18} /> : undefined}
        sub={s.overdue > 0 ? t('need attention') : t('nothing late')}
      />
      <StatTile label={t('Completed this week')} value={s.completedThisWeek} sub={t('{count} last week', { count: s.completedLastWeek })} />
    </div>
  );
}

function Panel({
  title,
  sub,
  action,
  children,
  className,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card panel ${className ?? ''}`}>
      <div className="card-header">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <h2>{title}</h2>
          {sub && <span className="card-sub">{sub}</span>}
        </div>
        <span className="spacer" />
        {action}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function ViewToggle({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <div className="segmented" role="group" aria-label={t('Display as')}>
      <button type="button" aria-pressed={!table} onClick={() => onChange(false)}>
        {t('Chart')}
      </button>
      <button type="button" aria-pressed={table} onClick={() => onChange(true)}>
        {t('Table')}
      </button>
    </div>
  );
}

function ProjectsPanel({ data, usersById }: { data: DashboardData; usersById: Map<number, User> }) {
  const me = useCurrentUser();
  const [creating, setCreating] = useState(false);
  const { data: projects } = useProjects();
  const owners = new Map((projects ?? []).map((p) => [p.id, p.ownerId]));
  return (
    <Panel
      title={t('Project progress')}
      sub={t('Share of tasks done. Projects that need attention come first.')}
      action={
        <Link to="/projects" className="btn btn-ghost btn-sm">
          {t('All projects')} <ArrowRight size={14} />
        </Link>
      }
    >
      {data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={22} />}
          title={t('No active projects')}
          action={
            canChangeWork(me) && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> {t('New project')}
              </button>
            )
          }
        >
          {canChangeWork(me) ? t('Create a project to start tracking work.') : t('Projects you’re added to show up here.')}
        </EmptyState>
      ) : (
        <ul className="progress-list">
          {data.projects.map((p) => {
            const ownerId = owners.get(p.id);
            const owner = ownerId ? usersById.get(ownerId) : undefined;
            return (
              <li key={p.id}>
                <div className="progress-head">
                  <ProjectDot color={p.color} />
                  <Link to={`/projects/${p.id}`} className="progress-name truncate">
                    {p.name}
                  </Link>
                  {p.status === 'on_hold' && <span className="badge">{t('On hold')}</span>}
                  <span className="spacer" />
                  <HealthBadge health={p.health} reason={p.healthReason} />
                </div>
                <div className="meter-row">
                  <Meter value={p.progress} tone={healthTone(p.health)} label={t('{name}: {percent} done', { name: p.name, percent: percent(p.progress) })} />
                  <span className="meter-value">{percent(p.progress)}</span>
                </div>
                <div className="progress-foot">
                  <span>
                    {tn('{done} of {count} task done', '{done} of {count} tasks done', p.total, { done: p.done })}
                  </span>
                  {p.overdue > 0 && <span>· {t('{count} overdue', { count: p.overdue })}</span>}
                  {p.dueDate && <span>· {t('due {date}', { date: formatDate(p.dueDate, data.today) })}</span>}
                  <span className="spacer" />
                  <span className="muted" title={p.healthReason}>
                    {p.healthReason}
                  </span>
                  {owner && <Avatar user={owner} size="xs" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ProjectFormModal open={creating} onClose={() => setCreating(false)} />
    </Panel>
  );
}

function WorkloadPanel({ data, usersById }: { data: DashboardData; usersById: Map<number, User> }) {
  const [table, setTable] = useState(false);
  const rows = data.workload.filter((r) => usersById.has(r.userId));
  const anyWork = rows.some((r) => r.open > 0);
  return (
    <Panel
      title={t('Team workload')}
      sub={t('Open tasks per person, by stage')}
      action={anyWork && <ViewToggle table={table} onChange={setTable} />}
    >
      {!anyWork ? (
        <p className="secondary">{t('No open tasks are assigned to anyone right now.')}</p>
      ) : table ? (
        <WorkloadTable rows={rows} usersById={usersById} />
      ) : (
        <>
          <WorkloadLegend />
          <WorkloadChart rows={rows} usersById={usersById} />
        </>
      )}
    </Panel>
  );
}

function ThroughputPanel({ data }: { data: DashboardData }) {
  const [table, setTable] = useState(false);
  return (
    <Panel title={t('Tasks completed per week')} sub={t('Last 8 weeks')} action={<ViewToggle table={table} onChange={setTable} />}>
      {table ? <ThroughputTable weeks={data.throughput} /> : <ThroughputChart weeks={data.throughput} />}
    </Panel>
  );
}

function MyTasksPanel({ data }: { data: DashboardData }) {
  const openTask = useOpenTask();
  const { data: projects } = useProjects();
  const byId = new Map((projects ?? []).map((p) => [p.id, p]));
  return (
    <Panel
      title={t('My next tasks')}
      action={
        <Link to="/my-tasks" className="btn btn-ghost btn-sm">
          {t('View all')} <ArrowRight size={14} />
        </Link>
      }
    >
      {data.myTasks.length === 0 ? (
        <div className="row secondary" style={{ gap: 8 }}>
          <CircleCheckBig size={16} aria-hidden /> {t('Nothing assigned to you. Nice.')}
        </div>
      ) : (
        <ul className="mini-tasks">
          {data.myTasks.map((task) => {
            const project = byId.get(task.projectId);
            return (
              <li key={task.id}>
                <button type="button" className="mini-task" onClick={() => openTask(task.id)}>
                  <StatusIcon status={task.status} />
                  <span className="mini-task-title truncate">{task.title}</span>
                  {project && <ProjectDot color={project.color} />}
                  <DueChip dueDate={task.dueDate} status={task.status} today={data.today} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ data, usersById }: { data: DashboardData; usersById: Map<number, User> }) {
  const openTask = useOpenTask();
  useNow(60_000);
  return (
    <Panel title={t('Recent activity')}>
      {data.activity.length === 0 ? (
        <p className="secondary">{t('Changes by your team will show up here.')}</p>
      ) : (
        <ul className="activity">
          {data.activity.slice(0, 8).map((item) => {
            const user = item.userId ? usersById.get(item.userId) : undefined;
            const clickable = item.taskId !== null && item.type !== 'task.deleted';
            const body = (
              <>
                <Avatar user={user ?? null} size="sm" />
                <span className="activity-text">
                  <span>{describeActivity(item, usersById)}</span>
                  {item.type === 'comment.created' && item.data.excerpt && (
                    <span className="activity-excerpt">“{item.data.excerpt}”</span>
                  )}
                  <span className="activity-time" title={formatDateTime(item.createdAt)}>
                    {timeAgo(item.createdAt)}
                    {item.data.projectName && !item.type.startsWith('project.') ? ` · ${item.data.projectName}` : ''}
                  </span>
                </span>
              </>
            );
            return (
              <li key={item.id}>
                {clickable ? (
                  <button type="button" className="activity-item" onClick={() => openTask(item.taskId!)}>
                    {body}
                  </button>
                ) : (
                  <div className="activity-item">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
