import type { Request } from 'express';
import type { AppContext } from '../context.js';
import { deleteToken, issueToken, markTokenEmailed } from '../auth/tokens.js';
import { inviteEmail, resetEmail } from '../lib/emails.js';
import type { UserRow } from '../repos/users.js';
import { RESET_LINK_MINUTES } from '../../shared/types.js';

/**
 * Invitation and password reset links: creating them, and emailing them.
 */

export interface LinkResult {
  url: string;
  expiresAt: string;
  emailed: boolean;
  /** Why the email couldn't be sent (only when sending was attempted and failed). */
  emailError?: string;
}

type Sender = Pick<UserRow, 'id' | 'name'>;

/**
 * The address that links in emails point to: APP_URL when it is set, otherwise
 * the address the admin is using right now. Only use the fallback for requests
 * from signed-in admins: for anyone else, a forged Host header could make a
 * reset link point to another site.
 */
export function publicBaseUrl(ctx: AppContext, req: Request): string {
  if (ctx.config.appUrl) return ctx.config.appUrl;
  return `${req.protocol}://${req.get('host') ?? `localhost:${ctx.config.port}`}`;
}

/** Creates a new invitation link for someone who hasn't joined yet, and emails it if asked. Older links stop working. */
export async function issueInvitation(
  ctx: AppContext,
  input: { user: UserRow; invitedBy: Sender | null; baseUrl: string; sendEmail: boolean },
): Promise<LinkResult> {
  const { db, config, mailer } = ctx;
  const { user } = input;
  const { token, expiresAt } = issueToken(db, {
    userId: user.id,
    purpose: 'invite',
    ttlMs: config.inviteTtlDays * 86_400_000,
    createdBy: input.invitedBy?.id ?? null,
  });
  // The token goes in the #fragment, which browsers never send to servers or proxies (so it stays out of logs).
  const url = `${input.baseUrl}/invite#${token}`;
  if (!input.sendEmail) return { url, expiresAt, emailed: false };

  try {
    await mailer.send({
      to: user.email,
      ...inviteEmail({
        appName: config.appName,
        url,
        inviteeName: user.name,
        email: user.email,
        inviterName: input.invitedBy?.name ?? null,
        days: config.inviteTtlDays,
      }),
    });
    markTokenEmailed(db, token);
    return { url, expiresAt, emailed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Couldn't email the invitation to ${user.email}: ${message}`);
    return { url, expiresAt, emailed: false, emailError: message };
  }
}

/** Emails a link to choose a new password. The current password keeps working until the link is used. */
export async function sendPasswordResetLink(
  ctx: AppContext,
  input: { user: UserRow; requestedBy: Sender | null; baseUrl: string },
): Promise<void> {
  const { db, config, mailer } = ctx;
  const { user } = input;
  const { token } = issueToken(db, {
    userId: user.id,
    purpose: 'reset',
    ttlMs: RESET_LINK_MINUTES * 60_000,
    createdBy: input.requestedBy?.id ?? null,
  });
  const url = `${input.baseUrl}/reset-password#${token}`;
  try {
    await mailer.send({
      to: user.email,
      ...resetEmail({ appName: config.appName, url, name: user.name, email: user.email, requestedBy: input.requestedBy?.name ?? null }),
    });
    markTokenEmailed(db, token);
  } catch (error) {
    // Nobody received the link, so don't leave it lying around.
    deleteToken(db, token);
    throw error;
  }
}
