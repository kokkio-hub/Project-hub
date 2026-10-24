import type { ReactNode } from 'react';
import { TASK_STATUS_LABELS, PROJECT_STATUS_LABELS, type ActivityItem, type ProjectStatus, type TaskStatus, type User } from '../../../shared/types';

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  startDate: 'start date',
  dueDate: 'due date',
  projectId: 'project',
  name: 'name',
  color: 'colour',
  status: 'status',
  ownerId: 'owner',
  visibility: 'visibility',
  labelIds: 'labels',
  recurrence: 'repeat',
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * One human sentence per activity entry, e.g. "Liam moved Homepage wireframes to Done".
 * In `task` context the task itself is implied ("moved this to Done").
 */
export function describeActivity(
  item: ActivityItem,
  usersById: Map<number, User>,
  context: 'global' | 'task' = 'global',
): ReactNode {
  const actor = item.userId ? (usersById.get(item.userId)?.name ?? 'Someone') : 'Someone';
  const who = <strong>{actor}</strong>;
  const task = context === 'task' ? 'this task' : <strong>{item.data.taskTitle ?? 'a task'}</strong>;
  const project = <strong>{item.data.projectName ?? 'a project'}</strong>;

  switch (item.type) {
    case 'project.created':
      return <>{who} created the project {project}</>;
    case 'project.deleted':
      return <>{who} deleted the project {project}</>;
    case 'project.restored':
      return <>{who} restored the project {project}</>;
    case 'project.updated': {
      const to = item.data.to as ProjectStatus | undefined;
      if (to && PROJECT_STATUS_LABELS[to]) {
        return (
          <>
            {who} set {project} to {PROJECT_STATUS_LABELS[to].toLowerCase()}
          </>
        );
      }
      const fields = (item.data.fields ?? []).map((f) => FIELD_LABELS[f] ?? f);
      return (
        <>
          {who} updated the {fields.length ? joinWords(fields) : 'settings'} of {project}
        </>
      );
    }
    case 'task.created':
      return <>{who} created {task}</>;
    case 'task.deleted':
      return <>{who} deleted {task}</>;
    case 'task.restored':
      return <>{who} restored {task}</>;
    case 'task.attachment':
      return (
        <>
          {who} attached <strong>{item.data.filename ?? 'a file'}</strong> to {task}
        </>
      );
    case 'task.status': {
      const to = item.data.to as TaskStatus | undefined;
      if (to === 'done') return <>{who} completed {task}</>;
      if (item.data.from === to) return <>{who} moved {task} to another column</>;
      if (item.data.from === 'done') {
        return (
          <>
            {who} reopened {task}
          </>
        );
      }
      return (
        <>
          {who} moved {task} to {to ? TASK_STATUS_LABELS[to] : 'another column'}
        </>
      );
    }
    case 'task.assigned': {
      const assigneeId = item.data.assigneeId ?? null;
      if (assigneeId === null) return <>{who} unassigned {task}</>;
      if (assigneeId === item.userId) return <>{who} took {task}</>;
      const assignee = usersById.get(assigneeId)?.name ?? 'someone';
      return (
        <>
          {who} assigned {task} to <strong>{assignee}</strong>
        </>
      );
    }
    case 'task.updated': {
      const fields = (item.data.fields ?? []).map((f) => FIELD_LABELS[f] ?? f);
      return (
        <>
          {who} changed the {fields.length ? joinWords(fields) : 'details'} of {task}
        </>
      );
    }
    case 'comment.created':
      return context === 'task' ? (
        <>{who} commented</>
      ) : (
        <>
          {who} commented on {task}
        </>
      );
    default:
      return <>{who} made a change</>;
  }
}
