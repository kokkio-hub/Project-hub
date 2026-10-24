import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { localToday } from '../../../shared/dates';
import { TASK_PRIORITIES, TASK_STATUSES, type Project, type Task, type User } from '../../../shared/types';
import { Person } from '../../components/Avatar';
import { DueChip } from '../../components/Bits';
import { PriorityLabel, ProjectDot, StatusLabel } from '../../components/Icons';
import { formatDate } from '../../lib/format';

type SortKey = 'title' | 'status' | 'priority' | 'assignee' | 'startDate' | 'dueDate' | 'project';

interface Props {
  tasks: Task[];
  usersById: Map<number, User>;
  projectsById?: Map<number, Project>;
  onOpenTask: (id: number) => void;
}

/** Sortable table of tasks: the list view, and the accessible table twin of the board and timeline. */
export function TaskTable({ tasks, usersById, projectsById, onOpenTask }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dueDate', dir: 1 });
  const today = localToday();

  const sorted = useMemo(() => {
    const name = (id: number | null) => (id ? (usersById.get(id)?.name ?? '') : '￿');
    const value = (t: Task): string | number => {
      switch (sort.key) {
        case 'title':
          return t.title.toLowerCase();
        case 'status':
          return TASK_STATUSES.indexOf(t.status);
        case 'priority':
          return -TASK_PRIORITIES.indexOf(t.priority);
        case 'assignee':
          return name(t.assigneeId).toLowerCase();
        case 'startDate':
          return t.startDate ?? '￿';
        case 'dueDate':
          return t.dueDate ?? '￿';
        case 'project':
          return (projectsById?.get(t.projectId)?.name ?? '').toLowerCase();
      }
    };
    return [...tasks].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return a.id - b.id;
    });
  }, [tasks, sort, usersById, projectsById]);

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className="th-sort"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
        >
          {label}
          <Icon size={13} className={active ? '' : 'muted'} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            {header('title', 'Task')}
            {projectsById && header('project', 'Project')}
            {header('status', 'Status')}
            {header('priority', 'Priority')}
            {header('assignee', 'Assignee')}
            {header('startDate', 'Start')}
            {header('dueDate', 'Due')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const project = projectsById?.get(t.projectId);
            return (
              <tr
                key={t.id}
                className="clickable"
                onClick={() => onOpenTask(t.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpenTask(t.id);
                }}
                tabIndex={0}
              >
                <td style={{ maxWidth: 420 }}>
                  <span className={`truncate ${t.status === 'done' ? 'secondary' : ''}`} style={{ display: 'block', fontWeight: 520 }}>
                    {t.title}
                  </span>
                </td>
                {projectsById && (
                  <td>
                    {project && (
                      <span className="row" style={{ gap: 6 }}>
                        <ProjectDot color={project.color} />
                        <span className="truncate">{project.name}</span>
                      </span>
                    )}
                  </td>
                )}
                <td>
                  <StatusLabel status={t.status} />
                </td>
                <td>
                  <PriorityLabel priority={t.priority} />
                </td>
                <td>
                  <Person user={t.assigneeId ? usersById.get(t.assigneeId) : null} muted={!t.assigneeId} />
                </td>
                <td className="date secondary">{formatDate(t.startDate, today) || '–'}</td>
                <td className="date">
                  {t.dueDate ? <DueChip dueDate={t.dueDate} status={t.status} today={today} showIcon={false} /> : <span className="muted">–</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
