import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { nowIso } from '../db/index.js';
import { badRequest, conflict, forbidden, HttpError } from '../lib/errors.js';
import qrcode from 'qrcode-generator';
import { parse, zColor, zEmail, zName, zPassword, zTitle } from '../lib/validation.js';
import { countUsers, getUserByEmail, getUserById, insertUser, isPending, toMe, updateUser, type UserRow } from '../repos/users.js';
import { NOTIFY_EMAIL_MODES, type AppStatus, type LinkInfo, type SessionInfo, type TwoFactorChallenge } from '../../shared/types.js';
import { clearSessionCookie, requireAuth, requireSession, setSessionCookie } from '../auth/middleware.js';
import { fakeVerify, hashPassword, verifyPassword } from '../auth/password.js';
import {
  createSession,
  deleteSessionByToken,
  deleteUserSession,
  deleteUserSessions,
  describeDevice,
  listUserSessions,
  SESSION_COOKIE,
} from '../auth/sessions.js';
import { deleteUserTokens, findValidToken, latestToken } from '../auth/tokens.js';
import { generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUrl, verifyCode } from '../auth/totp.js';
import { issueInvitation, publicBaseUrl, sendPasswordResetLink } from '../services/access.js';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address'),
  password: z.string().min(1, 'Enter your password'),
});

const setupSchema = z.object({ name: zName, email: zEmail, password: zPassword });

const profileSchema = z.object({
  name: zName.optional(),
  title: zTitle.optional(),
  color: zColor.optional(),
  notifyEmail: z.enum(NOTIFY_EMAIL_MODES, 'Choose instant, daily or off').optional(),
});

const challengeSchema = z.object({
  challenge: z.string().min(20).max(200),
  code: z.string().trim().min(1, 'Enter the code from your authenticator app').max(40),
});
const passwordOnlySchema = z.object({ password: z.string().min(1, 'Enter your password') });
const codeSchema = z.object({ code: z.string().trim().min(1, 'Enter the code from your authenticator app').max(20) });
const calendarSchema = z.object({ scope: z.enum(['mine', 'all']).default('mine') });

