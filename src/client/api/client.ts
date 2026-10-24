import { localToday } from '../../shared/dates';
import type { ApiErrorBody } from '../../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

type Listener = (error: ApiError) => void;
let authFailureListener: Listener | null = null;

/** Called when the server says the session is gone (401) or a password change is due (403). */
export function onAuthFailure(listener: Listener | null): void {
  authFailureListener = listener;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** A file to send as the raw request body (uploads). */
  file?: Blob;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Calls the JSON API. Every request carries the viewer's local date and UTC
 * offset (so "overdue" matches their calendar) and the X-Requested-With header
 * the server requires on changes (CSRF protection).
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'fetch',
    'X-Client-Date': localToday(),
    'X-Client-Tz-Offset': String(-new Date().getTimezoneOffset()),
  };
  Object.assign(headers, options.headers);
  let body: string | Blob | undefined;
  if (options.file) {
    headers['Content-Type'] = 'application/octet-stream';
    body = options.file;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;

  if (!response.ok) {
    const error = new ApiError(
      response.status,
      data?.error ?? `The server returned an error (${response.status}).`,
      data?.fields ?? {},
    );
    const isAuthCall = path.startsWith('/auth/');
    if (!isAuthCall && (response.status === 401 || (response.status === 403 && /new password/i.test(error.message)))) {
      authFailureListener?.(error);
    }
    throw error;
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
