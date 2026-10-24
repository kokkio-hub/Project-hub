import { RESET_LINK_MINUTES } from '../../shared/types.js';

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
  appName: string;
  /** Preview text shown next to the subject in most inboxes. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  notes: string[];
}

function render(layout: Layout): { html: string; text: string } {
  const e = escapeHtml;
  const appName = oneLine(layout.appName);
  const paragraphs = layout.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#33322f;">${e(p)}</p>`)
    .join('\n');
  const notes = layout.notes
    .map((p) => `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#6f6e69;">${e(p)}</p>`)
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
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6f6e69;">If the button doesn't work, copy this address into your browser:<br>
         <a href="${e(layout.button.url)}" style="color:${ACCENT};word-break:break-all;">${e(layout.button.url)}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
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
      </td></tr>
      ${button}
      <tr><td style="padding:0 32px 28px;">
        <div style="border-top:1px solid #eeede8;padding-top:16px;">
          ${notes}
          ${fallback}
        </div>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:#898781;">Sent by ${e(appName)}</p>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    layout.heading,
    '',
    ...layout.paragraphs.flatMap((p) => [p, '']),
    ...(layout.button ? [`${layout.button.label}:`, layout.button.url, ''] : []),
    ...layout.notes,
    '',
    `— ${appName}`,
    '',
  ].join('\n');

  return { html, text };
}

export function inviteEmail(input: {
  appName: string;
  url: string;
  inviteeName: string;
  email: string;
  inviterName: string | null;
  days: number;
}): EmailContent {
  const { appName, url, email, days } = input;
  const inviter = input.inviterName ? oneLine(input.inviterName) : null;
  const subject = oneLine(inviter ? `${inviter} invited you to ${appName}` : `You're invited to ${appName}`);
  return {
    subject,
    ...render({
      appName,
      preheader: `Choose a password to join ${appName}.`,
      heading: `Join ${appName}`,
      paragraphs: [
        `Hi ${firstName(input.inviteeName)},`,
        `${inviter ?? 'Your team'} invited you to ${appName}, where the team plans and tracks its projects. Choose a password to join. You'll sign in with ${email}.`,
      ],
      button: { label: 'Accept invitation', url },
      notes: [`This link works for ${days} ${days === 1 ? 'day' : 'days'} and can be used once.`, "Weren't expecting this? You can ignore this email."],
    }),
  };
}

export function resetEmail(input: {
  appName: string;
  url: string;
  name: string;
  email: string;
  /** Name of the admin who sent the link; null when the person asked for it themselves. */
  requestedBy: string | null;
}): EmailContent {
  const { appName, url, email } = input;
  const admin = input.requestedBy ? oneLine(input.requestedBy) : null;
  return {
    subject: oneLine(`Reset your ${appName} password`),
    ...render({
      appName,
      preheader: `Choose a new password for ${appName}.`,
      heading: 'Choose a new password',
      paragraphs: [
        `Hi ${firstName(input.name)},`,
        admin
          ? `${admin} sent you a link to choose a new password for ${appName}. You sign in with ${email}.`
          : `We received a request to reset the password for ${email} on ${appName}.`,
      ],
      button: { label: 'Choose a new password', url },
      notes: [
        `This link works for ${RESET_LINK_MINUTES} minutes and can be used once.`,
        admin
          ? 'Your current password keeps working until you choose a new one.'
          : "Didn't ask for this? You can ignore this email. Your password won't change.",
      ],
    }),
  };
}

export function testEmail(appName: string): EmailContent {
  return {
    subject: oneLine(`Test email from ${appName}`),
    ...render({
      appName,
      preheader: 'Email is set up correctly.',
      heading: 'Email is working',
      paragraphs: [
        `This is a test message from ${appName}. If you're reading it, invitations and password reset emails will arrive too.`,
      ],
      notes: ['You received this because someone ran the send-test-email command on the server.'],
    }),
  };
}
