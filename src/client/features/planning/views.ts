import type { GroupBy, ProjectView, SavedView, TaskPriority, ViewSettings } from '../../../shared/types';
import { DEFAULT_FILTERS, type TaskFilterState } from '../tasks/filters';
import type { CalendarMode } from '../calendar/CalendarView';

/** How a project is shown, besides its filters. */
export interface DisplayState {
  groupBy: GroupBy;
  showSubtasks: boolean;
  calendarMode: CalendarMode;
}

export const DEFAULT_DISPLAY: DisplayState = { groupBy: 'none', showSubtasks: false, calendarMode: 'month' };

/** Filters and display choices as saved-view settings (defaults left out). */
export function toSettings(f: TaskFilterState, d: DisplayState): ViewSettings {
  const s: ViewSettings = {};
  if (f.q.trim()) s.q = f.q.trim();
  if (f.assignee !== 'all') s.assignee = f.assignee;
  if (f.priority !== 'all') s.priority = f.priority;
  if (f.label !== 'all') s.label = f.label;
  if (f.milestone !== 'all') s.milestone = f.milestone;
  if (Object.keys(f.fields).length > 0) s.fields = Object.fromEntries(Object.entries(f.fields).sort(([a], [b]) => a.localeCompare(b)));
  if (f.hideDone) s.hideDone = true;
  if (d.groupBy !== 'none') s.groupBy = d.groupBy;
  if (d.showSubtasks) s.showSubtasks = true;
  if (d.calendarMode !== 'month') s.calendarMode = d.calendarMode;
  return s;
}

export function fromSettings(s: ViewSettings): { filters: TaskFilterState; display: DisplayState } {
  return {
    filters: {
      ...DEFAULT_FILTERS,
      q: s.q ?? '',
      assignee: s.assignee ?? 'all',
      priority: (s.priority as TaskPriority | undefined) ?? 'all',
      label: s.label ?? 'all',
      milestone: s.milestone ?? 'all',
      fields: { ...(s.fields ?? {}) },
      hideDone: s.hideDone ?? false,
    },
    display: {
      groupBy: s.groupBy ?? 'none',
      showSubtasks: s.showSubtasks ?? false,
      calendarMode: s.calendarMode ?? 'month',
    },
  };
}

/** Whether what's on screen differs from the saved view. */
export function viewChanged(view: SavedView, current: { view: ProjectView; settings: ViewSettings }): boolean {
  if (view.view !== current.view) return true;
  const saved = fromSettings(view.settings);
  return JSON.stringify(toSettings(saved.filters, saved.display)) !== JSON.stringify(current.settings);
}

/** The address of a project view, e.g. /projects/3/calendar. */
export function viewPath(projectId: number, view: ProjectView, savedId?: number): string {
  const base = `/projects/${projectId}${view === 'board' ? '' : `/${view}`}`;
  return savedId ? `${base}?saved=${savedId}` : base;
}

const displayKey = (projectId: number) => `ph.display.${projectId}`;

/** The last grouping and subtask choice for a project, remembered in this browser. */
export function readDisplay(projectId: number): DisplayState {
  try {
    const raw = JSON.parse(localStorage.getItem(displayKey(projectId)) ?? 'null') as Partial<DisplayState> | null;
    return { ...DEFAULT_DISPLAY, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function writeDisplay(projectId: number, display: DisplayState): void {
  try {
    localStorage.setItem(displayKey(projectId), JSON.stringify(display));
  } catch {
    // Storage may be off (private browsing); the choice then lasts for this visit.
  }
}
