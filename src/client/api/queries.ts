import { useMemo } from 'react';
import type { Lang } from '../../shared/i18n/core';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ActivityItem,
  AppStatus,
  ColorName,
  Comment,
  CreatedUserResponse,
  DashboardData,
  InviteMethod,
  InviteResponse,
  LinkInfo,
  Me,
  NotifyEmailMode,
  Project,
  ProjectStatus,
  ProjectVisibility,
  Recurrence,
  Task,
  TaskPriority,
  TaskStatus,
  TwoFactorChallenge,
  User,
  UserRole,
} from '../../shared/types';
import { api, ApiError } from './client';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export interface TaskQuery {
  projectId?: number;
  assigneeId?: 'me' | number;
  status?: string;
  includeArchived?: boolean;
}

export interface ActivityQuery {
  projectId?: number;
  taskId?: number;
  limit?: number;
}

export type TemplateMode = 'exclude' | 'only' | 'include';

export const qk = {
  status: ['status'] as const,
  me: ['me'] as const,
  users: ['users'] as const,
  projects: (includeArchived: boolean, templates: TemplateMode = 'exclude') => ['projects', { includeArchived, templates }] as const,
  project: (id: number) => ['project', id] as const,
  tasks: (query: TaskQuery) => ['tasks', query] as const,
  task: (id: number) => ['task', id] as const,
  comments: (taskId: number) => ['comments', taskId] as const,
  dashboard: ['dashboard'] as const,
  activity: (query: ActivityQuery) => ['activity', query] as const,
  link: (kind: LinkKind, token: string) => ['link', kind, token] as const,
  checklist: (taskId: number) => ['checklist', taskId] as const,
  attachments: (taskId: number) => ['attachments', taskId] as const,
  dependencies: (taskId: number) => ['dependencies', taskId] as const,
  notifications: ['notifications'] as const,
  search: (q: string) => ['search', q] as const,
  trash: ['trash'] as const,
  sessions: ['sessions'] as const,
  adminStatus: ['admin-status'] as const,
  views: ['views'] as const,
};

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== false) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** Refreshes everything derived from tasks and projects after a change. */
export function invalidateWork(qc: QueryClient): void {
  for (const key of ['tasks', 'task', 'projects', 'project', 'dashboard', 'activity', 'dependencies', 'trash', 'search']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

/** Applies a change to a task in every cached list, so the UI updates before the server answers. */
export function patchTaskCaches(qc: QueryClient, id: number, patch: Partial<Task>): void {
  qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => old?.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  qc.setQueryData<Task>(qk.task(id), (old) => (old ? { ...old, ...patch } : old));
}

function removeTaskFromCaches(qc: QueryClient, id: number): void {
  qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => old?.filter((task) => task.id !== id));
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function useAppStatus() {
  return useQuery({ queryKey: qk.status, queryFn: () => api<AppStatus>('/auth/status'), staleTime: Infinity });
}

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        return (await api<{ user: Me }>('/auth/me')).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Data that doesn't belong to whoever is signed in, so it survives signing in and out. */
const SESSIONLESS_KEYS = new Set<unknown>(['status', 'me', 'link']);

/** Clears cached data when someone signs in or out, so one person never sees another's cache. */
export function resetSessionData(qc: QueryClient, user: Me | null): void {
  qc.removeQueries({ predicate: (q) => !SESSIONLESS_KEYS.has(q.queryKey[0]) });
  qc.setQueryData(qk.me, user);
}

/** Signing in answers with the person, or with a challenge when a two-factor code is still needed. */
export type SignInResult = { user: Me } | TwoFactorChallenge;

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api<SignInResult>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (result) => {
      if ('user' in result) resetSessionData(qc, result.user);
    },
  });
}

/** The second sign-in step: a code from the authenticator app or a recovery code. */
export function useVerifyLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { challenge: string; code: string }) =>
      api<{ user: Me }>('/auth/login/verify', { method: 'POST', body: input }).then((r) => r.user),
    onSuccess: (user) => resetSessionData(qc, user),
  });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      api<{ user: Me }>('/auth/setup', { method: 'POST', body: input }).then((r) => r.user),
    onSuccess: (user) => {
      qc.setQueryData<AppStatus>(qk.status, (old) => (old ? { ...old, setupRequired: false } : old));
      resetSessionData(qc, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => resetSessionData(qc, null),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api<{ user: Me }>('/auth/password', { method: 'POST', body: input }).then((r) => r.user),
    onSuccess: (user) => qc.setQueryData(qk.me, user),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; title?: string; color?: ColorName; notifyEmail?: NotifyEmailMode; language?: Lang | null }) =>
      api<{ user: Me }>('/auth/me', { method: 'PATCH', body: input }).then((r) => r.user),
    onSuccess: (user) => {
      qc.setQueryData(qk.me, user);
      void qc.invalidateQueries({ queryKey: qk.users });
    },
  });
}

