import type { ErrorRequestHandler } from 'express';
import type { ApiErrorBody } from '../../shared/types.js';
import { requestLanguage, translateFields, translateMessage, trFor, type Translator } from '../i18n/index.js';

export class HttpError extends Error {
  readonly status: number;
  readonly fields?: Record<string, string>;
  /** A stable code for errors the web app reacts to, since the message gets translated. */
  code?: string;
  /** Builds the message in the viewer's language, for messages too varied for the catalog (counts, lists). */
  render?: (tr: Translator) => string;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.fields = fields;
  }

  withCode(code: string): this {
    this.code = code;
    return this;
  }
}

/** A 400 whose message is written per language: `badRequestIn((tr) => tr.tn(...), fields)`. */
export function badRequestIn(render: (tr: Translator) => string, fields?: Record<string, string>): HttpError {
  const error = new HttpError(400, render(trFor('en')), fields);
  error.render = render;
  return error;
}

export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, fields);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, message);
export const forbidden = (message = 'You don’t have permission to do that.') => new HttpError(403, message);
export const notFound = (what = 'Item') => new HttpError(404, `${what} not found.`);
export const conflict = (message: string, fields?: Record<string, string>) => new HttpError(409, message, fields);

/**
 * Turns thrown errors into JSON responses, in the viewer's language. Unknown
 * errors are logged and hidden from clients.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  // req.lang is missing when the error happened before the language was worked out (bad JSON, say).
  const lang = req.lang ?? requestLanguage(req, null);
  const send = (status: number, message: string, extra: Partial<ApiErrorBody> = {}) => {
    const body: ApiErrorBody = { error: translateMessage(message, lang), ...extra };
    res.status(status).json(body);
  };
  if (err instanceof HttpError) {
    const fields = translateFields(err.fields, lang);
    const extra = { ...(fields ? { fields } : {}), ...(err.code ? { code: err.code } : {}) };
    if (err.render) {
      res.status(err.status).json({ error: err.render(trFor(lang)), ...extra } satisfies ApiErrorBody);
      return;
    }
    send(err.status, err.message, extra);
    return;
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === 'entity.parse.failed') {
    send(400, 'The request body is not valid JSON.');
    return;
  }
  if (type === 'entity.too.large') {
    send(413, 'The request is too large.');
    return;
  }
  console.error(err);
  send(500, 'Something went wrong on the server. Please try again.');
};
