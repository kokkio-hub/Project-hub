import { z } from 'zod';
import {
  COLOR_NAMES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  USER_ROLES,
} from '../../shared/types.js';
import { badRequest } from './errors.js';

/** Validates `data` against `schema`, throwing a 400 with per-field messages on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  const message = first ? (first.path.length ? `${first.path.join('.')}: ${first.message}` : first.message) : 'Invalid request.';
  throw badRequest(message, fields);
}

export function parseId(value: unknown, what = 'id'): number {
  const n = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw badRequest(`Invalid ${what}.`);
  return n;
}

// Reusable field schemas -------------------------------------------------------

export const zName = z.string().trim().min(1, 'Name is required').max(100, 'Use at most 100 characters');
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254, 'Email address is too long'));
export const zPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);
export const zTitle = z.string().trim().max(100, 'Use at most 100 characters');
export const zColor = z.enum(COLOR_NAMES, 'Pick one of the available colours');
export const zRole = z.enum(USER_ROLES, 'Role must be admin or member');
export const zDate = z.iso.date('Use the format YYYY-MM-DD');
export const zNullableDate = zDate.nullable();
export const zTaskStatus = z.enum(TASK_STATUSES, 'Unknown status');
export const zTaskPriority = z.enum(TASK_PRIORITIES, 'Unknown priority');
export const zProjectStatus = z.enum(PROJECT_STATUSES, 'Unknown project status');
export const zIdRef = z.number().int().positive();

/** Throws when both dates are set and the start is after the end. */
export function assertDateOrder(start: string | null | undefined, end: string | null | undefined, field = 'dueDate'): void {
  if (start && end && start > end) {
    throw badRequest('The due date cannot be before the start date.', { [field]: 'Must be on or after the start date' });
  }
}
