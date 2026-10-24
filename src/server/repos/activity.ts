import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import type { ActivityItem, ActivityType } from '../../shared/types.js';
import { projectAccessSql, viewerParams, type Viewer } from '../services/permissions.js';

interface ActivityRow {
  id: number;
  type: ActivityType;
  user_id: number | null;
  project_id: number | null;
  task_id: number | null;
  data: string;
  created_at: string;
}

function toActivity(row: ActivityRow): ActivityItem {
  let data: ActivityItem['data'] = {};
  try {
    data = JSON.parse(row.data) as ActivityItem['data'];
  } catch {
    // Keep an empty payload for malformed rows rather than failing the whole feed.
  }
  return {
    id: row.id,
    type: row.type,
    userId: row.user_id,
    projectId: row.project_id,
    taskId: row.task_id,
    data,
    createdAt: row.created_at,
  };
}

export interface NewActivity {
  type: ActivityType;
  userId: number | null;
  projectId: number | null;
  taskId?: number | null;
  data?: ActivityItem['data'];
}

/** Edits by the same person to the same task within this window collapse into one entry. */
const COALESCE_WINDOW_MS = 10 * 60 * 1000;

export function logActivity(db: DB, entry: NewActivity, createdAt: string = nowIso()): void {
  const data = entry.data ?? {};

  if (entry.type === 'task.updated' && entry.taskId) {
    const previous = db
      .prepare('SELECT * FROM activity WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(entry.taskId) as ActivityRow | undefined;
    if (
      previous &&
      previous.type === 'task.updated' &&
      previous.user_id === entry.userId &&
      Date.parse(createdAt) - Date.parse(previous.created_at) < COALESCE_WINDOW_MS
    ) {
      const prevData = toActivity(previous).data;
      const fields = Array.from(new Set([...(prevData.fields ?? []), ...(data.fields ?? [])]));
      db.prepare('UPDATE activity SET data = ?, created_at = ? WHERE id = ?').run(
        JSON.stringify({ ...prevData, ...data, fields }),
        createdAt,
        previous.id,
      );
      return;
    }
  }

  db.prepare(
    'INSERT INTO activity (type, user_id, project_id, task_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(entry.type, entry.userId, entry.projectId, entry.taskId ?? null, JSON.stringify(data), createdAt);
}

/**
 * Recent activity the viewer may see. With `excludeArchived` (the team-wide
 * feed), entries about archived projects and templates are left out too.
 */
export function listActivity(
  db: DB,
  viewer: Viewer,
  options: { projectId?: number; taskId?: number; limit?: number; excludeArchived?: boolean } = {},
): ActivityItem[] {
  const where: string[] = [
    `(a.project_id IS NULL OR a.project_id IN (SELECT ap.id FROM projects ap WHERE ${projectAccessSql('ap')}))`,
  ];
  const params: Record<string, unknown> = {
    ...viewerParams(viewer),
    limit: Math.min(Math.max(options.limit ?? 30, 1), 200),
  };
  if (options.projectId !== undefined) {
    where.push('a.project_id = @projectId');
    params.projectId = options.projectId;
  }
  if (options.taskId !== undefined) {
    where.push('a.task_id = @taskId');
    params.taskId = options.taskId;
  }
  if (options.excludeArchived) {
    where.push(
      "(a.project_id IS NULL OR a.project_id NOT IN (SELECT id FROM projects WHERE status = 'archived' OR is_template = 1))",
    );
  }
  const rows = db
    .prepare(
      `SELECT a.* FROM activity a WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC LIMIT @limit`,
    )
    .all(params) as ActivityRow[];
  return rows.map(toActivity);
}