// ---------------------------------------------------------------------------
// Invitation and password reset links
// ---------------------------------------------------------------------------

export type LinkKind = 'invitation' | 'password-reset';

/** Who a link is for. Looked up once: after the link is used it stops working, and the page moves on. */
export function useLinkInfo(kind: LinkKind, token: string) {
  return useQuery({
    queryKey: qk.link(kind, token),
    queryFn: () => api<LinkInfo>(`/auth/${kind}/lookup`, { method: 'POST', body: { token } }),
    enabled: token.length > 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Accepts an invitation: sets the password (and name), then signs in. */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string; name: string; password: string }) =>
      api<{ user: Me }>('/auth/invitation/accept', { method: 'POST', body: input }).then((r) => r.user),
    onSuccess: (user) => resetSessionData(qc, user),
  });
}

/** Asks for a reset link by email. The answer is the same whether or not the address has an account. */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => api<{ ok: true }>('/auth/password-reset/request', { method: 'POST', body: { email } }),
  });
}

/** Sets a new password from a reset link, then signs in (or asks for a two-factor code first). */
export function useCompletePasswordReset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api<SignInResult>('/auth/password-reset/complete', { method: 'POST', body: input }),
    onSuccess: (result) => {
      if ('user' in result) resetSessionData(qc, result.user);
    },
  });
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

const NO_USERS: User[] = [];

export function useUsers() {
  const query = useQuery({
    queryKey: qk.users,
    queryFn: () => api<{ users: User[] }>('/users').then((r) => r.users),
    staleTime: 60_000,
  });
  const users = query.data ?? NO_USERS;
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const active = useMemo(() => users.filter((u) => u.isActive), [users]);
  return { ...query, users, byId, active };
}

export interface UserInput {
  name: string;
  email: string;
  title?: string;
  role: UserRole;
}

export interface NewUserInput extends UserInput {
  /** How they get access: an emailed invitation, an invite link to share, or a temporary password. */
  invite: InviteMethod;
  /** With invite "password": the temporary password. Leave out to have one generated. */
  password?: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewUserInput) => api<CreatedUserResponse>('/users', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.users }),
  });
}

/** Sends someone who hasn't joined a new invitation: by email, or as a link for the admin to share. */
export function useSendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sendEmail }: { id: number; sendEmail: boolean }) =>
      api<InviteResponse>(`/users/${id}/invite`, { method: 'POST', body: { sendEmail } }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.users }),
  });
}

/** Cancels an invitation nobody accepted. Their tasks become unassigned. */
export function useCancelInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.users });
      invalidateWork(qc);
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<UserInput> & { isActive?: boolean; color?: ColorName } }) =>
      api<{ user: User }>(`/users/${id}`, { method: 'PATCH', body: patch }).then((r) => r.user),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.users });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

/** An admin helps someone who can't sign in: emails them a reset link, or makes a temporary password. */
export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sendEmail }: { id: number; sendEmail: boolean }) =>
      api<{ temporaryPassword?: string; emailed?: boolean }>(`/users/${id}/reset-password`, {
        method: 'POST',
        body: { sendEmail },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.users }),
  });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function useProjects(includeArchived = false, templates: TemplateMode = 'exclude') {
  return useQuery({
    queryKey: qk.projects(includeArchived, templates),
    queryFn: () =>
      api<{ projects: Project[] }>(
        `/projects${toQueryString({ includeArchived, templates: templates === 'exclude' ? undefined : templates })}`,
      ).then((r) => r.projects),
  });
}

export function useProject(id: number | undefined) {
  return useQuery({
    queryKey: qk.project(id ?? 0),
    queryFn: () => api<{ project: Project }>(`/projects/${id}`).then((r) => r.project),
    enabled: id !== undefined && id > 0,
  });
}

