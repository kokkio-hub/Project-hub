import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { TaskDependencies } from '../../shared/types.js';
import { viewerParams, visibleTaskSql, type Viewer } from '../services/permissions.js';
import { toTaskRef, type TaskRow } from './tasks.js';

/** How many blockers one task may have. */
export const MAX_BLOCKERS = 50;

export function hasDependency(db: DB, blockerId: number, blockedId: number): boolean {
  return !!db.prepare('SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
}

/**
 * True when `blockedId` already (directly or indirectly) blocks `blockerId`,
 * so adding "blockerId blocks blockedId" would make a loop.
 */
export function wouldCreateCycle(db: DB, blockerId: number, blockedId: number): boolean {
  if (blockerId === blockedId) return true;
  const row = db
    .prepare(
      `WITH RECURSIVE downstream(id) AS (
         SELECT blocked_id FROM task_dependencies WHERE blocker_id = @blockedId
         UNION
         SELECT d.blocked_id FROM task_dependencies d JOIN downstream ON d.blocker_id = downstream.id
       )
       SELECT 1 FROM downstream WHERE id = @blockerId LIMIT 1`,
    )
    .get({ blockerId, blockedId });
  return !!row;
}

export function countBlockers(db: DB, blockedId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM task_dependencies WHERE blocked_id = ?').get(blockedId) as { n: number }).n;
}

export function addDependency(db: DB, blockerId: number, blockedId: number, userId: number): void {
  db.prepare('INSERT OR IGNORE INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, ?, ?)').run(
    blockerId,
    blockedId,
    userId,
    nowIso(),
  );
}

export function removeDependency(db: DB, blockerId: number, blockedId: number): boolean {
  return db.prepare('DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId).changes > 0;
}

/** What blocks a task and what it blocks, limited to tasks the viewer can see. */
export function listDependencies(db: DB, viewer: Viewer, taskId: number): TaskDependencies {
  const params = { ...viewerParams(viewer), taskId };
  const blockedBy = db
    .prepare(
      `SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_id
        WHERE d.blocked_id = @taskId AND ${visibleTaskSql('t')}
        ORDER BY t.due_date IS NULL, t.due_date, t.id`,
    )
    .all(params) as TaskRow[];
  const blocking = db
    .prepare(
      `SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_id
        WHERE d.blocker_id = @taskId AND ${visibleTaskSql('t')}
        ORDER BY t.start_date IS NULL, t.start_date, t.id`,
    )
    .all(params) as TaskRow[];
  return { blockedBy: blockedBy.map(toTaskRef), blocking: blocking.map(toTaskRef) };
}

/** Tasks that were waiting on `blockerId` and now have no unfinished blockers left. */
export function newlyUnblocked(db: DB, blockerId: number): TaskRow[] {
  return db
    .prepare(
      `SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_id
        WHERE d.blocker_id = ? AND t.deleted_at IS NULL AND t.status != 'done'
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies d2 JOIN tasks b ON b.id = d2.blocker_id
             WHERE d2.blocked_id = t.id AND b.status != 'done' AND b.deleted_at IS NULL
          )`,
    )
    .all(blockerId) as TaskRow[];
}
