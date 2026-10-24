import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type Project, type Task } from '../../shared/types.js';
import type { Translator } from '../../shared/i18n/core.js';

/**
 * CSV that opens cleanly in Excel, Numbers and Google Sheets: UTF-8 with a
 * byte-order mark, CRLF line endings, and every field quoted when needed.
 * Cells that a spreadsheet would run as a formula are prefixed with an
 * apostrophe, so an exported task title can never execute anything.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Tasks as a spreadsheet, with headers and labels in the viewer's language. */
export function tasksCsv(input: {
  tasks: Task[];
  projects: Map<number, Project>;
  userNames: Map<number, string>;
  /** Adds a Project column (for exports that span projects). */
  includeProject: boolean;
  tr: Translator;
}): string {
  const { tasks, projects, userNames, includeProject, tr } = input;
  const header = [
    tr.t('ID'),
    ...(includeProject ? [tr.t('Project')] : []),
    tr.t('Title'),
    tr.t('Column'),
    tr.t('Stage'),
    tr.t('Priority'),
    tr.t('Assignee'),
    tr.t('Labels'),
    tr.t('Start date'),
    tr.t('Due date'),
    tr.t('Completed'),
    tr.t('Created'),
    tr.t('Checklist'),
    tr.t('Description'),
  ];
  const rows = tasks.map((t) => {
    const p = projects.get(t.projectId);
    const stage = tr.t(TASK_STATUS_LABELS[t.status]);
    return [
      t.id,
      ...(includeProject ? [p?.name ?? ''] : []),
      t.title,
      p?.columns.find((c) => c.id === t.columnId)?.name ?? stage,
      stage,
      tr.t(TASK_PRIORITY_LABELS[t.priority]),
      t.assigneeId ? (userNames.get(t.assigneeId) ?? '') : '',
      t.labelIds
        .map((id) => p?.labels.find((l) => l.id === id)?.name)
        .filter(Boolean)
        .join(', '),
      t.startDate,
      t.dueDate,
      t.completedAt?.slice(0, 10),
      t.createdAt.slice(0, 10),
      t.checklistTotal > 0 ? `${t.checklistDone}/${t.checklistTotal}` : '',
      t.description,
    ];
  });
  return toCsv(header, rows);
}
