import type { AppContext } from '../context.js';
import { nextDates } from '../../shared/recurrence.js';
import type { Task } from '../../shared/types.js';
import { logActivity } from '../repos/activity.js';
import { listChecklist, insertChecklistItem } from '../repos/checklist.js';
import { columnForStage } from '../repos/columns.js';
import { newlyUnblocked } from '../repos/dependencies.js';
import { setTaskLabels } from '../repos/labels.js';
import type { ProjectRow } from '../repos/projects.js';
import { getTaskRow, insertTask, listSubtaskRows, recurrenceOf, toTask, type TaskRow } from '../repos/tasks.js';
import { copyFieldValues } from '../repos/fields.js';
import { addDays, diffDays } from '../../shared/dates.js';
import { getUserById } from '../repos/users.js';
import { notify } from './notify.js';

/**
 * What happens when a task is finished: a repeating task gets its next copy,
 * the person who created it hears about it, and tasks that were waiting on it
 * tell their assignees they can start. Runs inside the caller's transaction.
 * Returns the newly created repeat, if any, so the caller can announce it.
 */
export function afterStatusChange(
  ctx: AppContext,
  input: { before: TaskRow; after: Task; project: ProjectRow; actorId: number; today: string },
): Task | null {
  const { before, after, project, actorId } = input;
  if (before.status === 'done' || after.status !== 'done') return null;

  notify(ctx, { type: 'completed', recipients: [before.created_by], actorId, task: before, project });

  for (const waiting of newlyUnblocked(ctx.db, before.id)) {
    notify(ctx, { type: 'unblocked', recipients: [waiting.assignee_id], actorId, task: waiting });
  }

  return spawnNextOccurrence(ctx, before, project, actorId, input.today);
}

/** Creates the next copy of a repeating task (once per finished task). */
export function spawnNextOccurrence(ctx: AppContext, task: TaskRow, project: ProjectRow, actorId: number, today: string): Task | null {
  const { db } = ctx;
  const rule = recurrenceOf(task);
  const fresh = getTaskRow(db, task.id);
  if (!rule || !fresh || fresh.next_task_id !== null) return null;

  const dates = nextDates({ startDate: task.start_date, dueDate: task.due_date }, rule, today);
  const assignee = task.assignee_id ? getUserById(db, task.assignee_id) : undefined;
  const created = insertTask(
    db,
    {
      projectId: task.project_id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeId: assignee && assignee.is_active && assignee.role !== 'guest' ? assignee.id : null,
      startDate: dates.startDate,
      dueDate: dates.dueDate,
      createdBy: task.created_by ?? actorId,
      recurrence: rule,
      // A repeating subtask's next copy stays under the same task.
      parentId: task.parent_id,
    },
    columnForStage(db, task.project_id, 'todo'),
  );
  const labelIds = toTask(fresh).labelIds;
  if (labelIds.length > 0) setTaskLabels(db, created.id, labelIds);
  for (const item of listChecklist(db, task.id)) insertChecklistItem(db, created.id, item.body, actorId);
  copyFieldValues(db, task.id, created.id);
  // Its subtasks come along, open again, with their dates moved by as much as the task's.
  const anchorBefore = task.due_date ?? task.start_date;
  const anchorAfter = dates.dueDate ?? dates.startDate;
  const offset = anchorBefore && anchorAfter ? diffDays(anchorAfter, anchorBefore) : 0;
  const shift = (date: string | null) => (date && offset ? addDays(date, offset) : date);
  for (const child of listSubtaskRows(db, task.id)) {
    const childAssignee = child.assignee_id ? getUserById(db, child.assignee_id) : undefined;
    const copy = insertTask(
      db,
      {
        projectId: task.project_id,
        title: child.title,
        description: child.description,
        priority: child.priority,
        assigneeId: childAssignee && childAssignee.is_active && childAssignee.role !== 'guest' ? childAssignee.id : null,
        startDate: shift(child.start_date),
        dueDate: shift(child.due_date),
        createdBy: child.created_by ?? actorId,
        parentId: created.id,
      },
      columnForStage(db, task.project_id, 'todo'),
    );
    const childLabels = toTask(child).labelIds;
    if (childLabels.length > 0) setTaskLabels(db, copy.id, childLabels);
    copyFieldValues(db, child.id, copy.id);
  }
  db.prepare('UPDATE tasks SET next_task_id = ? WHERE id = ?').run(created.id, task.id);
  logActivity(db, {
    type: 'task.created',
    userId: actorId,
    projectId: project.id,
    taskId: created.id,
    data: { taskTitle: created.title, projectName: project.name },
  });
  return toTask(getTaskRow(db, created.id)!);
}