/** A sign-in waiting for its second step works this long, for this many tries. */
const CHALLENGE_MINUTES = 5;
const CHALLENGE_ATTEMPTS = 5;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

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

  /** Password was right; the authenticator code is still to come. */
  const issueChallenge = (user: UserRow): TwoFactorChallenge => {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    db.prepare('DELETE FROM login_challenges WHERE user_id = ? OR expires_at <= ?').run(user.id, now.toISOString());
    db.prepare('INSERT INTO login_challenges (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      hash(token),
      user.id,
      now.toISOString(),
      new Date(now.getTime() + CHALLENGE_MINUTES * 60_000).toISOString(),
    );
    return { twoFactorRequired: true, challenge: token };
  };

  /** Accepts a current authenticator code (once) or an unused recovery code (once). */
  const checkSecondFactor = (user: UserRow, code: string): boolean => {
    const counter = verifyCode(user.totp_secret!, code, user.totp_last_counter);
    if (counter !== null) {
      db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(counter, user.id);
      return true;
    }
    // Six digits is an authenticator code; anything else may be a recovery code.
    if (/^\d{6}$/.test(code.replace(/\s+/g, ''))) return false;
    const used = db
      .prepare('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
      .run(nowIso(), user.id, hashRecoveryCode(code));
    return used.changes > 0;
  };

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
    const signedIn = updateUser(db, user.id, { lastLoginAt: nowIso() });
    startSession(req, res, user.id);
    res.status(201).json({ user: toMe(db, signedIn) });
  });

  router.post('/login', limiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = getUserByEmail(db, input.email);
    // People who haven't accepted their invitation have no password yet; answer exactly like an unknown address.
    const valid =
      user && !isPending(user) ? await verifyPassword(input.password, user.password_hash) : await fakeVerify(input.password);
    if (!user || !valid) throw new HttpError(401, 'Incorrect email or password.');
    if (!user.is_active) throw forbidden('This account has been deactivated. Please contact an administrator.');

    if (user.totp_secret) {
      res.json(issueChallenge(user));
      return;
    }
    const updated = updateUser(db, user.id, { lastLoginAt: nowIso() });
    startSession(req, res, user.id);
    res.json({ user: toMe(db, updated) });
  });

  /** Second sign-in step: a code from the authenticator app, or a recovery code. */
  router.post('/login/verify', limiter, (req, res) => {
    const input = parse(challengeSchema, req.body);
    const id = hash(input.challenge);
    const row = db.prepare('SELECT * FROM login_challenges WHERE id = ?').get(id) as
      | { id: string; user_id: number; expires_at: string; attempts: number }
      | undefined;
    if (!row || Date.parse(row.expires_at) <= Date.now() || row.attempts >= CHALLENGE_ATTEMPTS) {
      if (row) db.prepare('DELETE FROM login_challenges WHERE id = ?').run(id);
      throw new HttpError(410, 'This sign-in has expired. Enter your email and password again.');
    }
    const user = getUserById(db, row.user_id);
    if (!user || !user.is_active || !user.totp_secret) {
      db.prepare('DELETE FROM login_challenges WHERE id = ?').run(id);
      throw new HttpError(410, 'This sign-in has expired. Enter your email and password again.');
    }
    if (!checkSecondFactor(user, input.code)) {
      db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?').run(id);
      throw badRequest('That code isn’t right. Check the time on your phone and try again.', { code: 'Incorrect code' });
    }
    db.prepare('DELETE FROM login_challenges WHERE id = ?').run(id);
    const updated = updateUser(db, user.id, { lastLoginAt: nowIso() });
    startSession(req, res, user.id);
    res.json({ user: toMe(db, updated) });
  });

  router.post('/logout', (req, res) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token) deleteSessionByToken(db, token);
    clearSessionCookie(ctx, req, res);
    res.status(204).end();
  });

  router.get('/me', requireSession, (req, res) => {
    res.json({ user: toMe(db, req.user!) });
  });

  router.patch('/me', requireSession, (req, res) => {
    const input = parse(profileSchema, req.body);
    const user = updateUser(db, req.user!.id, input);
    ctx.events.broadcast({ entity: 'user', action: 'updated', id: user.id, actorId: user.id });
    res.json({ user: toMe(db, user) });
  });

  // -------------------------------------------------------------------------
  // Signed-in devices
  // -------------------------------------------------------------------------

  router.get('/sessions', requireSession, (req, res) => {
    const sessions: SessionInfo[] = listUserSessions(db, req.user!.id).map((s) => ({
      id: s.id,
      current: s.id === req.sessionId,
      device: describeDevice(s.user_agent),
      ip: s.ip,
      createdAt: s.created_at,
      lastActiveAt: s.last_active_at ?? s.last_seen_at,
    }));
    res.json({ sessions });
  });

  router.delete('/sessions/:id', requireSession, (req, res) => {
    const id = String(req.params.id);
    if (id === req.sessionId) throw badRequest('To sign out on this device, use “Sign out”.');
    if (!deleteUserSession(db, req.user!.id, id)) throw new HttpError(404, 'That session has already ended.');
    res.status(204).end();
  });

  router.post('/sessions/sign-out-others', requireSession, (req, res) => {
    deleteUserSessions(db, req.user!.id, req.sessionId);
    res.status(204).end();
  });

  // -------------------------------------------------------------------------
  // Two-factor sign-in (authenticator app)
  // -------------------------------------------------------------------------

  const confirmPassword = async (user: UserRow, password: string) => {
    if (!(await verifyPassword(password, user.password_hash))) {
      throw badRequest('Your password is incorrect.', { password: 'Incorrect password' });
    }
  };

  const freshRecoveryCodes = (userId: number): string[] => {
    const codes = generateRecoveryCodes();
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    const add = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const code of codes) add.run(userId, hashRecoveryCode(code));
    return codes;
  };

  /** Starts setting up two-factor sign-in: returns the secret and a QR code to scan. */
  router.post('/2fa/setup', requireAuth, async (req, res) => {
    const { password } = parse(passwordOnlySchema, req.body);
    const me = req.user!;
    await confirmPassword(me, password);
    if (me.totp_secret) throw badRequest('Two-factor sign-in is already on.');
    const secret = generateSecret();
    db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').run(secret, me.id);
    const url = otpauthUrl(secret, me.email, config.appName);
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    res.json({ secret, otpauthUrl: url, qrSvg: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) });
  });

  /** Confirms the first code from the app, switches two-factor on and returns recovery codes (shown once). */
  router.post('/2fa/enable', requireAuth, (req, res) => {
    const { code } = parse(codeSchema, req.body);
    const me = getUserById(db, req.user!.id)!;
    if (me.totp_secret) throw badRequest('Two-factor sign-in is already on.');
    if (!me.totp_pending_secret) throw badRequest('Start the setup again: scan a new QR code first.');
    const counter = verifyCode(me.totp_pending_secret, code, null);
    if (counter === null) throw badRequest('That code isn’t right. Check the time on your phone and try again.', { code: 'Incorrect code' });
    const recoveryCodes = db.transaction(() => {
      db.prepare(
        'UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = ?, totp_last_counter = ? WHERE id = ?',
      ).run(nowIso(), counter, me.id);
      return freshRecoveryCodes(me.id);
    })();
    // Other devices must sign in again, now with a code.
    deleteUserSessions(db, me.id, req.sessionId);
    res.json({ recoveryCodes, user: toMe(db, getUserById(db, me.id)!) });
  });

  router.post('/2fa/disable', requireAuth, async (req, res) => {
    const { password } = parse(passwordOnlySchema, req.body);
    const me = req.user!;
    await confirmPassword(me, password);
    db.transaction(() => {
      db.prepare(
        'UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?',
      ).run(me.id);
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(me.id);
    })();
    res.json({ user: toMe(db, getUserById(db, me.id)!) });
  });

  router.post('/2fa/recovery-codes', requireAuth, async (req, res) => {
    const { password } = parse(passwordOnlySchema, req.body);
    const me = req.user!;
    await confirmPassword(me, password);
    if (!me.totp_secret) throw badRequest('Turn on two-factor sign-in first.');
    const recoveryCodes = db.transaction(() => freshRecoveryCodes(me.id))();
    res.json({ recoveryCodes, user: toMe(db, getUserById(db, me.id)!) });
  });

  // -------------------------------------------------------------------------
  // Calendar feed address
  // -------------------------------------------------------------------------

  /** Creates a new secret calendar address (the old one stops working). Shown once. */
  router.post('/calendar', requireAuth, (req, res) => {
    const { scope } = parse(calendarSchema, req.body);
    const token = randomBytes(24).toString('base64url');
    db.prepare('UPDATE users SET calendar_token_hash = ?, calendar_scope = ? WHERE id = ?').run(hash(token), scope, req.user!.id);
    const base = publicBaseUrl(ctx, req);
    res.json({ url: `${base}/api/calendar/${token}.ics`, user: toMe(db, getUserById(db, req.user!.id)!) });
  });

  router.patch('/calendar', requireAuth, (req, res) => {
    const { scope } = parse(calendarSchema, req.body);
    db.prepare('UPDATE users SET calendar_scope = ? WHERE id = ?').run(scope, req.user!.id);
    res.json({ user: toMe(db, getUserById(db, req.user!.id)!) });
  });

  router.delete('/calendar', requireAuth, (req, res) => {
    db.prepare('UPDATE users SET calendar_token_hash = NULL WHERE id = ?').run(req.user!.id);
    res.json({ user: toMe(db, getUserById(db, req.user!.id)!) });
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
    res.json({ user: toMe(db, user) });
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
    res.json({ user: toMe(db, user) });
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
    // A reset link proves access to the email account, not the second factor.
    if (user.totp_secret) {
      res.json(issueChallenge(user));
      return;
    }
    startSession(req, res, user.id);
    res.json({ user: toMe(db, user) });
  });

  return router;
}
