import { RESET_LINK_MINUTES } from '../../shared/types.js';
import { english, type Translator } from '../../shared/i18n/core.js';

/**
 * The emails the app sends. Every value that comes from people (names, the app
 * name) is HTML-escaped, and subjects are kept to a single line.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const ACCENT = '#256abf';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header values (like the subject) must not contain line breaks. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

function firstName(name: string): string {
  return oneLine(name).split(' ')[0] || name;
}

interface Layout {
  tr: Translator;
  appName: string;
  /** Preview text shown next to the subject in most inboxes. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  /** A list of linked lines (notifications, tasks), with an optional heading per group. */
  groups?: { title?: string; items: { text: string; url: string; meta?: string }[] }[];
  button?: { label: string; url: string };
  notes: string[];
}

function render(layout: Layout): { html: string; text: string } {
  const e = escapeHtml;
  const { tr } = layout;
  const appName = oneLine(layout.appName);
  const paragraphs = layout.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#33322f;">${e(p)}</p>`)
    .join('\n');
  const notes = layout.notes
    .map((p) => `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#6f6e69;">${e(p)}</p>`)
    .join('\n');

  const groups = (layout.groups ?? [])
    .filter((g) => g.items.length > 0)
    .map((g) => {
      const title = g.title
        ? `<p style="margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6f6e69;">${e(g.title)}</p>`
        : '';
      const rows = g.items
        .map(
          (item) => `<tr><td style="padding:9px 0;border-top:1px solid #eeede8;">
              <a href="${e(item.url)}" target="_blank" style="font-size:14px;line-height:1.45;color:#0b0b0b;text-decoration:none;">${e(item.text)}</a>
              ${item.meta ? `<div style="font-size:12px;color:#6f6e69;margin-top:2px;">${e(item.meta)}</div>` : ''}
            </td></tr>`,
        )
        .join('');
      return `${title}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;">${rows}</table>`;
    })
    .join('\n');

  const button = layout.button
    ? `<tr><td style="padding:4px 32px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="border-radius:8px;background:${ACCENT};">
              <a href="${e(layout.button.url)}" target="_blank" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">${e(layout.button.label)}</a>
            </td>
          </tr></table>
        </td></tr>`
    : '';

  const fallback = layout.button
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6f6e69;">${e(tr.t('If the button doesn’t work, copy this address into your browser:'))}<br>
         <a href="${e(layout.button.url)}" style="color:${ACCENT};word-break:break-all;">${e(layout.button.url)}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="${tr.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(oneLine(layout.heading))}</title>
</head>
<body style="margin:0;padding:0;background:#f3f3f0;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f3f0;">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e1e0d9;border-radius:12px;font-family:${FONT};">
      <tr><td style="padding:26px 32px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:22px;height:22px;border-radius:6px;background:${ACCENT};font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding-left:9px;font-size:15px;font-weight:700;color:#0b0b0b;">${e(appName)}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:18px 32px 4px;">
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#0b0b0b;">${e(layout.heading)}</h1>
        ${paragraphs}
        ${groups}
      </td></tr>
      ${button}
      <tr><td style="padding:0 32px 28px;">
        <div style="border-top:1px solid #eeede8;padding-top:16px;">
          ${notes}
          ${fallback}
        </div>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:#898781;">${e(tr.t('Sent by {app}', { app: appName }))}</p>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    layout.heading,
    '',
    ...layout.paragraphs.flatMap((p) => [p, '']),
    ...(layout.groups ?? [])
      .filter((g) => g.items.length > 0)
      .flatMap((g) => [
        ...(g.title ? [g.title.toUpperCase(), ''] : []),
        ...g.items.flatMap((item) => [`- ${item.text}${item.meta ? ` (${item.meta})` : ''}`, `  ${item.url}`]),
        '',
      ]),
    ...(layout.button ? [`${layout.button.label}:`, layout.button.url, ''] : []),
    ...layout.notes,
    '',
    `— ${appName}`,
    '',
  ].join('\n');

  return { html, text };
}

