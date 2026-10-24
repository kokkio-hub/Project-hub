import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '../../shared/types.js';

export class HttpError extends Error {
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, fields);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, message);
export const forbidden = (message = "You don't have permission to do that.") => new HttpError(403, message);
export const notFound = (what = 'Item') => new HttpError(404, `${what} not found.`);
export const conflict = (message: string, fields?: Record<string, string>) => new HttpError(409, message, fields);

/** Turns thrown errors into JSON responses. Unknown errors are logged and hidden from clients. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    const body: ApiErrorBody = { error: err.message };
    if (err.fields) body.fields = err.fields;
    res.status(err.status).json(body);
    return;
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON.' } satisfies ApiErrorBody);
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: 'The request is too large.' } satisfies ApiErrorBody);
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' } satisfies ApiErrorBody);
};
