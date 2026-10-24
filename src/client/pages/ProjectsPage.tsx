import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FolderKanban, Plus } from 'lucide-react';
import { localToday } from '../../shared/dates';
import { computeProjectHealth } from '../../shared/health';
import { PROJECT_STATUS_LABELS, type Project, type User } from '../../shared/types';
import { useProjects, useUsers } from '../api/queries';
import { useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { Meter } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading } from '../components/Feedback';
import { HealthBadge, healthTone, ProjectDot, StatusGlyph } from '../components/Icons';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { formatDate, percent, plural } from '../lib/format';

type Tab = 'current' | 'completed' | 'archived';

const TABS: { value: Tab; label: string }[] = [
  { value: 'current', label: 'Active & on hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export function ProjectsPage() {
  useDocumentTitle('Projects');
  const projects = useProjects(true);
  const { byId } = useUsers();
  const [tab, setTab] = useState<Tab>('current');
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const list = projects.data ?? [];
    return {
      current: list.filter((p) => p.status === 'active' || p.status === 'on_hold').length,
      completed: list.filter((p) => p.status === 'completed').length,
      archived: list.filter((p) => p.status === 'archived').length,
    };
  }, [projects.data]);

  const visible = (projects.data ?? []).filter((p) =>
    tab === 'current' ? p.status === 'active' || p.status === 'on_hold' : p.status === tab,
  );

  return (
    <div className="page">
      <header className="page-header">
        <div className="titles">
          <h1>Projects</h1>
          <p className="subtitle">Everything your team is working on.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New project
          </button>
        </div>
      </header>

      <div className="tabs" role="tablist" style={{ marginBottom: 18 }}>
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" className="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
            <span className="muted num">{counts[t.value]}</span>
          </button>
        ))}
      </div>

      {projects.isPending ? (
        <PageLoading />
      ) : projects.isError ? (
        <ErrorNotice error={projects.error} onRetry={() => void projects.refetch()} />
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={22} />}
            title={tab === 'current' ? 'No projects yet' : `No ${tab} projects`}
            action={
              tab === 'current' && (
                <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Create a project
                </button>
              )
            }
          >
            {tab === 'current' ? 'Projects group related tasks on a board and a timeline.' : undefined}
          </EmptyState>
        </div>
      ) : (
        <div className="project-grid">
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} owner={project.ownerId ? byId.get(project.ownerId) : undefined} />
          ))}
        </div>
      )}

      <ProjectFormModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectCard({ project, owner }: { project: Project; owner: User | undefined }) {
  const today = localToday();
  const { health, reason, progress } = computeProjectHealth(
    {
      status: project.status,
      startDate: project.startDate,
      dueDate: project.dueDate,
      createdAt: project.createdAt,
      total: project.counts.total,
      done: project.counts.done,
      overdue: project.counts.overdue,
    },
    today,
  );
  return (
    <Link to={`/projects/${project.id}`} className="card project-card">
      <div className="project-card-top">
        <ProjectDot color={project.color} size="lg" />
        <h2 className="truncate">{project.name}</h2>
        {project.status !== 'active' && <span className="badge">{PROJECT_STATUS_LABELS[project.status]}</span>}
      </div>
      <p className="project-card-desc">{project.description || <span className="muted">No description</span>}</p>
      <div className="meter-row">
        <Meter value={progress} tone={healthTone(health)} label={`${project.name} progress`} />
        <span className="meter-value">{percent(progress)}</span>
      </div>
      <div className="project-card-stats">
        <HealthBadge health={health} reason={reason} />
        <span className="secondary">
          {project.counts.done}/{plural(project.counts.total, 'task')} done
        </span>
        {project.counts.overdue > 0 && (
          <span className="row" style={{ gap: 5 }}>
            <StatusGlyph tone="critical" size={13} />
            {project.counts.overdue} overdue
          </span>
        )}
      </div>
      <div className="project-card-foot">
        <span className="row" style={{ gap: 6 }}>
          <Avatar user={owner ?? null} size="xs" title={null} />
          <span className="secondary truncate">{owner?.name ?? 'No owner'}</span>
        </span>
        <span className="spacer" />
        {project.dueDate && <span className="secondary num">Due {formatDate(project.dueDate, today)}</span>}
      </div>
    </Link>
  );
}
