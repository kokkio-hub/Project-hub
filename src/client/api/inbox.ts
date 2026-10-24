import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Notification, SearchResults, Task, TrashItem } from '../../shared/types';
import { api } from './client';
import { invalidateWork, qk } from './queries';

/** Hooks for notifications, search and the trash. */

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api<{ notifications: Notification[]; unread: number }>('/notifications?limit=50'),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids?: number[]; all?: boolean; taskId?: number }) =>
      api<{ unread: number }>('/notifications/read', { method: 'POST', body: input }),
    onMutate: (input) => {
      const now = new Date().toISOString();
      qc.setQueryData<{ notifications: Notification[]; unread: number }>(qk.notifications, (old) => {
        if (!old) return old;
        const hit = (n: Notification) => input.all || (input.ids?.includes(n.id) ?? false) || (input.taskId !== undefined && n.taskId === input.taskId);
        const notifications = old.notifications.map((n) => (!n.readAt && hit(n) ? { ...n, readAt: now } : n));
        return { notifications, unread: notifications.filter((n) => !n.readAt).length };
      });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useSearch(q: string) {
  const text = q.trim();
  return useQuery({
    queryKey: qk.search(text),
    queryFn: ({ signal }) => api<SearchResults>(`/search?q=${encodeURIComponent(text)}`, { signal }),
    enabled: text.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useTrash() {
  return useQuery({ queryKey: qk.trash, queryFn: () => api<{ items: TrashItem[] }>('/trash').then((r) => r.items) });
}

async function restoreItem(item: Pick<TrashItem, 'kind' | 'id'>): Promise<void> {
  if (item.kind === 'task') await api<{ task: Task }>(`/trash/tasks/${item.id}/restore`, { method: 'POST' });
  else await api<void>(`/trash/projects/${item.id}/restore`, { method: 'POST' });
}

export function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: restoreItem,
    onSuccess: () => invalidateWork(qc),
  });
}

/**
 * Brings back something that was just deleted, from the "Undo" button. A plain
 * function rather than a hook, because the screen that deleted it is often gone.
 */
export async function undoDelete(qc: QueryClient, item: Pick<TrashItem, 'kind' | 'id'>): Promise<void> {
  await restoreItem(item);
  invalidateWork(qc);
}

export function useDestroy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: Pick<TrashItem, 'kind' | 'id'>) =>
      api<void>(`/trash/${item.kind === 'task' ? 'tasks' : 'projects'}/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.trash }),
  });
}

export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/trash', { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.trash }),
  });
}
