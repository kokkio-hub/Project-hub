import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { nowIso } from '../db/index.js';
import { badRequest, conflict, forbidden, HttpError } from '../lib/errors.js';
import { parse, zColor, zEmail, zName, zPassword, zTitle } from '../lib/validation.js';
import { countUsers, getUserByEmail, getUserById, insertUser, isPending, toUser, updateUser } from '../repos/users.js';
import type { AppStatus, LinkInfo } from '../../shared/types.js';
import { clearSessionCookie, requireSession, setSessionCookie } from '../auth/middleware.js';
import { fakeVerify, hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, deleteSessionByToken, deleteUserSessions, SESSION_COOKIE } from '../auth/sessions.js';
import { deleteUserTokens, findValidToken, latestToken } from '../auth/tokens.js';
import { issueInvitation, sendPasswordResetLink } from '../services/access.js';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address'),
  password: z.string().min(1, 'Enter your password'),
});

const setupSchema = z.object({ name: zName, email: zEmail, password: zPassword });

const profileSchema = z.object({ name: zName.optional(), title: zTitle.optional(), color: zColor.optional() });

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: zPassword,
});

const zToken = z.string().min(1, 'This link is incomplete. Copy the whole link from the email.').max(200);
const tokenSchema = z.object({ token: zToken });
const acceptSchema = z.object({ token: zToken, name: zName.optional(), password: zPassword });
const completeResetSchema = z.object({ token: zToken, password: zPassword });
const resetRequestSchema = z.object({ email: z.string().trim().min(1, 'Enter your email address').max(254) });

/** Someone asking for their own reset link gets at most one email per minute. */
const RESEND_COOLDOWN_MS = 60_000;

const invitationGone = () =>
  new HttpError(410, 'This invitation link has expired or has already been used. Ask your admin to send you a new one.');
