import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import {
  PASSWORD_MIN_LENGTH,
  RESET_LINK_MINUTES,
  type CreatedUserResponse,
  type InviteMethod,
  type User,
  type UserRole,
} from '../../../shared/types';
import { ApiError } from '../../api/client';
import { useAppStatus, useCreateUser, useResetPassword, useUpdateUser } from '../../api/queries';
import { ErrorNotice, Spinner, useToast } from '../../components/Feedback';
import { StatusGlyph } from '../../components/Icons';
import { Field, PasswordInput } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { firstName, formatDate, localDateOf } from '../../lib/format';
import { N_, t, tx } from '../../i18n';

/** Whether this server can send email (invitations, reset links). */
export function useEmailEnabled(): boolean {
  return useAppStatus().data?.emailEnabled ?? false;
}

/** Add a person (admin only), or edit someone's name, email, title and role. */
export function UserFormModal({
  open,
  onClose,
  user,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  user?: User;
  onCreated?: (result: CreatedUserResponse) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={user ? t('Edit {name}', { name: user.name }) : t('Add a team member')}>
      {open && <UserForm user={user} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

const ACCESS_OPTIONS: { value: InviteMethod; title: string; description: string }[] = [
  {
    value: 'email',
    title: N_('Email an invitation'),
    description: N_('They get an email with a link to join and choose their own password.'),
  },
  {
    value: 'link',
    title: N_('Share an invite link'),
    description: N_('You get a link to send them yourself, for example in a chat message.'),
  },
  {
    value: 'password',
    title: N_('Set a temporary password'),
    description: N_('You pass it on. They choose their own password when they first sign in.'),
  },
];

function UserForm({
  user,
  onClose,
  onCreated,
}: {
  user?: User;
  onClose: () => void;
  onCreated?: (result: CreatedUserResponse) => void;
}) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const toast = useToast();
  const emailEnabled = useEmailEnabled();
  const mutation = user ? update : create;
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    title: user?.title ?? '',
    role: user?.role ?? ('member' as UserRole),
    access: (emailEnabled ? 'email' : 'link') as InviteMethod,
    password: '',
  });
  const fields = mutation.error instanceof ApiError ? mutation.error.fields : {};
  // Clear a server error as soon as the form is edited again.
  const errorShown = mutation.error !== null;
  const resetMutation = mutation.reset;
  useEffect(() => {
    if (errorShown) resetMutation();
  }, [form]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (user) {
      update.mutate(
        { id: user.id, patch: { name: form.name, email: form.email, title: form.title, role: form.role } },
        {
          onSuccess: (updated) => {
            const newAddress = updated.email !== user.email;
            toast.success(
              user.invitePending && newAddress
                ? t('Changes saved. The earlier invitation no longer works, so send a new one.')
                : t('Changes saved'),
            );
            onClose();
          },
        },
      );
      return;
    }
    create.mutate(
      {
        name: form.name,
        email: form.email,
        title: form.title,
        role: form.role,
        invite: form.access,
        password: form.access === 'password' && form.password ? form.password : undefined,
      },
      {
        onSuccess: (result) => {
          onClose();
          onCreated?.(result);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body stack" style={{ gap: 14 }}>
        {mutation.error && !Object.keys(fields).length && <ErrorNotice error={mutation.error} />}
        <Field label={t('Full name')} htmlFor="user-name" error={fields.name}>
          <input id="user-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('Work email')} htmlFor="user-email" error={fields.email} hint={t('They sign in with this address.')}>
          <input
            id="user-email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field label={t('Job title')} htmlFor="user-title" error={fields.title}>
          <input
            id="user-title"
            className="input"
            value={form.title}
            placeholder={t('Optional, e.g. Designer')}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <fieldset className="plain-fieldset field">
          <legend className="field-label">{t('Role')}</legend>
          <div className="radio-cards">
            <label className="radio-card">
              <input type="radio" name="role" checked={form.role === 'member'} onChange={() => setForm({ ...form, role: 'member' })} />
              <div>
                <strong>{t('Member')}</strong>
                <span>{t('Works on projects and tasks.')}</span>
              </div>
            </label>
            <label className="radio-card">
              <input type="radio" name="role" checked={form.role === 'admin'} onChange={() => setForm({ ...form, role: 'admin' })} />
              <div>
                <strong>{t('Admin')}</strong>
                <span>{t('Also manages people and all projects.')}</span>
              </div>
            </label>
            <label className="radio-card">
              <input type="radio" name="role" checked={form.role === 'guest'} onChange={() => setForm({ ...form, role: 'guest' })} />
              <div>
                <strong>{t('Guest')}</strong>
                <span>{t('Someone from outside, like a client. Only sees projects you add them to; can read and comment.')}</span>
              </div>
            </label>
          </div>
        </fieldset>
        {!user && (
          <fieldset className="plain-fieldset field">
            <legend className="field-label">{t('How they get access')}</legend>
            <div className="radio-cards stacked">
              {ACCESS_OPTIONS.map((option) => {
                const unavailable = option.value === 'email' && !emailEnabled;
                return (
                  <label key={option.value} className="radio-card">
                    <input
                      type="radio"
                      name="access"
                      checked={form.access === option.value}
                      disabled={unavailable}
                      onChange={() => setForm({ ...form, access: option.value })}
                    />
                    <div>
                      <strong>{t(option.title)}</strong>
                      <span>
                        {unavailable ? t('Not available yet: email isn’t set up on this server (see “Email” in the README).') : t(option.description)}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
            {form.access === 'password' && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                <PasswordInput
                  aria-label={t('Temporary password')}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                  placeholder={t('Leave empty to generate one')}
                />
                {fields.password ? (
                  <span className="field-error">{fields.password}</span>
                ) : (
                  <span className="field-hint">{t('Type one (at least {count} characters) or leave it empty and we’ll make one up.', {
                    count: PASSWORD_MIN_LENGTH,
                  })}</span>
                )}
              </div>
            )}
          </fieldset>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending || !form.name.trim() || !form.email.trim()}
        >
          {mutation.isPending && <Spinner size={16} />}
          {user ? t('Save changes') : form.access === 'email' ? t('Send invitation') : t('Add person')}
        </button>
      </div>
    </form>
  );
}

/** A read-only value with a copy button. Falls back to selecting the text where the clipboard is blocked (plain HTTP). */
function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  return (
    <div className="copy-field">
      <input
        ref={inputRef}
        className="input"
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn" onClick={copy}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
        {copied ? t('Copied') : t('Copy')}
      </button>
    </div>
  );
}

export interface InviteLinkInfo {
  name: string;
  email: string;
  url: string;
  expiresAt?: string;
  /** Why the invitation email couldn't be sent, when that was the plan. */
  emailError?: string;
  /** True right after adding the person; false when a new link replaced an earlier invitation. */
  added: boolean;
}

/** Shows an invitation link for the admin to pass on themselves. */
export function InviteLinkDialog({ info, onClose }: { info: InviteLinkInfo | null; onClose: () => void }) {
  return (
    <Modal
      open={info !== null}
      onClose={onClose}
      title={info?.added ? t('{name} has been added', { name: info.name }) : t('Invite link for {name}', { name: info?.name ?? '' })}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('Done')}
        </button>
      }
    >
      {info && (
        <div className="modal-body stack" style={{ gap: 14 }}>
          {info.emailError && (
            <div className="alert alert-warning" role="alert">
              <StatusGlyph tone="warning" size={16} />
              <span>
                {t('The invitation email couldn’t be sent. {emailError} You can send {name} the link below yourself.', {
                  emailError: info.emailError,
                  name: firstName(info.name),
                })}
              </span>
            </div>
          )}
          <p className="secondary">
            {tx('Send this link to {name}, for example in a direct message. It lets them choose a password and sign in as {email}.', {
              name: firstName(info.name),
              email: <strong style={{ color: 'var(--text)' }}>{info.email}</strong>,
            })}
            {info.expiresAt && ` ${t('It can be used once, until {date}.', { date: formatDate(localDateOf(info.expiresAt)) })}`}
          </p>
          <CopyField value={info.url} label={t('Invite link')} />
          <p className="field-hint">
            {t('Anyone who has this link can join as {name}, so only send it to them.', {
              name: firstName(info.name),
            })}
            {!info.added && ` ${t('Earlier invitation links no longer work.')}`}
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Admin resets someone's password: by emailing them a link, or by making a temporary password. */
export function ResetPasswordDialog({
  user,
  onClose,
  onTemporaryPassword,
}: {
  user: User | null;
  onClose: () => void;
  onTemporaryPassword: (user: User, password: string) => void;
}) {
  return (
    <Modal open={user !== null} onClose={onClose} title={t('Reset {name}’s password', { name: user?.name ?? '' })}>
      {user && <ResetPasswordForm user={user} onClose={onClose} onTemporaryPassword={onTemporaryPassword} />}
    </Modal>
  );
}

function ResetPasswordForm({
  user,
  onClose,
  onTemporaryPassword,
}: {
  user: User;
  onClose: () => void;
  onTemporaryPassword: (user: User, password: string) => void;
}) {
  const reset = useResetPassword();
  const toast = useToast();
  const emailEnabled = useEmailEnabled();
  const [method, setMethod] = useState<'email' | 'password'>(emailEnabled ? 'email' : 'password');
  const first = firstName(user.name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    reset.mutate(
      { id: user.id, sendEmail: method === 'email' },
      {
        onSuccess: (result) => {
          onClose();
          if (result.temporaryPassword) onTemporaryPassword(user, result.temporaryPassword);
          else toast.success(t('Reset link emailed to {email}', { email: user.email }));
        },
      },
    );
  };

  const temporaryDescription = t('Their current password stops working now and they’re signed out everywhere. You pass the new one on.');

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body stack" style={{ gap: 14 }}>
        {reset.error && <ErrorNotice error={reset.error} />}
        {emailEnabled ? (
          <div className="radio-cards stacked" role="radiogroup" aria-label={t('How to reset the password')}>
            <label className="radio-card">
              <input
                type="radio"
                name="reset-method"
                checked={method === 'email'}
                onChange={() => {
                  setMethod('email');
                  reset.reset();
                }}
              />
              <div>
                <strong>{t('Email a reset link')}</strong>
                <span>
                  {t('{name} chooses a new password. The current one keeps working until then. The link works for {minutes} minutes.', {
                    name: first,
                    minutes: RESET_LINK_MINUTES,
                  })}
                </span>
              </div>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="reset-method"
                checked={method === 'password'}
                onChange={() => {
                  setMethod('password');
                  reset.reset();
                }}
              />
              <div>
                <strong>{t('Set a temporary password')}</strong>
                <span>{temporaryDescription}</span>
              </div>
            </label>
          </div>
        ) : (
          <p className="secondary">{temporaryDescription}</p>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={reset.isPending}>
          {reset.isPending && <Spinner size={16} />}
          {method === 'email' ? t('Send reset link') : t('Reset password')}
        </button>
      </div>
    </form>
  );
}

/** Shows a one-time temporary password with a copy button. */
export function TemporaryPasswordDialog({
  info,
  onClose,
}: {
  info: { name: string; email: string; password: string; reset: boolean } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. plain HTTP); the password stays visible to copy by hand.
    }
  };
  return (
    <Modal
      open={info !== null}
      onClose={onClose}
      title={info?.reset ? t('New temporary password') : t('{name} has been added', { name: info?.name ?? '' })}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('Done')}
        </button>
      }
    >
      {info && (
        <div className="modal-body stack" style={{ gap: 14 }}>
          <p className="secondary">
            {tx('Give {name} this temporary password in person or through a private channel. They sign in with {strong} and then choose their own password.', {
              name: info.name,
              strong: <strong style={{ color: 'var(--text)' }}>{info.email}</strong>,
            })}
          </p>
          <div className="temp-password">
            <KeyRound size={18} aria-hidden className="muted" />
            <code>{info.password}</code>
            <button type="button" className="btn btn-sm" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t('Copied') : t('Copy')}
            </button>
          </div>
          <div className="alert alert-warning">
            <KeyRound size={16} aria-hidden />
            {t('This password won’t be shown again. If it gets lost, reset it from the Team page.')}
          </div>
        </div>
      )}
    </Modal>
  );
}
