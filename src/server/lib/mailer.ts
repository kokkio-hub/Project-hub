import { createTransport } from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends email. The rest of the app only talks to this interface, so tests can swap in a fake. */
export interface Mailer {
  /** True when outgoing email is set up. */
  readonly enabled: boolean;
  /** Where mail goes, for log messages, e.g. "smtp.example.com:587". */
  readonly description: string;
  send(message: MailMessage): Promise<void>;
  /** Connects and signs in to the mail server without sending anything. */
  verify(): Promise<void>;
}

/** A sending failure with a message that is safe and useful to show an admin. */
export class MailError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MailError';
  }
}

const NOT_SET_UP = 'Email is not set up on this server.';

const disabledMailer: Mailer = {
  enabled: false,
  description: 'not set up',
  send: async () => {
    throw new MailError(NOT_SET_UP);
  },
  verify: async () => {
    throw new MailError(NOT_SET_UP);
  },
};

/** Turns nodemailer's errors into a short explanation. Never includes credentials. */
export function explainMailError(error: unknown, server: string): string {
  const e = (error ?? {}) as { code?: string; responseCode?: number; response?: string; message?: string };
  const response = e.response ? e.response.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  switch (e.code) {
    case 'EAUTH':
    case 'ENOAUTH':
      return `The mail server at ${server} didn't accept the username or password. Check SMTP_USER and SMTP_PASSWORD.`;
    case 'ETLS':
    case 'EREQUIRETLS':
      return `Couldn't set up a secure connection with ${server}. Port 465 needs SMTP_SECURE=true; port 587 needs SMTP_SECURE=false.`;
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'ETIMEDOUT':
    case 'EDNS':
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
      return `Couldn't connect to the mail server at ${server}. Check SMTP_HOST and SMTP_PORT, and that this server may connect to it.`;
    case 'EENVELOPE':
      return `The mail server refused the sender or recipient address${response ? `: ${response}` : '.'}`;
  }
  if (e.responseCode && e.responseCode >= 400) {
    return `The mail server refused the message${response ? `: ${response}` : ` (code ${e.responseCode}).`}`;
  }
  return `Sending failed: ${(e.message ?? String(error)).slice(0, 200)}`;
}

export interface MailerOptions {
  /** For tests: the fetch function and API address used to reach Resend. */
  fetch?: typeof fetch;
  resendUrl?: string;
}

export function createMailer(config: Config, options: MailerOptions = {}): Mailer {
  const { smtp, mailFrom, resendApiKey } = config;
  if (resendApiKey && mailFrom) return createResendMailer(resendApiKey, mailFrom, options);
  if (!smtp || !mailFrom) return disabledMailer;

  const server = `${smtp.host}:${smtp.port}`;
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
    // Fail within seconds rather than the default minutes, so the person who clicked "Invite" gets an answer.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    enabled: true,
    description: server,
    async send(message) {
      try {
        await transport.sendMail({ from: mailFrom, ...message, headers: { 'Auto-Submitted': 'auto-generated' } });
      } catch (error) {
        throw new MailError(explainMailError(error, server), { cause: error });
      }
    },
    async verify() {
      try {
        await transport.verify();
      } catch (error) {
        throw new MailError(explainMailError(error, server), { cause: error });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Resend: email over an HTTPS API, for hosts that block outgoing mail ports
// (Railway's Free and Hobby plans, for example). https://resend.com/docs
// ---------------------------------------------------------------------------

const RESEND_URL = 'https://api.resend.com';
const RESEND_TIMEOUT_MS = 15_000;

interface ResendErrorBody {
  name?: string;
  message?: string;
}

function formatFrom(from: NonNullable<Config['mailFrom']>): string {
  if (typeof from === 'string') return from;
  const name = /[",<>@()[\]:;\\]/.test(from.name) ? `"${from.name.replace(/["\\]/g, '\\$&')}"` : from.name;
  return `${name} <${from.address}>`;
}

/** Turns a Resend API error into a short explanation for an admin. Never includes the API key. */
export function explainResendError(status: number, body: ResendErrorBody | null): string {
  const message = (body?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const name = body?.name ?? '';
  if (/testing emails to your own email address/i.test(message)) {
    return 'Resend only delivers to your own address until you verify a domain. Verify your domain in Resend and use an address on it in MAIL_FROM.';
  }
  if (/domain is not verified/i.test(message)) {
    return "The domain in MAIL_FROM isn't verified in Resend. Verify it in Resend, or use an address on a domain you verified.";
  }
  if (name === 'missing_api_key' || /api key is invalid|api key is not active/i.test(message)) {
    return "Resend didn't accept the API key. Check RESEND_API_KEY.";
  }
  if (status === 429 || name === 'rate_limit_exceeded') {
    return 'Resend is limiting how fast emails can be sent. Try again in a moment.';
  }
  return `Resend refused the message${message ? `: ${message}` : ` (HTTP ${status}).`}`;
}

function createResendMailer(apiKey: string, from: NonNullable<Config['mailFrom']>, options: MailerOptions): Mailer {
  const doFetch = options.fetch ?? fetch;
  const base = (options.resendUrl ?? RESEND_URL).replace(/\/$/, '');

  const call = async (path: string, init: RequestInit): Promise<{ status: number; body: ResendErrorBody | null }> => {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      throw new MailError("Couldn't reach Resend (api.resend.com). Check this server's internet connection.", {
        cause: error,
      });
    }
    const body = (await response.json().catch(() => null)) as ResendErrorBody | null;
    return { status: response.status, body };
  };

  return {
    enabled: true,
    description: 'Resend',
    async send(message) {
      const { status, body } = await call('/emails', {
        method: 'POST',
        body: JSON.stringify({
          from: formatFrom(from),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: { 'Auto-Submitted': 'auto-generated' },
        }),
      });
      if (status < 200 || status >= 300) throw new MailError(explainResendError(status, body));
    },
    async verify() {
      // Listing domains needs a full-access key. A key restricted to sending answers
      // "restricted_api_key", which still proves the key is real.
      const { status, body } = await call('/domains', { method: 'GET' });
      if (status >= 200 && status < 300) return;
      if (body?.name === 'restricted_api_key' && !/not active/i.test(body.message ?? '')) return;
      throw new MailError(explainResendError(status, body));
    },
  };
}
