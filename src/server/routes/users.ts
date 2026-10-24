import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { parse, parseId, zColor, zEmail, zName, zPassword, zRole, zTitle } from '../lib/validation.js';
import {
  countActiveAdmins,
  deleteUser,
  getUserByEmail,
  getUserById,
  insertUser,
  isPending,
  listUsers,
  toUser,
  updateUser,
  type UserRow,
} from '../repos/users.js';
import { INVITE_METHODS, type CreatedUserResponse, type InviteResponse } from '../../shared/types.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';
import { generateTemporaryPassword, hashPassword } from '../auth/password.js';
import { deleteUserSessions } from '../auth/sessions.js';
import { deleteUserTokens, inviteStatuses } from '../auth/tokens.js';
import { issueInvitation, publicBaseUrl, sendPasswordResetLink } from '../services/access.js';

const createSchema = z.object({
  name: zName,
  email: zEmail,
  title: zTitle.optional(),
  role: zRole.default('member'),
  color: zColor.optional(),
  /** How the person gets access: an emailed invitation, an invitation link to share, or a temporary password. */
  invite: z.enum(INVITE_METHODS, 'Choose email, link or password').default('password'),
  /** With invite "password": the temporary password to use. Leave empty to have one generated. */
  password: zPassword.optional(),
});

const updateSchema = z.object({
  name: zName.optional(),
  email: zEmail.optional(),
  title: zTitle.optional(),
  role: zRole.optional(),
  color: zColor.optional(),
  isActive: z.boolean().optional(),
});

const deliverySchema = z.object({
  /** Email the link; otherwise it's returned so the admin can share it (or, for resets, a temporary password is made). */
  sendEmail: z.boolean().default(false),
});

