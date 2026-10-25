import { Fragment, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CornerLeftUp } from 'lucide-react';
import { localToday } from '../../../shared/dates';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type BoardColumn,
  type CustomField,
  type Label,
  type Milestone,
  type Project,
  type Task,
  type User,
} from '../../../shared/types';
import { Person } from '../../components/Avatar';
import { DueChip } from '../../components/Bits';
import { PriorityLabel, ProjectDot, StatusIcon } from '../../components/Icons';
import { formatDate } from '../../lib/format';
import { LabelList } from '../labels/Labels';
import { FieldChip, fieldSortKey } from '../planning/Fields';
import { t } from '../../i18n';

type SortKey = 'title' | 'status' | 'priority' | 'assignee' | 'startDate' | 'dueDate' | 'project' | 'milestone' | `field:${number}`;

interface Props {
  tasks: Task[];
  usersById: Map<number, User>;
  projectsById?: Map<number, Project>;
  /** The project's columns and labels, when all tasks come from one project. */
  columns?: BoardColumn[];
  labels?: Label[];
  /** The project's milestones and custom fields, shown as columns. */
  milestones?: Milestone[];
  fields?: CustomField[];
  /** Titles of main tasks, shown under subtasks. */
  parentTitles?: Map<number, string>;
  onOpenTask: (id: number) => void;
}

/** Sortable table of tasks: the list view, and the accessible table twin of the board and timeline. */
export function TaskTable({ tasks, usersById, projectsById, columns, labels, milestones = [], fields = [], parentTitles, onOpenTask }: Props) {
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));
  const columnOf = (task: Task) => (columns ?? projectsById?.get(task.projectId)?.columns ?? []).find((c) => c.id === task.columnId);
  const labelsOf = (task: Task) => labels ?? projectsById?.get(task.projectId)?.labels ?? [];
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dueDate', dir: 1 });
  const today = localToday();

  const sorted = useMemo(() => {
    const name = (id: number | null) => (id ? (usersById.get(id)?.name ?? '') : '￿');
    const value = (task: Task): string | number => {
      switch (sort.key) {
        case 'title':
          return task.title.toLowerCase();
        case 'status':
          return TASK_STATUSES.indexOf(task.status) * 1000 + (columnOf(task)?.position ?? 0);
        case 'priority':
          return -TASK_PRIORITIES.indexOf(task.priority);
        case 'assignee':
          return name(task.assigneeId).toLowerCase();
        case 'startDate':
          return task.startDate ?? '￿';
        case 'dueDate':
          return task.dueDate ?? '￿';
        case 'project':
          return (projectsById?.get(task.projectId)?.name ?? '').toLowerCase();
        case 'milestone':
          return task.milestoneId !== null ? (milestoneById.get(task.milestoneId)?.date ?? '￿') : '￿';
        default: {
          const field = fields.find((f) => `field:${f.id}` === sort.key);
          return field ? fieldSortKey(field, task.fieldValues[field.id]) : 0;
        }
      }
    };
    return [...tasks].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return -sort.dir;
      if (va > vb) return sort.dir;
      return a.id - b.id;
    });
  }, [tasks, sort, usersById, projectsById, fields, milestones]);

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
            {header('title', t('Task'))}
            {projectsById && header('project', t('Project'))}
            {header('status', t('Column'))}
            {header('priority', t('Priority'))}
            {header('assignee', t('Assignee'))}
            {header('startDate', t('Start'))}
            {header('dueDate', t('Due'))}
            {milestones.length > 0 && header('milestone', t('Milestone'))}
            {fields.map((f) => (
              <Fragment key={f.id}>{header(`field:${f.id}`, f.name)}</Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => {
            const project = projectsById?.get(task.projectId);
            return (
              <tr
                key={task.id}
                className="clickable"
                onClick={() => onOpenTask(task.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpenTask(task.id);
                }}
                tabIndex={0}
              >
                <td style={{ maxWidth: 420 }}>
                  {task.parentId !== null && parentTitles?.get(task.parentId) && (
                    <span className="table-parent truncate">
                      <CornerLeftUp size={12} aria-hidden /> {parentTitles.get(task.parentId)}
                    </span>
                  )}
                  <span className={`truncate ${task.status === 'done' ? 'secondary' : ''}`} style={{ display: 'block', fontWeight: 520 }}>
                    {task.title}
                    {task.subtaskTotal > 0 && (
                      <span className="muted num table-subtasks" title={t('{done} of {total} subtasks done', { done: task.subtaskDone, total: task.subtaskTotal })}>
                        {' '}
                        {task.subtaskDone}/{task.subtaskTotal}
                      </span>
                    )}
                  </span>
                  {task.labelIds.length > 0 && <LabelList ids={task.labelIds} labels={labelsOf(task)} />}
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
                  <span className="status-label">
                    <StatusIcon status={task.status} />
                    {columnOf(task)?.name ?? t(TASK_STATUS_LABELS[task.status])}
                  </span>
                </td>
                <td>
                  <PriorityLabel priority={task.priority} />
                </td>
                <td>
                  <Person user={task.assigneeId ? usersById.get(task.assigneeId) : null} muted={!task.assigneeId} />
                </td>
                <td className="date secondary">{formatDate(task.startDate, today) || '–'}</td>
                <td className="date">
                  {task.dueDate ? <DueChip dueDate={task.dueDate} status={task.status} today={today} showIcon={false} /> : <span className="muted">–</span>}
                </td>
                {milestones.length > 0 && (
                  <td className="secondary">
                    {task.milestoneId !== null ? (milestoneById.get(task.milestoneId)?.name ?? '–') : <span className="muted">–</span>}
                  </td>
                )}
                {fields.map((f) => (
                  <td key={f.id}>{task.fieldValues[f.id] !== undefined ? <FieldChip field={f} value={task.fieldValues[f.id]} compact /> : <span className="muted">–</span>}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
