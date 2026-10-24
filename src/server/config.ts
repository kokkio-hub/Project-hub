import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Path to the SQLite database file, or ":memory:". */
  databasePath: string;
  /** Folder with the built web client (served when it contains index.html). */
  clientDir: string;
  appName: string;
  sessionTtlDays: number;
  /** "auto" marks cookies Secure when the request arrived over HTTPS. */
  cookieSecure: 'auto' | boolean;
  /** Passed to Express "trust proxy". Set when running behind a reverse proxy. */
  trustProxy: boolean | number | string;
  /** Failed sign-in attempts allowed per IP address per 15 minutes. */
  loginRateLimit: number;
  /** Creates this admin on startup when the database has no users yet. */
  bootstrapAdmin: { email: string; password: string; name: string } | null;
  /** Public address people use to open the app (e.g. https://projects.example.com), for links in emails. */
  appUrl: string | null;
  /** Outgoing email server. Null when email isn't set up. */
  smtp: SmtpConfig | null;
  /**
   * API key for Resend, which sends email over HTTPS. For hosts that block
   * outgoing mail ports (Railway's Free and Hobby plans, for example). Takes
   * priority over SMTP when both are set.
   */
  resendApiKey: string | null;
  /** Sender of the emails the app sends. */
  mailFrom: string | { name: string; address: string } | null;
  /** How long invitation links work, in days. */
  inviteTtlDays: number;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** TLS from the first byte (port 465). Otherwise the connection upgrades with STARTTLS when the server offers it. */
  secure: boolean;
  user: string | null;
  password: string | null;
}

/** Loads variables from a .env file in the working directory, if there is one. */
export function loadEnvFile(file = '.env'): void {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

function parseInteger(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max} (got "${value}").`);
  }
  return n;
}

/** Keeps only the origin (scheme, host, port): the app is always served from the root of its address. */
function parseAppUrl(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`APP_URL must be a full address such as https://projects.example.com (got "${value}").`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`APP_URL must start with https:// or http:// (got "${value}").`);
  }
  return url.origin;
}

function parseSmtp(env: NodeJS.ProcessEnv): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = parseInteger('SMTP_PORT', env.SMTP_PORT, 587, 1, 65535);
  return {
    host,
    port,
    secure: parseBoolean(env.SMTP_SECURE) ?? port === 465,
    user: env.SMTP_USER?.trim() || null,
    password: env.SMTP_PASSWORD || null,
  };
}

function parseMailFrom(
  env: NodeJS.ProcessEnv,
  smtp: SmtpConfig | null,
  resendApiKey: string | null,
  appName: string,
): Config['mailFrom'] {
  if (!smtp && !resendApiKey) return null;
  const from = env.MAIL_FROM?.trim();
  if (from) return from;
  if (resendApiKey) {
    throw new Error(
      'Set MAIL_FROM to the address emails are sent from, on a domain you verified in Resend, ' +
        'for example MAIL_FROM="Project Hub <projects@yourcompany.com>".',
    );
  }
  if (smtp?.user?.includes('@')) return { name: appName, address: smtp.user };
  throw new Error(
    'Set MAIL_FROM to the address emails are sent from, for example MAIL_FROM="Project Hub <projects@yourcompany.com>".',
  );
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value.trim() === '') return false;
  const bool = parseBoolean(value);
  if (bool !== undefined) return bool;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0) return n;
  return value.trim(); // e.g. "loopback" or "10.0.0.0/8"
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development';

  const cookieSecureRaw = env.COOKIE_SECURE?.trim().toLowerCase();
  const cookieSecure = !cookieSecureRaw || cookieSecureRaw === 'auto' ? 'auto' : (parseBoolean(cookieSecureRaw) ?? 'auto');

  const adminEmail = env.ADMIN_EMAIL?.trim();
  const adminPassword = env.ADMIN_PASSWORD;
  const bootstrapAdmin =
    adminEmail && adminPassword
      ? { email: adminEmail, password: adminPassword, name: env.ADMIN_NAME?.trim() || 'Administrator' }
      : null;

  const databasePath = env.DATABASE_PATH?.trim() || path.resolve('data', 'project-hub.db');
  const appName = env.APP_NAME?.trim() || 'Project Hub';
  const smtp = parseSmtp(env);
  const resendApiKey = env.RESEND_API_KEY?.trim() || null;

  return {
    env: nodeEnv,
    port: parseInteger('PORT', env.PORT, 3000, 1, 65535),
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath: databasePath === ':memory:' ? databasePath : path.resolve(databasePath),
    clientDir: path.resolve(env.CLIENT_DIR?.trim() || path.join(import.meta.dirname, '..', 'client')),
    appName,
    sessionTtlDays: parseInteger('SESSION_TTL_DAYS', env.SESSION_TTL_DAYS, 30, 1, 365),
    cookieSecure,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    loginRateLimit: parseInteger('LOGIN_RATE_LIMIT', env.LOGIN_RATE_LIMIT, 20, 1, 100_000),
    bootstrapAdmin,
    appUrl: parseAppUrl(env.APP_URL),
    smtp,
    resendApiKey,
    mailFrom: parseMailFrom(env, smtp, resendApiKey, appName),
    inviteTtlDays: parseInteger('INVITE_TTL_DAYS', env.INVITE_TTL_DAYS, 7, 1, 90),
  };
}
