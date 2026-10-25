import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ProjectView, SavedView, ViewSettings } from '../../shared/types.js';
import { viewerParams, VISIBLE_PROJECT_IDS, type Viewer } from '../services/permissions.js';

export interface ViewRow {
  id: number;
  user_id: number;
  project_id: number;
  name: string;
  view: ProjectView;
  settings: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function parseSettings(json: string): ViewSettings {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ViewSettings) : {};
  } catch {
    return {};
  }
}

export function toView(row: ViewRow): SavedView {
  return { id: row.id, projectId: row.project_id, name: row.name, view: row.view, settings: parseSettings(row.settings), position: row.position };
}

/** Someone's saved views, for projects they can still see (and that aren't in the trash). */
export function listViews(db: DB, viewer: Viewer): SavedView[] {
  const rows = db
    .prepare(
      `SELECT v.* FROM saved_views v
        WHERE v.user_id = @viewerId AND v.project_id IN (${VISIBLE_PROJECT_IDS})
        ORDER BY v.position, v.id`,
    )
    .all(viewerParams(viewer)) as ViewRow[];
  return rows.map(toView);
}

export function getViewRow(db: DB, id: number): ViewRow | undefined {
  return db.prepare('SELECT * FROM saved_views WHERE id = ?').get(id) as ViewRow | undefined;
}

export function countViews(db: DB, userId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM saved_views WHERE user_id = ?').get(userId) as { n: number }).n;
}

export function insertView(db: DB, input: { userId: number; projectId: number; name: string; view: ProjectView; settings: ViewSettings }): ViewRow {
  const now = nowIso();
  const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM saved_views WHERE user_id = ?').get(input.userId) as { pos: number }).pos;
  const result = db
    .prepare('INSERT INTO saved_views (user_id, project_id, name, view, settings, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(input.userId, input.projectId, input.name.trim(), input.view, JSON.stringify(input.settings), pos, now, now);
  return getViewRow(db, Number(result.lastInsertRowid))!;
}

export function updateView(db: DB, id: number, patch: { name?: string; view?: ProjectView; settings?: ViewSettings }): ViewRow {
  const current = getViewRow(db, id)!;
  db.prepare('UPDATE saved_views SET name = ?, view = ?, settings = ?, updated_at = ? WHERE id = ?').run(
    patch.name?.trim() ?? current.name,
    patch.view ?? current.view,
    patch.settings ? JSON.stringify(patch.settings) : current.settings,
    nowIso(),
    id,
  );
  return getViewRow(db, id)!;
}

export function deleteView(db: DB, id: number): void {
  db.prepare('DELETE FROM saved_views WHERE id = ?').run(id);
}

export function reorderViews(db: DB, userId: number, ids: number[]): void {
  const set = db.prepare('UPDATE saved_views SET position = ? WHERE id = ? AND user_id = ?');
  db.transaction(() => ids.forEach((id, i) => set.run(i, id, userId)))();
}
