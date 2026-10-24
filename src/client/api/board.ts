import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  Attachment,
  ChecklistItem,
  ColorName,
  Label,
  Project,
  TaskDependencies,
  TaskStatus,
} from '../../shared/types';
import { api, ApiError } from './client';
import { invalidateWork, qk } from './queries';

/** Hooks for board columns, labels, members, copies, checklists, dependencies and attachments. */

function refreshProject(qc: QueryClient, project?: Project) {
  if (project) qc.setQueryData(qk.project(project.id), project);
  invalidateWork(qc);
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export function useAddColumn(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; stage: TaskStatus }) =>
      api<{ project: Project }>(`/projects/${projectId}/columns`, { method: 'POST', body: input }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

export function useUpdateColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; stage?: TaskStatus } }) =>
      api<{ project: Project }>(`/columns/${id}`, { method: 'PATCH', body: patch }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

export function useDeleteColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, moveTo }: { id: number; moveTo: number }) =>
      api<{ project: Project }>(`/columns/${id}?moveTo=${moveTo}`, { method: 'DELETE' }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

export function useReorderColumns(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      api<{ project: Project }>(`/projects/${projectId}/columns/order`, { method: 'PUT', body: { ids } }).then((r) => r.project),
    onMutate: (ids) => {
      qc.setQueryData<Project>(qk.project(projectId), (old) =>
        old ? { ...old, columns: ids.map((id, position) => ({ ...old.columns.find((c) => c.id === id)!, position })) } : old,
      );
    },
    onSettled: (project) => refreshProject(qc, project),
  });
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function useCreateLabel(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: ColorName }) =>
      api<{ label: Label }>(`/projects/${projectId}/labels`, { method: 'POST', body: input }).then((r) => r.label),
    onSuccess: () => refreshProject(qc),
  });
}

export function useUpdateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; color?: ColorName } }) =>
      api<{ label: Label }>(`/labels/${id}`, { method: 'PATCH', body: patch }).then((r) => r.label),
    onSuccess: () => refreshProject(qc),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/labels/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshProject(qc),
  });
}

// ---------------------------------------------------------------------------
// Members and copies
// ---------------------------------------------------------------------------

export function useSetMembers(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: number[]) =>
      api<{ project: Project }>(`/projects/${projectId}/members`, { method: 'PUT', body: { userIds } }).then((r) => r.project),
    onSuccess: (project) => refreshProject(qc, project),
  });
}

export interface DuplicateInput {
  name: string;
  startDate: string | null;
  includeTasks: boolean;
  keepAssignees: boolean;
  resetProgress: boolean;
  asTemplate: boolean;
}

export function useDuplicateProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DuplicateInput) =>
      api<{ project: Project }>(`/projects/${projectId}/duplicate`, { method: 'POST', body: input }).then((r) => r.project),
    onSuccess: () => invalidateWork(qc),
  });
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

function invalidateTask(qc: QueryClient, taskId: number) {
  void qc.invalidateQueries({ queryKey: qk.task(taskId) });
  void qc.invalidateQueries({ queryKey: ['tasks'] });
}

export function useChecklist(taskId: number) {
  return useQuery({
    queryKey: qk.checklist(taskId),
    queryFn: () => api<{ items: ChecklistItem[] }>(`/tasks/${taskId}/checklist`).then((r) => r.items),
  });
}

export function useAddChecklistItem(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<{ item: ChecklistItem }>(`/tasks/${taskId}/checklist`, { method: 'POST', body: { body } }).then((r) => r.item),
    onSuccess: (item) => {
      qc.setQueryData<ChecklistItem[]>(qk.checklist(taskId), (old) => (old ? [...old, item] : [item]));
      invalidateTask(qc, taskId);
    },
  });
}

export function useUpdateChecklistItem(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { body?: string; done?: boolean } }) =>
      api<{ item: ChecklistItem }>(`/checklist/${id}`, { method: 'PATCH', body: patch }).then((r) => r.item),
    onMutate: ({ id, patch }) => {
      qc.setQueryData<ChecklistItem[]>(qk.checklist(taskId), (old) => old?.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.checklist(taskId) });
      invalidateTask(qc, taskId);
    },
  });
}

export function useDeleteChecklistItem(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/checklist/${id}`, { method: 'DELETE' }),
    onMutate: (id) => {
      qc.setQueryData<ChecklistItem[]>(qk.checklist(taskId), (old) => old?.filter((i) => i.id !== id));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.checklist(taskId) });
      invalidateTask(qc, taskId);
    },
  });
}

export function useReorderChecklist(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      api<{ items: ChecklistItem[] }>(`/tasks/${taskId}/checklist/order`, { method: 'PUT', body: { ids } }).then((r) => r.items),
    onMutate: (ids) => {
      qc.setQueryData<ChecklistItem[]>(qk.checklist(taskId), (old) => (old ? ids.map((id) => old.find((i) => i.id === id)!).filter(Boolean) : old));
    },
    onSuccess: (items) => qc.setQueryData(qk.checklist(taskId), items),
  });
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export function useDependencies(taskId: number) {
  return useQuery({
    queryKey: qk.dependencies(taskId),
    queryFn: () => api<TaskDependencies>(`/tasks/${taskId}/dependencies`),
  });
}

export function useAddBlocker(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockerId: number) => api<TaskDependencies>(`/tasks/${taskId}/blockers`, { method: 'POST', body: { blockerId } }),
    onSuccess: (deps) => {
      qc.setQueryData(qk.dependencies(taskId), deps);
      invalidateWork(qc);
    },
  });
}

export function useRemoveBlocker(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (blockerId: number) => api<TaskDependencies>(`/tasks/${taskId}/blockers/${blockerId}`, { method: 'DELETE' }),
    onSuccess: (deps) => {
      qc.setQueryData(qk.dependencies(taskId), deps);
      invalidateWork(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export function useAttachments(taskId: number) {
  return useQuery({
    queryKey: qk.attachments(taskId),
    queryFn: () => api<{ attachments: Attachment[] }>(`/tasks/${taskId}/attachments`).then((r) => r.attachments),
  });
}

export function useUploadAttachment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<{ attachment: Attachment }>(`/tasks/${taskId}/attachments`, {
        method: 'POST',
        file,
        headers: { 'X-File-Name': encodeURIComponent(file.name || 'pasted-image.png') },
      }).then((r) => r.attachment),
    onSuccess: (attachment) => {
      qc.setQueryData<Attachment[]>(qk.attachments(taskId), (old) => (old ? [...old, attachment] : [attachment]));
      invalidateTask(qc, taskId);
      void qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useDeleteAttachment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.setQueryData<Attachment[]>(qk.attachments(taskId), (old) => old?.filter((a) => a.id !== id));
      invalidateTask(qc, taskId);
    },
  });
}

export function attachmentUrl(id: number, download = false): string {
  return `/api/attachments/${id}/file${download ? '?download=1' : ''}`;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
