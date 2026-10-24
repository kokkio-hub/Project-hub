/**
 * Types and constants shared by the API server and the web client.
 * This file must stay free of runtime imports so both sides can use it.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'In review',
  done: 'Done',
};

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  member: 'Member',
};

/**
 * Identity colours for projects and people. Stored by name; the client maps each
 * name to a light/dark-mode value (see styles/tokens.css). The order is fixed and
 * colour-vision-deficiency checked, so new items take the next slot in this order.
 */
export const COLOR_NAMES = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * How a new team member gets access: an invitation emailed by the app, an
 * invitation link the admin shares themselves, or a temporary password.
 */
export const INVITE_METHODS = ['email', 'link', 'password'] as const;
export type InviteMethod = (typeof INVITE_METHODS)[number];

/** How long a password reset link works. */
export const RESET_LINK_MINUTES = 60;

// ---------------------------------------------------------------------------
// Entities (as returned by the API)
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  email: string;
  name: string;
  title: string;
  role: UserRole;
  color: ColorName;
  isActive: boolean;
  mustChangePassword: boolean;
  /** True until the person accepts their invitation and chooses a password. */
  invitePending: boolean;
  createdAt: string;
  /** Only included for admins. */
  lastLoginAt?: string | null;
  /** Only included for admins: the invitation link that still works, if there is one. */
  invite?: InviteStatus | null;
}

export interface InviteStatus {
  /** When the current invitation link was created. */
  createdAt: string;
  expiresAt: string;
  /** When it was emailed; null when the admin copied the link to send it themselves. */
  emailedAt: string | null;
}

export interface TaskCounts {
  total: number;
  todo: number;
  in_progress: number;
  review: number;
  done: number;
  overdue: number;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  color: ColorName;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  ownerId: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  counts: TaskCounts;
}

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: number | null;
  /** Calendar dates as YYYY-MM-DD, no time zone. */
  startDate: string | null;
  dueDate: string | null;
  position: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  commentCount: number;
}

export interface Comment {
  id: number;
  taskId: number;
  userId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType =
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.status'
  | 'task.assigned'
  | 'task.deleted'
  | 'comment.created';

export interface ActivityItem {
  id: number;
  type: ActivityType;
  userId: number | null;
  projectId: number | null;
  taskId: number | null;
  /** Snapshot of names at the time of the event, so history survives renames/deletes. */
  data: {
    projectName?: string;
    taskTitle?: string;
    from?: string | null;
    to?: string | null;
    assigneeId?: number | null;
    excerpt?: string;
    fields?: string[];
  };
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type ProjectHealth = 'on_track' | 'at_risk' | 'off_track' | 'completed';

export interface DashboardProject {
  id: number;
  name: string;
  color: ColorName;
  status: ProjectStatus;
  dueDate: string | null;
  total: number;
  done: number;
  overdue: number;
  /** 0..1 share of tasks that are done. */
  progress: number;
  health: ProjectHealth;
  /** Short explanation of the health rating, shown in the UI. */
  healthReason: string;
}

export interface WorkloadRow {
  userId: number;
  todo: number;
  in_progress: number;
  review: number;
  open: number;
  overdue: number;
  dueThisWeek: number;
}

export interface ThroughputWeek {
  /** Monday of the week, YYYY-MM-DD. */
  weekStart: string;
  completed: number;
  created: number;
}

export interface DashboardData {
  today: string;
  stats: {
    openTasks: number;
    dueThisWeek: number;
    overdue: number;
    completedThisWeek: number;
    completedLastWeek: number;
    activeProjects: number;
  };
  projects: DashboardProject[];
  workload: WorkloadRow[];
  throughput: ThroughputWeek[];
  myTasks: Task[];
  activity: ActivityItem[];
}

// ---------------------------------------------------------------------------
// Live updates (server-sent events)
// ---------------------------------------------------------------------------

export interface LiveEvent {
  entity: 'task' | 'project' | 'comment' | 'user';
  action: 'created' | 'updated' | 'deleted';
  id: number;
  projectId?: number;
  taskId?: number;
  actorId?: number;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface AppStatus {
  appName: string;
  setupRequired: boolean;
  /** Outgoing email is set up, so invitations and reset links can be emailed. */
  emailEnabled: boolean;
  /** People can reset a forgotten password themselves (needs email and APP_URL). */
  passwordResetEnabled: boolean;
}

export interface ApiErrorBody {
  error: string;
  /** Field-level validation messages, keyed by field name. */
  fields?: Record<string, string>;
}

export interface CreatedUserResponse {
  user: User;
  /** Present when the server generated a password; shown to the admin once. */
  temporaryPassword?: string;
  /** The invitation link: returned when the admin asked for a link, or when the email couldn't be sent. */
  inviteUrl?: string;
  /** True when the invitation email was sent. */
  emailed?: boolean;
  /** Why the invitation email couldn't be sent. */
  emailError?: string;
}

/** Result of sending a new invitation to someone who hasn't joined yet. */
export interface InviteResponse {
  expiresAt: string;
  inviteUrl?: string;
  emailed?: boolean;
  emailError?: string;
}

/** What an invitation or password reset link is for, shown before the person chooses a password. */
export interface LinkInfo {
  name: string;
  email: string;
  /** Who sent the invitation (invitations only). */
  invitedBy?: string | null;
}
