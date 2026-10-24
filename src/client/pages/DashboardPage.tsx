import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CircleCheckBig, FolderKanban, Plus } from 'lucide-react';
import type { DashboardData, User } from '../../shared/types';
import { useDashboard, useProjects, useUsers } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { DueChip, Meter } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading } from '../components/Feedback';
import { HealthBadge, healthTone, ProjectDot, StatusGlyph, StatusIcon } from '../components/Icons';
import { describeActivity } from '../features/activity/describe';
import { ThroughputChart, ThroughputTable, WorkloadChart, WorkloadLegend, WorkloadTable } from '../features/dashboard/Charts';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { firstName, formatDate, formatDateLong, formatDateTime, greeting, percent, timeAgo } from '../lib/format';
import { useNow, useOpenTask } from '../lib/hooks';

export function DashboardPage() {
  useDocumentTitle('Dashboard');
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
        {value.toLocaleString()}
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
        label="Open tasks"
        value={s.openTasks}
        sub={`in ${s.activeProjects} active ${s.activeProjects === 1 ? 'project' : 'projects'}`}
      />
      <StatTile label="Due this week" value={s.dueThisWeek} sub="still open, due by Sunday" />
      <StatTile
        label="Overdue"
        value={s.overdue}
        glyph={s.overdue > 0 ? <StatusGlyph tone="critical" size={18} /> : undefined}
        sub={s.overdue > 0 ? 'need attention' : 'nothing late'}
      />
      <StatTile label="Completed this week" value={s.completedThisWeek} sub={`${s.completedLastWeek} last week`} />
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
    <div className="segmented" role="group" aria-label="Display as">
      <button type="button" aria-pressed={!table} onClick={() => onChange(false)}>
        Chart
      </button>
      <button type="button" aria-pressed={table} onClick={() => onChange(true)}>
        Table
      </button>
    </div>
  );
}

function ProjectsPanel({ data, usersById }: { data: DashboardData; usersById: Map<number, User> }) {
  const [creating, setCreating] = useState(false);
  const { data: projects } = useProjects();
  const owners = new Map((projects ?? []).map((p) => [p.id, p.ownerId]));
  return (
    <Panel
      title="Project progress"
      sub="Share of tasks done. Projects that need attention come first."
      action={
        <Link to="/projects" className="btn btn-ghost btn-sm">
          All projects <ArrowRight size={14} />
        </Link>
      }
    >
      {data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban size={22} />}
          title="No active projects"
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New project
            </button>
          }
        >
          Create a project to start tracking work.
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
                  {p.status === 'on_hold' && <span className="badge">On hold</span>}
                  <span className="spacer" />
                  <HealthBadge health={p.health} reason={p.healthReason} />
                </div>
                <div className="meter-row">
                  <Meter value={p.progress} tone={healthTone(p.health)} label={`${p.name}: ${percent(p.progress)} done`} />
                  <span className="meter-value">{percent(p.progress)}</span>
                </div>
                <div className="progress-foot">
                  <span>
                    {p.done} of {p.total} tasks done
                  </span>
                  {p.overdue > 0 && <span>· {p.overdue} overdue</span>}
                  {p.dueDate && <span>· due {formatDate(p.dueDate, data.today)}</span>}
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
      title="Team workload"
      sub="Open tasks per person, by stage"
      action={anyWork && <ViewToggle table={table} onChange={setTable} />}
    >
      {!anyWork ? (
        <p className="secondary">No open tasks are assigned to anyone right now.</p>
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
    <Panel title="Tasks completed per week" sub="Last 8 weeks" action={<ViewToggle table={table} onChange={setTable} />}>
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
      title="My next tasks"
      action={
        <Link to="/my-tasks" className="btn btn-ghost btn-sm">
          View all <ArrowRight size={14} />
        </Link>
      }
    >
      {data.myTasks.length === 0 ? (
        <div className="row secondary" style={{ gap: 8 }}>
          <CircleCheckBig size={16} aria-hidden /> Nothing assigned to you. Nice.
        </div>
      ) : (
        <ul className="mini-tasks">
          {data.myTasks.map((t) => {
            const project = byId.get(t.projectId);
            return (
              <li key={t.id}>
                <button type="button" className="mini-task" onClick={() => openTask(t.id)}>
                  <StatusIcon status={t.status} />
                  <span className="mini-task-title truncate">{t.title}</span>
                  {project && <ProjectDot color={project.color} />}
                  <DueChip dueDate={t.dueDate} status={t.status} today={data.today} />
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
    <Panel title="Recent activity">
      {data.activity.length === 0 ? (
        <p className="secondary">Changes by your team will show up here.</p>
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
