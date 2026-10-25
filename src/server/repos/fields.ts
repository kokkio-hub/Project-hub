import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';
import { nowIso } from '../db/index.js';
import { isIsoDate } from '../../shared/dates.js';
import type { CustomField, FieldOption, FieldType } from '../../shared/types.js';

export interface FieldRow {
  id: number;
  project_id: number;
  name: string;
  type: FieldType;
  options: string;
  show_on_card: 0 | 1;
  position: number;
  created_at: string;
}

function parseOptions(json: string): FieldOption[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as FieldOption[]) : [];
  } catch {
    return [];
  }
}

export function toField(row: FieldRow): CustomField {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    options: parseOptions(row.options),
    showOnCard: row.show_on_card === 1,
    position: row.position,
  };
}

export function fieldsByProject(db: DB, projectIds: number[]): Map<number, CustomField[]> {
  const map = new Map<number, CustomField[]>();
  if (projectIds.length === 0) return map;
  const rows = db
    .prepare('SELECT * FROM custom_fields WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY position, id')
    .all(JSON.stringify(projectIds)) as FieldRow[];
  for (const row of rows) {
    const list = map.get(row.project_id) ?? [];
    list.push(toField(row));
    map.set(row.project_id, list);
  }
  return map;
}

export function listFieldRows(db: DB, projectId: number): FieldRow[] {
  return db.prepare('SELECT * FROM custom_fields WHERE project_id = ? ORDER BY position, id').all(projectId) as FieldRow[];
}

export function getFieldRow(db: DB, id: number): FieldRow | undefined {
  return db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id) as FieldRow | undefined;
}

/** A new stable id for a dropdown choice. */
export function newOptionId(): string {
  return randomBytes(6).toString('base64url');
}

export interface FieldInput {
  name: string;
  type: FieldType;
  options: FieldOption[];
  showOnCard: boolean;
}

export function insertField(db: DB, projectId: number, input: FieldInput, position?: number): FieldRow {
  const pos =
    position ??
    (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM custom_fields WHERE project_id = ?').get(projectId) as { pos: number }).pos;
  const result = db
    .prepare('INSERT INTO custom_fields (project_id, name, type, options, show_on_card, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, input.name.trim(), input.type, JSON.stringify(input.type === 'select' ? input.options : []), input.showOnCard ? 1 : 0, pos, nowIso());
  return getFieldRow(db, Number(result.lastInsertRowid))!;
}

export function updateField(db: DB, id: number, patch: Partial<Omit<FieldInput, 'type'>>): FieldRow {
  const current = getFieldRow(db, id)!;
  const options = patch.options !== undefined && current.type === 'select' ? patch.options : parseOptions(current.options);
  db.prepare('UPDATE custom_fields SET name = ?, options = ?, show_on_card = ? WHERE id = ?').run(
    patch.name?.trim() ?? current.name,
    JSON.stringify(options),
    patch.showOnCard === undefined ? current.show_on_card : patch.showOnCard ? 1 : 0,
    id,
  );
  // Values that pointed at a removed choice are cleared.
  if (current.type === 'select' && patch.options !== undefined) {
    db.prepare('DELETE FROM task_field_values WHERE field_id = @id AND value NOT IN (SELECT value FROM json_each(@ids))').run({
      id,
      ids: JSON.stringify(options.map((o) => o.id)),
    });
  }
  return getFieldRow(db, id)!;
}

export function deleteField(db: DB, id: number): void {
  db.prepare('DELETE FROM custom_fields WHERE id = ?').run(id);
}

export function reorderFields(db: DB, projectId: number, ids: number[]): void {
  const set = db.prepare('UPDATE custom_fields SET position = ? WHERE id = ? AND project_id = ?');
  db.transaction(() => ids.forEach((id, i) => set.run(i, id, projectId)))();
}

/**
 * Checks a value against its field and returns what to store, or null to clear
 * it. Throws a message (English; translated on the way out) when it doesn't fit.
 */
export function normalizeFieldValue(field: Pick<CustomField, 'type' | 'options'>, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (field.type) {
    case 'text': {
      const text = String(value).trim();
      if (text.length > 500) throw new FieldValueError('Use at most 500 characters');
      return text || null;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new FieldValueError('Enter a number');
      return String(n);
    }
    case 'date': {
      const date = String(value);
      if (!isIsoDate(date)) throw new FieldValueError('Use the format YYYY-MM-DD');
      return date;
    }
    case 'select': {
      const id = String(value);
      if (!field.options.some((o) => o.id === id)) throw new FieldValueError('Choose one of the options');
      return id;
    }
    case 'checkbox':
      return value === true || value === 'true' ? 'true' : null;
  }
}

export class FieldValueError extends Error {}

/** Sets (or clears, with null) values on a task. Field ids must belong to the task's project. */
export function setFieldValues(db: DB, taskId: number, values: Map<number, string | null>): void {
  const put = db.prepare(
    'INSERT INTO task_field_values (task_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT (task_id, field_id) DO UPDATE SET value = excluded.value',
  );
  const clear = db.prepare('DELETE FROM task_field_values WHERE task_id = ? AND field_id = ?');
  for (const [fieldId, value] of values) {
    if (value === null) clear.run(taskId, fieldId);
    else put.run(taskId, fieldId, value);
  }
}

/** Removes values of fields that don't belong to the task's (new) project. */
export function dropForeignFieldValues(db: DB, taskId: number, projectId: number): void {
  db.prepare('DELETE FROM task_field_values WHERE task_id = ? AND field_id NOT IN (SELECT id FROM custom_fields WHERE project_id = ?)').run(
    taskId,
    projectId,
  );
}

export function copyFieldValues(db: DB, fromTaskId: number, toTaskId: number, fieldMap?: Map<number, number>): void {
  const rows = db.prepare('SELECT field_id, value FROM task_field_values WHERE task_id = ?').all(fromTaskId) as { field_id: number; value: string }[];
  const put = db.prepare('INSERT OR REPLACE INTO task_field_values (task_id, field_id, value) VALUES (?, ?, ?)');
  for (const row of rows) {
    const fieldId = fieldMap ? fieldMap.get(row.field_id) : row.field_id;
    if (fieldId !== undefined) put.run(toTaskId, fieldId, row.value);
  }
}
