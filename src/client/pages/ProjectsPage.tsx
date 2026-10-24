import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FolderKanban, LayoutTemplate, Lock, Plus } from 'lucide-react';
import { localToday } from '../../shared/dates';
import { computeProjectHealth } from '../../shared/health';
import { PROJECT_STATUS_LABELS, type Project, type User } from '../../shared/types';
import { useProjects, useUsers } from '../api/queries';
import { canChangeWork, useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { Meter } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading } from '../components/Feedback';
import { HealthBadge, healthTone, ProjectDot, StatusGlyph } from '../components/Icons';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { formatDate, percent } from '../lib/format';
import { N_, t, tn, tr } from '../i18n';

type Tab = 'current' | 'completed' | 'archived' | 'templates';

const TABS: { value: Tab; label: string }[] = [
  { value: 'current', label: N_('Active & on hold') },
  { value: 'completed', label: N_('Completed') },
  { value: 'archived', label: N_('Archived') },
  { value: 'templates', label: N_('Templates') },
];

export function ProjectsPage() {
  useDocumentTitle(t('Projects'));
  const me = useCurrentUser();
  const canCreate = canChangeWork(me);
  const projects = useProjects(true, 'include');
  const { byId } = useUsers();
  const [tab, setTab] = useState<Tab>('current');
  const [creating, setCreating] = useState<false | 'project' | 'template'>(false);
  const [fromTemplate, setFromTemplate] = useState<number | null>(null);

  const counts = useMemo(() => {
    const list = projects.data ?? [];
    const work = list.filter((p) => !p.isTemplate);
    return {
      current: work.filter((p) => p.status === 'active' || p.status === 'on_hold').length,
      completed: work.filter((p) => p.status === 'completed').length,
      archived: work.filter((p) => p.status === 'archived').length,
      templates: list.filter((p) => p.isTemplate).length,
    };
  }, [projects.data]);

  const visible = (projects.data ?? []).filter((p) =>
    tab === 'templates'
      ? p.isTemplate
      : !p.isTemplate && (tab === 'current' ? p.status === 'active' || p.status === 'on_hold' : p.status === tab),
  );

  return (
    <div className="page">
      <header className="page-header">
        <div className="titles">
          <h1>{t('Projects')}</h1>
          <p className="subtitle">{t('Everything your team is working on.')}</p>
        </div>
        {canCreate && (
          <div className="actions">
            {tab === 'templates' && (
              <button type="button" className="btn" onClick={() => setCreating('template')}>
                <LayoutTemplate size={16} /> {t('New template')}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setCreating('project')}>
              <Plus size={16} /> {t('New project')}
            </button>
          </div>
        )}
      </header>

      <div className="tabs" role="tablist" style={{ marginBottom: 18 }}>
        {TABS.map((option) => (
          <button key={option.value} type="button" role="tab" className="tab" aria-selected={tab === option.value} onClick={() => setTab(option.value)}>
            {t(option.label)}
            <span className="muted num">{counts[option.value]}</span>
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
            icon={tab === 'templates' ? <LayoutTemplate size={22} /> : <FolderKanban size={22} />}
            title={tab === 'current' ? t('No projects yet') : tab === 'templates' ? t('No templates yet') : tab === 'completed' ? t('No completed projects') : t('No archived projects')}
            action={
              canCreate &&
              (tab === 'current' || tab === 'templates') && (
                <button type="button" className="btn btn-primary" onClick={() => setCreating(tab === 'templates' ? 'template' : 'project')}>
                  <Plus size={16} /> {tab === 'templates' ? t('Create a template') : t('Create a project')}
                </button>
              )
            }
          >
            {tab === 'current'
              ? t('Projects group related tasks on a board and a timeline.')
              : tab === 'templates'
                ? t('A template is a ready-made plan (columns, labels and tasks) to start new projects from. You can also save any project as a template from its menu.')
                : undefined}
          </EmptyState>
        </div>
      ) : (
        <div className="project-grid">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              owner={project.ownerId ? byId.get(project.ownerId) : undefined}
              onUseTemplate={canCreate ? () => setFromTemplate(project.id) : undefined}
            />
          ))}
        </div>
      )}

      <ProjectFormModal open={creating !== false} onClose={() => setCreating(false)} asTemplate={creating === 'template'} />
      <ProjectFormModal open={fromTemplate !== null} onClose={() => setFromTemplate(null)} templateId={fromTemplate ?? undefined} />
    </div>
  );
}

function ProjectCard({ project, owner, onUseTemplate }: { project: Project; owner: User | undefined; onUseTemplate?: () => void }) {
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
    tr(),
  );
  return (
    <Link to={`/projects/${project.id}`} className="card project-card">
      <div className="project-card-top">
        <ProjectDot color={project.color} size="lg" />
        <h2 className="truncate">{project.name}</h2>
        {project.visibility === 'private' && (
          <span className="badge" title={t('Private: only the people on it and admins can see it')}>
            <Lock size={11} aria-hidden /> {t('Private')}
          </span>
        )}
        {project.status !== 'active' && !project.isTemplate && <span className="badge">{t(PROJECT_STATUS_LABELS[project.status])}</span>}
      </div>
      <p className="project-card-desc">{project.description || <span className="muted">{t('No description')}</span>}</p>
      {project.isTemplate ? (
        <div className="project-card-stats">
          <span className="secondary">
            {tn('{count} task', '{count} tasks', project.counts.total)} · {tn('{count} column', '{count} columns', project.columns.length)} ·{' '}
            {tn('{count} label', '{count} labels', project.labels.length)}
          </span>
          {onUseTemplate && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={(e) => {
                e.preventDefault();
                onUseTemplate();
              }}
            >
              <LayoutTemplate size={14} /> {t('Use template')}
            </button>
          )}
        </div>
      ) : (
        <>
      <div className="meter-row">
        <Meter value={progress} tone={healthTone(health)} label={t('{name} progress', { name: project.name })} />
        <span className="meter-value">{percent(progress)}</span>
      </div>
      <div className="project-card-stats">
        <HealthBadge health={health} reason={reason} />
        <span className="secondary">
          {tn('{done}/{count} task done', '{done}/{count} tasks done', project.counts.total, { done: project.counts.done })}
        </span>
        {project.counts.overdue > 0 && (
          <span className="row" style={{ gap: 5 }}>
            <StatusGlyph tone="critical" size={13} />
            {t('{count} overdue', { count: project.counts.overdue })}
          </span>
        )}
      </div>
        </>
      )}
      <div className="project-card-foot">
        <span className="row" style={{ gap: 6 }}>
          <Avatar user={owner ?? null} size="xs" title={null} />
          <span className="secondary truncate">{owner?.name ?? t('No owner')}</span>
        </span>
        <span className="spacer" />
        {project.dueDate && <span className="secondary num">{t('Due {date}', { date: formatDate(project.dueDate, today) })}</span>}
      </div>
    </Link>
  );
}