export function usersRouter(ctx: AppContext): Router {
  const router = Router();
  const { db, events, mailer } = ctx;

  const loadUser = (rawId: unknown): UserRow => {
    const user = getUserById(db, parseId(rawId, 'user id'));
    if (!user) throw notFound('User');
    return user;
  };

  /** A person as admins see them, including the state of their invitation. */
  const forAdmin = (row: UserRow) => toUser(row, { includePrivate: true, invite: inviteStatuses(db, row.id).get(row.id) ?? null });

  const requireEmail = () => {
    if (!mailer.enabled) {
      throw badRequest("Email isn't set up on this server. Share an invite link instead, or set up email (see “Email” in the README).");
    }
  };

  /** The team directory. Everyone can see it (needed for assigning work). */
  router.get('/', requireAuth, (req, res) => {
    const includePrivate = req.user!.role === 'admin';
    const invites = includePrivate ? inviteStatuses(db) : undefined;
    res.json({ users: listUsers(db).map((u) => toUser(u, { includePrivate, invite: invites?.get(u.id) ?? null })) });
  });

  /**
   * Admins add people. They either get an invitation (emailed, or a link the
   * admin shares) and choose their own password, or a temporary password that
   * the admin passes on and that must be changed at the first sign-in.
   */
  router.post('/', requireAdmin, async (req, res) => {
    const input = parse(createSchema, req.body);
    if (getUserByEmail(db, input.email)) {
      throw conflict('Someone with this email address already has an account.', { email: 'Already in use' });
    }
    if (input.invite === 'email') requireEmail();

    const usePassword = input.invite === 'password';
    const temporaryPassword = usePassword && !input.password ? generateTemporaryPassword() : undefined;
    const user = insertUser(db, {
      email: input.email,
      name: input.name,
      title: input.title,
      role: input.role,
      color: input.color,
      // Invited people have no password until they accept the invitation.
      passwordHash: usePassword ? await hashPassword(input.password ?? temporaryPassword!) : '',
      mustChangePassword: usePassword,
    });

    const body: CreatedUserResponse = { user: toUser(user, { includePrivate: true }) };
    if (temporaryPassword) body.temporaryPassword = temporaryPassword;
    if (!usePassword) {
      const sendEmail = input.invite === 'email';
      const result = await issueInvitation(ctx, { user, invitedBy: req.user!, baseUrl: publicBaseUrl(ctx, req), sendEmail });
      if (sendEmail) body.emailed = result.emailed;
      // Return the link when it was asked for, or when the email failed so the admin can send it another way.
      if (!result.emailed) body.inviteUrl = result.url;
      if (result.emailError) body.emailError = result.emailError;
      body.user = forAdmin(user);
    }
    events.broadcast({ entity: 'user', action: 'created', id: user.id, actorId: req.user!.id });
    res.status(201).json(body);
  });

  router.patch('/:id', requireAdmin, (req, res) => {
    const target = loadUser(req.params.id);
    const input = parse(updateSchema, req.body);
    const emailChanged = input.email !== undefined && input.email !== target.email.toLowerCase();

    if (emailChanged) {
      const existing = getUserByEmail(db, input.email!);
      if (existing && existing.id !== target.id) {
        throw conflict('Someone with this email address already has an account.', { email: 'Already in use' });
      }
    }

    // Never leave the system without an active admin who can sign in.
    const losesAdmin =
      target.role === 'admin' &&
      target.is_active === 1 &&
      !isPending(target) &&
      ((input.role !== undefined && input.role !== 'admin') || input.isActive === false);
    if (losesAdmin && countActiveAdmins(db) <= 1) {
      throw badRequest('There must always be at least one active admin. Make someone else an admin first.');
    }
    if (target.id === req.user!.id && input.isActive === false) {
      throw badRequest("You can't deactivate your own account.");
    }

    const user = updateUser(db, target.id, input);
    if (input.isActive === false) {
      deleteUserSessions(db, target.id);
      events.disconnectUser(target.id);
    }
    // Links sent to an old address, or to someone who was just deactivated, stop working.
    if (input.isActive === false || emailChanged) deleteUserTokens(db, target.id);
    events.broadcast({ entity: 'user', action: 'updated', id: user.id, actorId: req.user!.id });
    res.json({ user: forAdmin(user) });
  });

  /** Sends a new invitation to someone who hasn't joined yet. Earlier invitation links stop working. */
  router.post('/:id/invite', requireAdmin, async (req, res) => {
    const target = loadUser(req.params.id);
    const { sendEmail } = parse(deliverySchema, req.body);
    if (!isPending(target)) {
      throw badRequest(`${target.name} has already joined. To help them sign in, reset their password instead.`);
    }
    if (!target.is_active) throw badRequest(`Reactivate ${target.name} before sending a new invitation.`);
    if (sendEmail) requireEmail();

    const result = await issueInvitation(ctx, { user: target, invitedBy: req.user!, baseUrl: publicBaseUrl(ctx, req), sendEmail });
    const body: InviteResponse = { expiresAt: result.expiresAt };
    if (sendEmail) body.emailed = result.emailed;
    if (!result.emailed) body.inviteUrl = result.url;
    if (result.emailError) body.emailError = result.emailError;
    events.broadcast({ entity: 'user', action: 'updated', id: target.id, actorId: req.user!.id });
    res.json(body);
  });

  /** Cancels an invitation nobody accepted yet. People who have joined are deactivated instead, which keeps their history. */
  router.delete('/:id', requireAdmin, (req, res) => {
    const target = loadUser(req.params.id);
    if (!isPending(target)) {
      throw badRequest(
        `Only invitations that haven't been accepted can be cancelled. To remove ${target.name}'s access, deactivate the account.`,
      );
    }
    deleteUser(db, target.id);
    events.broadcast({ entity: 'user', action: 'deleted', id: target.id, actorId: req.user!.id });
    res.status(204).end();
  });

  /**
   * Helps someone who can't sign in: either emails them a link to choose a new
   * password, or sets a temporary password and signs them out everywhere.
   */
  router.post('/:id/reset-password', requireAdmin, async (req, res) => {
    const target = loadUser(req.params.id);
    const { sendEmail } = parse(deliverySchema, req.body);
    if (target.id === req.user!.id) {
      throw badRequest('To change your own password, use your account settings.');
    }
    if (isPending(target)) {
      throw badRequest(`${target.name} hasn't accepted the invitation yet. Send a new invitation instead.`);
    }

    if (sendEmail) {
      requireEmail();
      if (!target.is_active) throw badRequest(`Reactivate ${target.name} first.`);
      try {
        await sendPasswordResetLink(ctx, { user: target, requestedBy: req.user!, baseUrl: publicBaseUrl(ctx, req) });
      } catch (error) {
        throw new HttpError(502, `The reset link couldn't be emailed. ${error instanceof Error ? error.message : ''}`.trim());
      }
      res.json({ emailed: true });
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    updateUser(db, target.id, { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true });
    deleteUserSessions(db, target.id);
    deleteUserTokens(db, target.id, 'reset');
    events.disconnectUser(target.id);
    res.json({ temporaryPassword });
  });

  return router;
}
