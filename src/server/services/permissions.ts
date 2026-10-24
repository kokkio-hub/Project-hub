import type { DB } from '../db/index.js';
import type { UserRow } from '../repos/users.js';

/**
 * Who may see what.
 *
 * - Admins see every project.
 * - Members see every project shared with the team, plus private projects they
 *   own or were added to.
 * - Guests only see the projects they were added to. They can read and comment,
 *   but not change any work.
 *
 * Deleted projects (in the trash) are hidden from everyone outside the trash.
 */

export type Viewer = Pick<UserRow, 'id' | 'role'>;

export interface ViewerParams {
  viewerId: number;
  viewerAdmin: 0 | 1;
  viewerGuest: 0 | 1;
}

/** Named parameters used by the SQL fragments below. */
export function viewerParams(viewer: Viewer): ViewerParams {
  return {
    viewerId: viewer.id,
    viewerAdmin: viewer.role === 'admin' ? 1 : 0,
    viewerGuest: viewer.role === 'guest' ? 1 : 0,
  };
}

/** SQL condition: the viewer may see the project `alias` (ignores the trash). */
export function projectAccessSql(alias = 'p'): string {
  return `(@viewerAdmin = 1
           OR (${alias}.visibility = 'team' AND @viewerGuest = 0)
           OR ${alias}.owner_id = @viewerId
           OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ${alias}.id AND pm.user_id = @viewerId))`;
}

/** SQL condition: the project `alias` is not in the trash and the viewer may see it. */
export function visibleProjectSql(alias = 'p'): string {
  return `(${alias}.deleted_at IS NULL AND ${projectAccessSql(alias)})`;
}

/** Ids of the projects the viewer can see. */
export const VISIBLE_PROJECT_IDS = `SELECT vp.id FROM projects vp WHERE ${visibleProjectSql('vp')}`;

/** Ids of the projects whose tasks count as work for the viewer: visible, and not templates. */
export const WORK_PROJECT_IDS = `SELECT wp.id FROM projects wp WHERE wp.is_template = 0 AND ${visibleProjectSql('wp')}`;

/** SQL condition: task `alias` is not in the trash and belongs to a project the viewer can see. */
export function visibleTaskSql(alias = 't'): string {
  return `(${alias}.deleted_at IS NULL AND ${alias}.project_id IN (${VISIBLE_PROJECT_IDS}))`;
}

interface AccessRow {
  id: number;
  visibility: string;
  owner_id: number | null;
  deleted_at: string | null;
}

export function isMember(db: DB, projectId: number, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
}

/** True when `viewer` may see the project (in the trash or not). */
export function hasProjectAccess(db: DB, viewer: Viewer, project: AccessRow): boolean {
  if (viewer.role === 'admin') return true;
  if (project.owner_id === viewer.id) return true;
  if (project.visibility === 'team' && viewer.role !== 'guest') return true;
  return isMember(db, project.id, viewer.id);
}

/** True when `viewer` may see the project and it isn't in the trash. */
export function canSeeProject(db: DB, viewer: Viewer, project: AccessRow): boolean {
  return project.deleted_at === null && hasProjectAccess(db, viewer, project);
}

/** Guests can look and comment; everyone else can also change the work. */
export function canChangeWork(viewer: Viewer): boolean {
  return viewer.role !== 'guest';
}

/** Admins and the owner can change a project's settings, columns, members, or delete it. */
export function canManageProject(viewer: Viewer, project: Pick<AccessRow, 'owner_id'>): boolean {
  return viewer.role === 'admin' || (project.owner_id !== null && project.owner_id === viewer.id);
}
