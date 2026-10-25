import type { ReactNode } from 'react';
import { TASK_STATUS_LABELS, PROJECT_STATUS_LABELS, type ActivityItem, type ProjectStatus, type TaskStatus, type User } from '../../../shared/types';
import { N_, t, tx } from '../../i18n';

const FIELD_LABELS: Record<string, string> = {
  title: N_('title'),
  description: N_('description'),
  priority: N_('priority'),
  startDate: N_('start date'),
  dueDate: N_('due date'),
  projectId: N_('project'),
  name: N_('name'),
  color: N_('colour'),
  status: N_('status'),
  ownerId: N_('owner'),
  visibility: N_('visibility'),
  labelIds: N_('labels'),
  recurrence: N_('repeat'),
  parentId: N_('parent task'),
  milestoneId: N_('milestone'),
  fields: N_('fields'),
};

/** "a, b and c" in the interface language. */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return t('{list} and {last}', { list: words.slice(0, -1).join(', '), last: words[words.length - 1] });
}

function fieldNames(fields: string[] | undefined): string {
  return joinWords((fields ?? []).map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : f)));
}

/**
 * One human sentence per activity entry, e.g. "Liam moved Homepage wireframes to Done".
 * In `task` context the task itself is implied ("moved this task to Done").
 */
export function describeActivity(
  item: ActivityItem,
  usersById: Map<number, User>,
  context: 'global' | 'task' = 'global',
): ReactNode {
  const actor = item.userId ? (usersById.get(item.userId)?.name ?? t('Someone')) : t('Someone');
  const who = <strong>{actor}</strong>;
  const task = context === 'task' ? t('this task') : <strong>{item.data.taskTitle ?? t('a task')}</strong>;
  const project = <strong>{item.data.projectName ?? t('a project')}</strong>;

  switch (item.type) {
    case 'project.created':
      return tx('{who} created the project {project}', { who, project });
    case 'project.deleted':
      return tx('{who} deleted the project {project}', { who, project });
    case 'project.restored':
      return tx('{who} restored the project {project}', { who, project });
    case 'project.updated': {
      const to = item.data.to as ProjectStatus | undefined;
      if (to && PROJECT_STATUS_LABELS[to]) {
        return tx('{who} set {project} to {status}', { who, project, status: t(PROJECT_STATUS_LABELS[to]).toLowerCase() });
      }
      const fields = fieldNames(item.data.fields);
      return fields
        ? tx('{who} updated the {fields} of {project}', { who, fields, project })
        : tx('{who} updated the settings of {project}', { who, project });
    }
    case 'task.created':
      return tx('{who} created {task}', { who, task });
    case 'task.deleted':
      return tx('{who} deleted {task}', { who, task });
    case 'task.restored':
      return tx('{who} restored {task}', { who, task });
    case 'task.attachment':
      return tx('{who} attached {file} to {task}', { who, file: <strong>{item.data.filename ?? t('a file')}</strong>, task });
    case 'task.status': {
      const to = item.data.to as TaskStatus | undefined;
      if (to === 'done') return tx('{who} completed {task}', { who, task });
      if (item.data.from === to) return tx('{who} moved {task} to another column', { who, task });
      if (item.data.from === 'done') return tx('{who} reopened {task}', { who, task });
      return to
        ? tx('{who} moved {task} to {status}', { who, task, status: t(TASK_STATUS_LABELS[to]) })
        : tx('{who} moved {task} to another column', { who, task });
    }
    case 'task.assigned': {
      const assigneeId = item.data.assigneeId ?? null;
      if (assigneeId === null) return tx('{who} unassigned {task}', { who, task });
      if (assigneeId === item.userId) return tx('{who} took {task}', { who, task });
      const assignee = <strong>{usersById.get(assigneeId)?.name ?? t('someone')}</strong>;
      return tx('{who} assigned {task} to {assignee}', { who, task, assignee });
    }
    case 'task.updated': {
      const fields = fieldNames(item.data.fields);
      return fields
        ? tx('{who} changed the {fields} of {task}', { who, fields, task })
        : tx('{who} changed the details of {task}', { who, task });
    }
    case 'comment.created':
      return context === 'task' ? tx('{who} commented', { who }) : tx('{who} commented on {task}', { who, task });
    default:
      return tx('{who} made a change', { who });
  }
}
