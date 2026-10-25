import type { ReactNode } from 'react';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type GroupBy, type Project, type Task, type User } from '../../../shared/types';
import type { TaskInput, TaskPatch } from '../../api/queries';
import { Avatar } from '../../components/Avatar';
import { PriorityIcon } from '../../components/Icons';
import { t } from '../../i18n';

/**
 * Swimlanes: the board split into rows by person, priority, label or a
 * dropdown field. Dragging a card into another row changes that value.
 */

export interface Lane {
  key: string;
  /** Plain text, for screen readers and titles. */
  name: string;
  icon?: ReactNode;
  /** What a task created in this row starts with. */
  defaults: Partial<TaskInput>;
}

export const ALL_LANE = 'all';

/** The dropdown field a "field:<id>" grouping points at (if it still exists). */
export function groupField(groupBy: GroupBy, project: Project) {
  if (!groupBy.startsWith('field:')) return undefined;
  const id = Number(groupBy.slice(6));
  return project.fields.find((f) => f.id === id && f.type === 'select');
}

/** A grouping that still makes sense for this project ('none' if its field is gone). */
export function validGroupBy(groupBy: GroupBy | undefined, project: Project): GroupBy {
  if (!groupBy) return 'none';
  if (groupBy.startsWith('field:') && !groupField(groupBy, project)) return 'none';
  if (groupBy === 'label' && project.labels.length === 0) return 'none';
  return groupBy;
}

/** The row a task belongs in. A task with several labels goes in the row of its first one. */
export function laneOf(task: Task, groupBy: GroupBy, project: Project): string {
  switch (groupBy) {
    case 'none':
      return ALL_LANE;
    case 'assignee':
      return task.assigneeId === null ? 'none' : String(task.assigneeId);
    case 'priority':
      return task.priority;
    case 'label': {
      const first = project.labels.find((l) => task.labelIds.includes(l.id));
      return first ? String(first.id) : 'none';
    }
    default: {
      const field = groupField(groupBy, project);
      const value = field ? task.fieldValues[field.id] : undefined;
      return value && field?.options.some((o) => o.id === value) ? value : 'none';
    }
  }
}

export function buildLanes(input: {
  groupBy: GroupBy;
  project: Project;
  tasks: Task[];
  usersById: Map<number, User>;
  /** People tasks here can be given to (lanes are shown for them when they have tasks, and for me). */
  meId: number;
  canAssignMe: boolean;
}): Lane[] {
  const { groupBy, project, tasks, usersById, meId, canAssignMe } = input;
  switch (groupBy) {
    case 'none':
      return [{ key: ALL_LANE, name: '', defaults: {} }];
    case 'assignee': {
      const ids = new Set(tasks.map((x) => x.assigneeId).filter((id): id is number => id !== null));
      if (canAssignMe) ids.add(meId);
      const people = [...ids]
        .map((id) => usersById.get(id))
        .filter((u): u is User => u !== undefined)
        .sort((a, b) => Number(b.id === meId) - Number(a.id === meId) || a.name.localeCompare(b.name));
      return [
        ...people.map((u) => ({
          key: String(u.id),
          name: u.id === meId ? t('{name} (you)', { name: u.name }) : u.name,
          icon: <Avatar user={u} size="xs" title={null} />,
          defaults: { assigneeId: u.id },
        })),
        { key: 'none', name: t('Unassigned'), icon: <Avatar user={null} size="xs" title={null} />, defaults: { assigneeId: null } },
      ];
    }
    case 'priority':
      return [...TASK_PRIORITIES].reverse().map((p) => ({
        key: p,
        name: t(TASK_PRIORITY_LABELS[p]),
        icon: <PriorityIcon priority={p} />,
        defaults: { priority: p },
      }));
    case 'label':
      return [
        ...project.labels.map((l) => ({
          key: String(l.id),
          name: l.name,
          icon: <span className="label-dot" style={{ background: `var(--cat-${l.color})` }} aria-hidden />,
          defaults: { labelIds: [l.id] },
        })),
        { key: 'none', name: t('No label'), defaults: {} },
      ];
    default: {
      const field = groupField(groupBy, project);
      if (!field) return [{ key: ALL_LANE, name: '', defaults: {} }];
      return [
        ...field.options.map((o) => ({
          key: o.id,
          name: o.name,
          icon: <span className="label-dot" style={{ background: `var(--cat-${o.color})` }} aria-hidden />,
          defaults: { fields: { [field.id]: o.id } },
        })),
        { key: 'none', name: t('No {field}', { field: field.name }), defaults: {} },
      ];
    }
  }
}

/** What changes when a card moves from one row to another (null: nothing). */
export function lanePatch(groupBy: GroupBy, project: Project, task: Task, from: string, to: string): TaskPatch | null {
  if (from === to) return null;
  switch (groupBy) {
    case 'none':
      return null;
    case 'assignee':
      return { assigneeId: to === 'none' ? null : Number(to) };
    case 'priority':
      return { priority: to as Task['priority'] };
    case 'label': {
      const ids = task.labelIds.filter((id) => String(id) !== from);
      if (to !== 'none' && !ids.includes(Number(to))) ids.unshift(Number(to));
      // Into "No label": the task keeps no labels that would put it in another row.
      return { labelIds: to === 'none' ? [] : ids };
    }
    default: {
      const field = groupField(groupBy, project);
      return field ? { fields: { [field.id]: to === 'none' ? null : to } } : null;
    }
  }
}

/** The options for the "Group by" menu. */
export function groupOptions(project: Project): { value: GroupBy; label: string }[] {
  return [
    { value: 'none', label: t('No grouping') },
    { value: 'assignee', label: t('Group by person') },
    { value: 'priority', label: t('Group by priority') },
    ...(project.labels.length > 0 ? [{ value: 'label' as const, label: t('Group by label') }] : []),
    ...project.fields.filter((f) => f.type === 'select').map((f) => ({ value: `field:${f.id}` as GroupBy, label: t('Group by {name}', { name: f.name }) })),
  ];
}