const resetLinkGone = () =>
  new HttpError(410, 'This password reset link has expired or has already been used. You can ask for a new one.');

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, config, mailer } = ctx;

  // Counts failed attempts only, so a busy office behind one IP isn't locked out by normal use.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.loginRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
    },
  });

  // Every request counts here: each one can send an email.
  const resetRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    },
  });

  /** Self-service resets need email, and APP_URL so links never depend on the address a stranger's request used. */
  const passwordResetEnabled = () => mailer.enabled && config.appUrl !== null;

  const startSession = (req: Request, res: Response, userId: number) => {
    const { token, expiresAt } = createSession(db, userId, config.sessionTtlDays, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(ctx, req, res, token, expiresAt);
  };

  router.get('/status', (_req, res) => {
    const body: AppStatus = {
      appName: config.appName,
      setupRequired: countUsers(db) === 0,
      emailEnabled: mailer.enabled,
      passwordResetEnabled: passwordResetEnabled(),
    };
    res.json(body);
  });

  /** First-run setup: creates the first admin. Only possible while there are no users. */
  router.post('/setup', limiter, async (req, res) => {
    const input = parse(setupSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    const create = db.transaction(() => {
      if (countUsers(db) > 0) throw conflict('Setup has already been completed. Please sign in.');
      return insertUser(db, {
        email: input.email,
        name: input.name,
        role: 'admin',
        passwordHash,
        mustChangePassword: false,
      });
    });
    const user = create.immediate();
    updateUser(db, user.id, { lastLoginAt: nowIso() });
    startSession(req, res, user.id);
    res.status(201).json({ user: toUser(user, { includePrivate: true }) });
  });

  router.post('/login', limiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = getUserByEmail(db, input.email);
    // People who haven't accepted their invitation have no password yet; answer exactly like an unknown address.
    const valid =
      user && !isPending(user) ? await verifyPassword(input.password, user.password_hash) : await fakeVerify(input.password);
    if (!user || !valid) throw new HttpError(401, 'Incorrect email or password.');
    if (!user.is_active) throw forbidden('This account has been deactivated. Please contact an administrator.');

    const updated = updateUser(db, user.id, { lastLoginAt: nowIso() });
    startSession(req, res, user.id);
    res.json({ user: toUser(updated, { includePrivate: updated.role === 'admin' }) });
  });

  router.post('/logout', (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) deleteSessionByToken(db, token);
    clearSessionCookie(ctx, req, res);
    res.status(204).end();
  });

  router.get('/me', requireSession, (req, res) => {
    res.json({ user: toUser(req.user!, { includePrivate: req.user!.role === 'admin' }) });
  });

  router.patch('/me', requireSession, (req, res) => {
    const input = parse(profileSchema, req.body);
    const user = updateUser(db, req.user!.id, input);
    ctx.events.broadcast({ entity: 'user', action: 'updated', id: user.id, actorId: user.id });
    res.json({ user: toUser(user, { includePrivate: user.role === 'admin' }) });
  });

  /** Changes the signed-in user's password and signs out their other sessions. */
  router.post('/password', requireSession, async (req, res) => {
    const input = parse(passwordSchema, req.body);
    const me = req.user!;
    if (!(await verifyPassword(input.currentPassword, me.password_hash))) {
      throw badRequest('Your current password is incorrect.', { currentPassword: 'Incorrect password' });
    }
    if (input.currentPassword === input.newPassword) {
      throw badRequest('Choose a password that is different from the current one.', {
        newPassword: 'Must be different from your current password',
      });
    }
    const user = updateUser(db, me.id, {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
    });
    deleteUserSessions(db, me.id, req.sessionId);
    deleteUserTokens(db, me.id, 'reset');
    res.json({ user: toUser(user, { includePrivate: user.role === 'admin' }) });
  });

  // -------------------------------------------------------------------------
  // Invitations: the link in the email (or the one the admin shared) leads here.
  // Tokens travel in request bodies, never in URLs, so they don't end up in logs.
  // -------------------------------------------------------------------------

  router.post('/invitation/lookup', limiter, (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const found = findValidToken(db, token, 'invite');
    const user = found ? getUserById(db, found.user_id) : undefined;
    if (!found || !user || !user.is_active || !isPending(user)) throw invitationGone();
    const inviter = found.created_by ? getUserById(db, found.created_by) : undefined;
    const body: LinkInfo = { name: user.name, email: user.email, invitedBy: inviter?.name ?? null };
    res.json(body);
  });

  /** Sets the invited person's password (and optionally their name), then signs them in. */
  router.post('/invitation/accept', limiter, async (req, res) => {
    const input = parse(acceptSchema, req.body);
    if (!findValidToken(db, input.token, 'invite')) throw invitationGone();
    const passwordHash = await hashPassword(input.password);

    const accept = db.transaction(() => {
      // Checked again inside the transaction, so a link can never be used twice.
      const found = findValidToken(db, input.token, 'invite');
      const row = found ? getUserById(db, found.user_id) : undefined;
      if (!found || !row || !row.is_active || !isPending(row)) throw invitationGone();
      deleteUserTokens(db, row.id);
      return updateUser(db, row.id, {
        passwordHash,
        mustChangePassword: false,
        lastLoginAt: nowIso(),
        ...(input.name ? { name: input.name } : {}),
      });
    });
    const user = accept.immediate();

    startSession(req, res, user.id);
    ctx.events.broadcast({ entity: 'user', action: 'updated', id: user.id, actorId: user.id });
    res.json({ user: toUser(user, { includePrivate: user.role === 'admin' }) });
  });

  // -------------------------------------------------------------------------
  // Forgotten passwords
  // -------------------------------------------------------------------------

  /**
   * Emails a reset link. The answer is the same whether or not the address has
   * an account, and the email goes out in the background, so neither the reply
   * nor its timing reveals who works here.
   */
  router.post('/password-reset/request', resetRequestLimiter, (req, res) => {
    if (!passwordResetEnabled()) {
      throw badRequest("Password reset by email isn't available here. Ask an admin to reset your password.");
    }
    const { email } = parse(resetRequestSchema, req.body);
    res.json({ ok: true });

    ctx.jobs.run('Password reset email', async () => {
      const user = getUserByEmail(db, email);
      if (!user || !user.is_active) return;
      const pending = isPending(user);
      const recent = latestToken(db, user.id, pending ? 'invite' : 'reset');
      if (recent && Date.now() - Date.parse(recent.created_at) < RESEND_COOLDOWN_MS) return;

      if (pending) {
        // They were invited but never joined (perhaps the link expired): send a fresh invitation.
        const inviter = recent?.created_by ? (getUserById(db, recent.created_by) ?? null) : null;
        await issueInvitation(ctx, { user, invitedBy: inviter, baseUrl: config.appUrl!, sendEmail: true });
      } else {
        await sendPasswordResetLink(ctx, { user, requestedBy: null, baseUrl: config.appUrl! });
      }
    });
  });

  router.post('/password-reset/lookup', limiter, (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const found = findValidToken(db, token, 'reset');
    const user = found ? getUserById(db, found.user_id) : undefined;
    if (!found || !user || !user.is_active || isPending(user)) throw resetLinkGone();
    const body: LinkInfo = { name: user.name, email: user.email };
    res.json(body);
  });

  /** Sets a new password from a reset link, signs the person out everywhere else and signs them in here. */
  router.post('/password-reset/complete', limiter, async (req, res) => {
    const input = parse(completeResetSchema, req.body);
    if (!findValidToken(db, input.token, 'reset')) throw resetLinkGone();
    const passwordHash = await hashPassword(input.password);

    const complete = db.transaction(() => {
      const found = findValidToken(db, input.token, 'reset');
      const row = found ? getUserById(db, found.user_id) : undefined;
      if (!found || !row || !row.is_active || isPending(row)) throw resetLinkGone();
      deleteUserTokens(db, row.id);
      deleteUserSessions(db, row.id);
      return updateUser(db, row.id, { passwordHash, mustChangePassword: false, lastLoginAt: nowIso() });
    });
    const user = complete.immediate();

    ctx.events.disconnectUser(user.id);
    startSession(req, res, user.id);
    res.json({ user: toUser(user, { includePrivate: user.role === 'admin' }) });
  });

  return router;
}
