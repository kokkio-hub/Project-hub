import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { TRASH_DAYS, type ColorName, type TrashItem } from '../../shared/types.js';
import { storedNamesForTasks } from '../repos/attachments.js';
import { deleteProject, getProjectRow } from '../repos/projects.js';
import { deleteTask } from '../repos/tasks.js';
import { canManageProject, projectAccessSql, viewerParams, type Viewer } from './permissions.js';
import { removeAttachmentFiles } from './storage.js';

const DAY_MS = 86_400_000;

function purgeAt(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + TRASH_DAYS * DAY_MS).toISOString();
}

/**
 * What a viewer finds in the trash: deleted projects they can see, and deleted
 * tasks in projects they can see (a task in a deleted project comes back with
 * its project).
 */
export function listTrash(db: DB, viewer: Viewer): TrashItem[] {
  const params = viewerParams(viewer);
  const projects = db
    .prepare(
      `SELECT p.id, p.name, p.color, p.owner_id, p.deleted_at, p.deleted_by FROM projects p
        WHERE p.deleted_at IS NOT NULL AND ${projectAccessSql('p')}
        ORDER BY p.deleted_at DESC`,
    )
    .all(params) as { id: number; name: string; color: ColorName; owner_id: number | null; deleted_at: string; deleted_by: number | null }[];
  const tasks = db
    .prepare(
      `SELECT t.id, t.title, t.created_by, t.deleted_at, t.deleted_by, p.id AS project_id, p.name AS project_name,
              p.color AS project_color, p.owner_id, p.status AS project_status
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.deleted_at IS NOT NULL AND p.deleted_at IS NULL AND ${projectAccessSql('p')}
          -- Subtasks deleted together with their task come back with it.
          AND NOT EXISTS (SELECT 1 FROM tasks pt WHERE pt.id = t.parent_id AND pt.deleted_at = t.deleted_at)
        ORDER BY t.deleted_at DESC`,
    )
    .all(params) as {
    id: number;
    title: string;
    created_by: number | null;
    deleted_at: string;
    deleted_by: number | null;
    project_id: number;
    project_name: string;
    project_color: ColorName;
    owner_id: number | null;
    project_status: string;
  }[];

  const items: TrashItem[] = [
    ...projects.map((p) => ({
      kind: 'project' as const,
      id: p.id,
      title: p.name,
      projectId: p.id,
      projectName: p.name,
      projectColor: p.color,
      deletedAt: p.deleted_at,
      deletedBy: p.deleted_by,
      purgeAt: purgeAt(p.deleted_at),
      canRestore: canManageProject(viewer, p),
    })),
    ...tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      title: t.title,
      projectId: t.project_id,
      projectName: t.project_name,
      projectColor: t.project_color,
      deletedAt: t.deleted_at,
      deletedBy: t.deleted_by,
      purgeAt: purgeAt(t.deleted_at),
      canRestore:
        t.project_status !== 'archived' && (canManageProject(viewer, t) || (viewer.role !== 'guest' && t.created_by === viewer.id) || t.deleted_by === viewer.id),
    })),
  ];
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Removes a task from the trash for good, with its subtasks and attached files. */
export function destroyTask(ctx: AppContext, taskId: number): void {
  const children = (ctx.db.prepare('SELECT id FROM tasks WHERE parent_id = ?').all(taskId) as { id: number }[]).map((r) => r.id);
  const files = storedNamesForTasks(ctx.db, [taskId, ...children]);
  deleteTask(ctx.db, taskId);
  removeAttachmentFiles(ctx.config.attachmentsDir, files);
}

/** Removes a project for good, with all its tasks, files and history. */
export function destroyProject(ctx: AppContext, projectId: number): void {
  const { db } = ctx;
  const taskIds = (db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(projectId) as { id: number }[]).map((r) => r.id);
  const files = storedNamesForTasks(db, taskIds);
  db.transaction(() => {
    // Its history goes too: without the project it would show to everyone, even if the project was private.
    db.prepare('DELETE FROM activity WHERE project_id = ?').run(projectId);
    deleteProject(db, projectId);
  })();
  removeAttachmentFiles(ctx.config.attachmentsDir, files);
}

/** Empties everything that has been in the trash longer than TRASH_DAYS. */
export function purgeExpiredTrash(ctx: AppContext, now = new Date()): { tasks: number; projects: number } {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * DAY_MS).toISOString();
  const { db } = ctx;
  const projects = (db.prepare('SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: number }[]).map(
    (r) => r.id,
  );
  for (const id of projects) destroyProject(ctx, id);
  const tasks = (db.prepare('SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as { id: number }[]).map(
    (r) => r.id,
  );
  const files = storedNamesForTasks(db, tasks);
  db.transaction(() => {
    for (const id of tasks) deleteTask(db, id);
  })();
  removeAttachmentFiles(ctx.config.attachmentsDir, files);
  return { tasks: tasks.length, projects: projects.length };
}

export function projectInTrash(db: DB, projectId: number): boolean {
  return getProjectRow(db, projectId)?.deleted_at != null;
}