export interface ProjectInput {
  name: string;
  description: string;
  color?: ColorName;
  status: ProjectStatus;
  visibility?: ProjectVisibility;
  startDate: string | null;
  dueDate: string | null;
  ownerId: number | null;
  memberIds?: number[];
  /** Start the new project from a template. */
  fromTemplateId?: number;
  keepAssignees?: boolean;
  isTemplate?: boolean;
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) =>
      api<{ project: Project }>('/projects', { method: 'POST', body: input }).then((r) => r.project),
    onSuccess: () => invalidateWork(qc),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ProjectInput> }) =>
      api<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body: patch }).then((r) => r.project),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(project.id), project);
      invalidateWork(qc);
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: qk.project(id) });
      invalidateWork(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function useTasks(query: TaskQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.tasks(query),
    queryFn: () => api<{ tasks: Task[] }>(`/tasks${toQueryString({ ...query })}`).then((r) => r.tasks),
    enabled: options.enabled ?? true,
  });
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: qk.task(id ?? 0),
    queryFn: () => api<{ task: Task }>(`/tasks/${id}`).then((r) => r.task),
    enabled: id !== null && id > 0,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

export interface TaskInput {
  projectId: number;
  title: string;
  description?: string;
  status?: TaskStatus;
  columnId?: number;
  priority?: TaskPriority;
  assigneeId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  labelIds?: number[];
  recurrence?: Recurrence | null;
  /** Makes the task a subtask of another task in the same project (null: a normal task again). */
  parentId?: number | null;
  milestoneId?: number | null;
  /** Custom field values by field id; null clears one. */
  fields?: Record<string, string | number | boolean | null>;
}

export type TaskPatch = Partial<Omit<TaskInput, 'projectId'>> & { projectId?: number };

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => api<{ task: Task }>('/tasks', { method: 'POST', body: input }).then((r) => r.task),
    onSuccess: () => invalidateWork(qc),
  });
}

/** The saved task, and the next copy when finishing a repeating task created one. */
export interface TaskSaveResult {
  task: Task;
  next?: Task;
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatch }) => api<TaskSaveResult>(`/tasks/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const { labelIds, recurrence, fields, ...simple } = patch;
      const optimistic: Partial<Task> = { ...simple, ...(labelIds ? { labelIds } : {}), ...(recurrence !== undefined ? { recurrence } : {}) } as Partial<Task>;
      if (fields) {
        // Merge the changed values into each cached copy of the task.
        const merge = (old: Task) => {
          const values = { ...old.fieldValues };
          for (const [key, value] of Object.entries(fields)) {
            if (value === null || value === '' || value === false) delete values[key];
            else values[key] = String(value);
          }
          return values;
        };
        qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => old?.map((task) => (task.id === id ? { ...task, fieldValues: merge(task) } : task)));
        qc.setQueryData<Task>(qk.task(id), (old) => (old ? { ...old, fieldValues: merge(old) } : old));
      }
      patchTaskCaches(qc, id, optimistic);
    },
    onSuccess: (result) => patchTaskCaches(qc, result.task.id, result.task),
    onError: () => invalidateWork(qc),
    onSettled: () => invalidateWork(qc),
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, columnId, afterId }: { id: number; columnId: number; afterId: number | null }) =>
      api<TaskSaveResult>(`/tasks/${id}/move`, { method: 'POST', body: { columnId, afterId } }),
    onSettled: () => invalidateWork(qc),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      removeTaskFromCaches(qc, id);
      for (const key of [qk.task(id), qk.checklist(id), qk.attachments(id), qk.dependencies(id), qk.comments(id)]) {
        qc.removeQueries({ queryKey: key });
      }
      invalidateWork(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Comments, activity, dashboard
// ---------------------------------------------------------------------------

export function useComments(taskId: number | null) {
  return useQuery({
    queryKey: qk.comments(taskId ?? 0),
    queryFn: () => api<{ comments: Comment[] }>(`/tasks/${taskId}/comments`).then((r) => r.comments),
    enabled: taskId !== null && taskId > 0,
  });
}

function invalidateComments(qc: QueryClient, taskId: number) {
  void qc.invalidateQueries({ queryKey: qk.comments(taskId) });
  void qc.invalidateQueries({ queryKey: ['tasks'] });
  void qc.invalidateQueries({ queryKey: qk.task(taskId) });
  void qc.invalidateQueries({ queryKey: ['activity'] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
}

export function useAddComment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<{ comment: Comment }>(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } }).then((r) => r.comment),
    onSuccess: () => invalidateComments(qc, taskId),
  });
}

export function useEditComment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      api<{ comment: Comment }>(`/comments/${id}`, { method: 'PATCH', body: { body } }).then((r) => r.comment),
    onSuccess: () => invalidateComments(qc, taskId),
  });
}

export function useDeleteComment(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<void>(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateComments(qc, taskId),
  });
}

export function useActivity(query: ActivityQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.activity(query),
    queryFn: () =>
      api<{ activity: ActivityItem[] }>(`/activity${toQueryString({ ...query })}`).then((r) => r.activity),
    enabled: options.enabled ?? true,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api<DashboardData>('/dashboard') });
}
