import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminStatus, Me, SessionInfo, User } from '../../shared/types';
import { api } from './client';
import { qk } from './queries';

/** Hooks for signed-in devices, two-factor sign-in, the calendar feed and admin status. */

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api<{ sessions: SessionInfo[] }>('/auth/sessions').then((r) => r.sessions) });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export function useSignOutOthers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/sessions/sign-out-others', { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrSvg: string;
}

export function useStartTwoFactor() {
  return useMutation({
    mutationFn: (password: string) => api<TwoFactorSetup>('/auth/2fa/setup', { method: 'POST', body: { password } }),
  });
}

export function useEnableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<{ recoveryCodes: string[]; user: Me }>('/auth/2fa/enable', { method: 'POST', body: { code } }),
    onSuccess: (r) => {
      qc.setQueryData(qk.me, r.user);
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

export function useDisableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api<{ user: Me }>('/auth/2fa/disable', { method: 'POST', body: { password } }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useNewRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      api<{ recoveryCodes: string[]; user: Me }>('/auth/2fa/recovery-codes', { method: 'POST', body: { password } }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useCreateCalendarFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope: 'mine' | 'all') => api<{ url: string; user: Me }>('/auth/calendar', { method: 'POST', body: { scope } }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useCalendarScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope: 'mine' | 'all') => api<{ user: Me }>('/auth/calendar', { method: 'PATCH', body: { scope } }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useDeleteCalendarFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ user: Me }>('/auth/calendar', { method: 'DELETE' }),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
}

export function useAdminStatus(options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk.adminStatus,
    queryFn: () => api<AdminStatus>('/admin/status'),
    refetchInterval: (query) => (options.poll || query.state.data?.backup.running ? 3000 : false),
  });
}

export function useRunBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ backup: AdminStatus['backup'] }>('/admin/backup', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.adminStatus }),
  });
}

export function useAdminDisableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => api<{ user: User }>(`/users/${userId}/disable-2fa`, { method: 'POST' }).then((r) => r.user),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.users }),
  });
}
