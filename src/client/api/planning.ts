import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ColorName, CustomField, FieldType, Project, ProjectView, SavedView, Task, ViewSettings } from '../../shared/types';
import { api } from './client';
import { invalidateWork, qk } from './queries';

/** Hooks for milestones, custom fields, subtasks and saved views. */

function refreshProject(qc: QueryClient, project: Project) {
  qc.setQueryData(qk.project(project.id), project);
  invalidateWork(qc);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export interface MilestoneInput {
  name: string;
  date: string;
  description?: string;
}

export function useCreateMilestone(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MilestoneInput) =>
      api<{ milestoneId: number; project: Project }>(`/projects/${projectId}/milestones`, { method: 'POST', body: input }),
    onSuccess: (r) => refreshProject(qc, r.project),
  });
}

export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<MilestoneInput> & { reached?: boolean } }) =>
      api<{ project: Project }>(`/milestones/${id}`, { method: 'PATCH', body: patch }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ project: Project }>(`/milestones/${id}`, { method: 'DELETE' }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export interface FieldOptionInput {
  id?: string;
  name: string;
  color: ColorName;
}

export interface FieldInput {
  name: string;
  type: FieldType;
  options: FieldOptionInput[];
  showOnCard: boolean;
}

export function useCreateField(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FieldInput) =>
      api<{ field: CustomField; project: Project }>(`/projects/${projectId}/fields`, { method: 'POST', body: input }),
    onSuccess: (r) => refreshProject(qc, r.project),
  });
}

export function useUpdateField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Omit<FieldInput, 'type'>> }) =>
      api<{ field: CustomField; project: Project }>(`/fields/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: (r) => refreshProject(qc, r.project),
  });
}

export function useDeleteField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ project: Project }>(`/fields/${id}`, { method: 'DELETE' }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

export function useReorderFields(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      api<{ project: Project }>(`/projects/${projectId}/fields/order`, { method: 'PUT', body: { ids } }).then((r) => r.project),
    onMutate: (ids) => {
      qc.setQueryData<Project>(qk.project(projectId), (old) =>
        old ? { ...old, fields: ids.map((id, position) => ({ ...old.fields.find((f) => f.id === id)!, position })) } : old,
      );
    },
    onSuccess: (project) => refreshProject(qc, project),
  });
}

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

/** Turns a checklist item into a subtask of its task. */
export function useChecklistToSubtask(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => api<{ task: Task }>(`/checklist/${itemId}/subtask`, { method: 'POST' }).then((r) => r.task),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.checklist(taskId) });
      invalidateWork(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

const NO_VIEWS: SavedView[] = [];

export function useViews() {
  const query = useQuery({
    queryKey: qk.views,
    queryFn: () => api<{ views: SavedView[] }>('/views').then((r) => r.views),
    staleTime: 60_000,
  });
  return { ...query, views: query.data ?? NO_VIEWS };
}

export interface ViewInput {
  name: string;
  view: ProjectView;
  settings: ViewSettings;
}

export function useCreateView(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ViewInput) =>
      api<{ view: SavedView }>(`/projects/${projectId}/views`, { method: 'POST', body: input }).then((r) => r.view),
    onSuccess: (view) => {
      qc.setQueryData<SavedView[]>(qk.views, (old) => (old ? [...old, view] : [view]));
      void qc.invalidateQueries({ queryKey: qk.views });
    },
  });
}

export function useUpdateView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ViewInput> }) =>
      api<{ view: SavedView }>(`/views/${id}`, { method: 'PATCH', body: patch }).then((r) => r.view),
    onSuccess: (view) => {
      qc.setQueryData<SavedView[]>(qk.views, (old) => old?.map((v) => (v.id === view.id ? view : v)));
    },
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/views/${id}`, { method: 'DELETE' }),
    onMutate: (id) => {
      qc.setQueryData<SavedView[]>(qk.views, (old) => old?.filter((v) => v.id !== id));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.views }),
  });
}

export function useReorderViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api<{ views: SavedView[] }>('/views/order', { method: 'PUT', body: { ids } }).then((r) => r.views),
    onMutate: (ids) => {
      qc.setQueryData<SavedView[]>(qk.views, (old) => (old ? ids.map((id) => old.find((v) => v.id === id)!).filter(Boolean) : old));
    },
    onSuccess: (views) => qc.setQueryData(qk.views, views),
  });
}
