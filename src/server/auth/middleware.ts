import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { isIsoDate, localToday } from '../../shared/dates.js';
import { SESSION_COOKIE, resolveSession } from './sessions.js';
import { isLang } from '../../shared/i18n/core.js';
import { requestLanguage } from '../i18n/index.js';

export function sessionCookieOptions(ctx: AppContext, req: Request, expiresAt?: string): CookieOptions {
  const secure = ctx.config.cookieSecure === 'auto' ? req.secure : ctx.config.cookieSecure;
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}

export function setSessionCookie(ctx: AppContext, req: Request, res: Response, token: string, expiresAt: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(ctx, req, expiresAt));
}

export function clearSessionCookie(ctx: AppContext, req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(ctx, req));
}

/** Reads the viewer's local date and UTC offset so "overdue" and "this week" match their calendar. */
export const clientClock: RequestHandler = (req, _res, next) => {
  const date = req.get('x-client-date');
  req.clientToday = isIsoDate(date) ? date : localToday();
  const offset = Number(req.get('x-client-tz-offset'));
  req.tzOffsetMinutes =
    Number.isInteger(offset) && offset >= -840 && offset <= 840 ? offset : -new Date().getTimezoneOffset();
  next();
};

/**
 * Cross-site request forgery guard. Browsers can't add custom headers to
 * cross-site requests without a CORS pre-flight (which this server never
 * approves), so requiring one on every state-changing call blocks CSRF. The
 * session cookie is also SameSite=Strict as a second layer.
 */
export const requireCustomHeader: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-requested-with')) {
    next();
    return;
  }
  next(forbidden('Missing X-Requested-With header.'));
};

/** Attaches `req.user` when the request carries a valid session cookie. Never rejects. */
export function authenticate(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0) {
      const session = resolveSession(ctx.db, token, ctx.config.sessionTtlDays, { ip: req.ip });
      if (session) {
        req.user = session.user;
        req.sessionId = session.id;
        // Remember the person's time zone, so reminders and the daily email follow their clock.
        const offset = Number(req.get('x-client-tz-offset'));
        if (Number.isInteger(offset) && offset >= -840 && offset <= 840 && offset !== session.user.tz_offset_minutes) {
          ctx.db.prepare('UPDATE users SET tz_offset_minutes = ? WHERE id = ?').run(offset, session.user.id);
          req.user = { ...req.user, tz_offset_minutes: offset };
        }
        // And the language they use the app in, so emails come in that language too.
        const lang = req.get('x-client-lang');
        if (isLang(lang) && lang !== session.user.ui_language) {
          ctx.db.prepare('UPDATE users SET ui_language = ? WHERE id = ?').run(lang, session.user.id);
          req.user = { ...req.user, ui_language: lang };
        }
        if (session.refreshed) setSessionCookie(ctx, req, res, token, session.expiresAt);
      } else {
        clearSessionCookie(ctx, req, res);
      }
    }
    next();
  };
}

/** Works out which language to answer in. Runs after `authenticate`, so it can use the person's settings. */
export function clientLanguage(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    req.lang = requestLanguage(req, ctx.config.defaultLanguage, req.user);
    next();
  };
}

/**
 * Requires a signed-in user. People who still have to replace a temporary
 * password can only reach the routes that let them do so.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.must_change_password) {
    return next(forbidden('Please choose a new password before continuing.').withCode('password_change_required'));
  }
  next();
};

/** Like requireAuth, but also admits users who must still change their password. */
export const requireSession: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user!.role !== 'admin') return next(forbidden('Only admins can do that.'));
    next();
  });
};
