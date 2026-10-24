import { useMemo, useState } from 'react';
import { CircleCheckBig, Plus } from 'lucide-react';
import { addDays, localToday, startOfWeek } from '../../shared/dates';
import { TASK_PRIORITIES, type Project, type Task } from '../../shared/types';
import { errorMessage } from '../api/client';
import { useProjects, useTasks, useUpdateTask } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { DueChip } from '../components/Bits';
import { EmptyState, ErrorNotice, PageLoading, useToast } from '../components/Feedback';
import { PriorityIcon, ProjectDot, StatusIcon } from '../components/Icons';
import { nextCopyMessage } from '../features/board/KanbanBoard';
import { NewTaskModal } from '../features/tasks/NewTaskModal';
import { localDateOf } from '../lib/format';
import { useOpenTask } from '../lib/hooks';

interface Section {
  key: string;
  title: string;
  tasks: Task[];
}

const byDueThenPriority = (a: Task, b: Task) =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
  TASK_PRIORITIES.indexOf(b.priority) - TASK_PRIORITIES.indexOf(a.priority) ||
  a.id - b.id;

export function MyTasksPage() {
  useDocumentTitle('My tasks');
  const me = useCurrentUser();
  const tasks = useTasks({ assigneeId: 'me' });
  const { data: projects } = useProjects(true);
  const openTask = useOpenTask();
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const today = localToday();

  const projectsById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);

  const sections = useMemo<Section[]>(() => {
    const weekEnd = addDays(startOfWeek(today), 6);
    const open = (tasks.data ?? []).filter((t) => t.status !== 'done').sort(byDueThenPriority);
    const recentDone = (tasks.data ?? [])
      .filter((t) => t.status === 'done' && t.completedAt && localDateOf(t.completedAt) >= addDays(today, -14))
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    const list: Section[] = [
      { key: 'overdue', title: 'Overdue', tasks: open.filter((t) => t.dueDate && t.dueDate < today) },
      { key: 'today', title: 'Today', tasks: open.filter((t) => t.dueDate === today) },
      { key: 'week', title: 'Later this week', tasks: open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= weekEnd) },
      { key: 'later', title: 'Later', tasks: open.filter((t) => t.dueDate && t.dueDate > weekEnd) },
      { key: 'none', title: 'No due date', tasks: open.filter((t) => !t.dueDate) },
    ];
    if (showDone) list.push({ key: 'done', title: 'Completed in the last two weeks', tasks: recentDone });
    return list.filter((s) => s.tasks.length > 0);
  }, [tasks.data, today, showDone]);

  const openCount = (tasks.data ?? []).filter((t) => t.status !== 'done').length;

  return (
    <div className="page">
      <header className="page-header">
        <div className="titles">
          <h1>My tasks</h1>
          <p className="subtitle">
            {openCount === 0 ? 'Nothing assigned to you right now.' : `${openCount} open ${openCount === 1 ? 'task' : 'tasks'} assigned to you.`}
          </p>
        </div>
        <div className="actions">
          <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" className="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show recently completed
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New task
          </button>
        </div>
      </header>

      {tasks.isPending ? (
        <PageLoading />
      ) : tasks.isError ? (
        <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : sections.length === 0 ? (
        <div className="card">
          <EmptyState icon={<CircleCheckBig size={22} />} title="You're all caught up">
            Tasks assigned to you across all projects show up here, sorted by due date.
          </EmptyState>
        </div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {sections.map((section) => (
            <section key={section.key} className="card task-section" aria-labelledby={`section-${section.key}`}>
              <h2 id={`section-${section.key}`} className="task-section-title">
                {section.title} <span className="muted num">{section.tasks.length}</span>
              </h2>
              <ul className="task-list">
                {section.tasks.map((task) => (
                  <MyTaskRow
                    key={task.id}
                    task={task}
                    project={projectsById.get(task.projectId)}
                    today={today}
                    onOpen={() => openTask(task.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <NewTaskModal open={creating} onClose={() => setCreating(false)} defaults={{ assigneeId: me.id }} />
    </div>
  );
}

function MyTaskRow({ task, project, today, onOpen }: { task: Task; project: Project | undefined; today: string; onOpen: () => void }) {
  const update = useUpdateTask();
  const toast = useToast();
  const done = task.status === 'done';
  const readOnly = project?.status === 'archived';

  return (
    <li className="task-row" onClick={onOpen}>
      <input
        type="checkbox"
        className="checkbox"
        checked={done}
        disabled={readOnly}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} as done`}
        onClick={(e) => e.stopPropagation()}
        onChange={() =>
          update.mutate(
            { id: task.id, patch: { status: done ? 'todo' : 'done' } },
            {
              onSuccess: (result) => {
                if (!done) toast.success(result.next ? `Completed. ${nextCopyMessage(result.next)}` : `Completed “${task.title}”`);
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
      <StatusIcon status={task.status} />
      <button
        type="button"
        className={`task-row-title ${done ? 'is-done' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {task.title}
      </button>
      {project && (
        <span className="task-row-project">
          <ProjectDot color={project.color} />
          <span className="truncate">{project.name}</span>
        </span>
      )}
      <PriorityIcon priority={task.priority} />
      <span className="task-row-due">
        <DueChip dueDate={task.dueDate} status={task.status} today={today} />
      </span>
    </li>
  );
}