export function inviteEmail(
  input: {
    appName: string;
    url: string;
    inviteeName: string;
    email: string;
    inviterName: string | null;
    days: number;
  },
  tr: Translator = english,
): EmailContent {
  const { appName: app, url, email, days } = input;
  const inviter = input.inviterName ? oneLine(input.inviterName) : null;
  const subject = oneLine(inviter ? tr.t('{name} invited you to {app}', { name: inviter, app }) : tr.t('You’re invited to {app}', { app }));
  return {
    subject,
    ...render({
      tr,
      appName: app,
      preheader: tr.t('Choose a password to join {app}.', { app }),
      heading: tr.t('Join {app}', { app }),
      paragraphs: [
        tr.t('Hi {name},', { name: firstName(input.inviteeName) }),
        tr.t('{inviter} invited you to {app}, where the team plans and tracks its projects. Choose a password to join. You’ll sign in with {email}.', {
          inviter: inviter ?? tr.t('Your team'),
          app,
          email,
        }),
      ],
      button: { label: tr.t('Accept invitation'), url },
      notes: [
        tr.tn('This link works for {count} day and can be used once.', 'This link works for {count} days and can be used once.', days),
        tr.t('Weren’t expecting this? You can ignore this email.'),
      ],
    }),
  };
}

export function resetEmail(
  input: {
    appName: string;
    url: string;
    name: string;
    email: string;
    /** Name of the admin who sent the link; null when the person asked for it themselves. */
    requestedBy: string | null;
  },
  tr: Translator = english,
): EmailContent {
  const { appName: app, url, email } = input;
  const admin = input.requestedBy ? oneLine(input.requestedBy) : null;
  return {
    subject: oneLine(tr.t('Reset your {app} password', { app })),
    ...render({
      tr,
      appName: app,
      preheader: tr.t('Choose a new password for {app}.', { app }),
      heading: tr.t('Choose a new password'),
      paragraphs: [
        tr.t('Hi {name},', { name: firstName(input.name) }),
        admin
          ? tr.t('{admin} sent you a link to choose a new password for {app}. You sign in with {email}.', { admin, app, email })
          : tr.t('We received a request to reset the password for {email} on {app}.', { email, app }),
      ],
      button: { label: tr.t('Choose a new password'), url },
      notes: [
        tr.t('This link works for {count} minutes and can be used once.', { count: RESET_LINK_MINUTES }),
        admin
          ? tr.t('Your current password keeps working until you choose a new one.')
          : tr.t('Didn’t ask for this? You can ignore this email. Your password won’t change.'),
      ],
    }),
  };
}

export function testEmail(app: string, tr: Translator = english): EmailContent {
  return {
    subject: oneLine(tr.t('Test email from {app}', { app })),
    ...render({
      tr,
      appName: app,
      preheader: tr.t('Email is set up correctly.'),
      heading: tr.t('Email is working'),
      paragraphs: [tr.t('This is a test message from {app}. If you’re reading it, invitations and password reset emails will arrive too.', { app })],
      notes: [tr.t('You received this because someone ran the send-test-email command on the server.')],
    }),
  };
}

export interface NotificationEmailItem {
  text: string;
  url: string;
  meta?: string;
}

/**
 * Notifications by email: a few at a time ("instant") or once a day with the
 * day's due and overdue work ("daily").
 */
export function notificationsEmail(
  input: {
    appName: string;
    appUrl: string;
    name: string;
    mode: 'instant' | 'daily';
    notifications: NotificationEmailItem[];
    dueToday?: NotificationEmailItem[];
    overdue?: NotificationEmailItem[];
  },
  tr: Translator = english,
): EmailContent {
  const { appName: app, mode } = input;
  const count = input.notifications.length;
  const subject =
    mode === 'daily'
      ? tr.t('Your day in {app}', { app })
      : count === 1
        ? input.notifications[0]!.text
        : tr.t('{count} new notifications in {app}', { count, app });
  return {
    subject: oneLine(subject.length > 140 ? `${subject.slice(0, 139)}…` : subject),
    ...render({
      tr,
      appName: app,
      preheader: mode === 'daily' ? tr.t('What needs your attention today.') : tr.t('New activity on your tasks.'),
      heading: mode === 'daily' ? tr.t('Good morning, {name}', { name: firstName(input.name) }) : tr.t('New activity'),
      paragraphs: mode === 'daily' ? [tr.t('Here’s what needs your attention today.')] : [],
      groups: [
        { title: tr.t('Overdue'), items: input.overdue ?? [] },
        { title: tr.t('Due today'), items: input.dueToday ?? [] },
        { title: mode === 'daily' ? tr.t('Since yesterday') : undefined, items: input.notifications },
      ],
      button: { label: tr.t('Open {app}', { app }), url: input.appUrl },
      notes: [
        mode === 'daily'
          ? tr.t('You get these emails once a day. Change this in your account settings.')
          : tr.t('You get these emails when something happens. Change this in your account settings.'),
      ],
    }),
  };
}
