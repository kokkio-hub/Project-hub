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
    <Modal open={open} onClose={onClose} title={user ? `Edit ${user.name}` : 'Add a team member'}>
      {open && <UserForm user={user} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

const ACCESS_OPTIONS: { value: InviteMethod; title: string; description: string }[] = [
  {
    value: 'email',
    title: 'Email an invitation',
    description: 'They get an email with a link to join and choose their own password.',
  },
  {
    value: 'link',
    title: 'Share an invite link',
    description: 'You get a link to send them yourself, for example in a chat message.',
  },
  {
    value: 'password',
    title: 'Set a temporary password',
    description: 'You pass it on. They choose their own password when they first sign in.',
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
                ? 'Changes saved. The earlier invitation no longer works, so send a new one.'
                : 'Changes saved',
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
        <Field label="Full name" htmlFor="user-name" error={fields.name}>
          <input id="user-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Work email" htmlFor="user-email" error={fields.email} hint="They sign in with this address.">
          <input
            id="user-email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field label="Job title" htmlFor="user-title" error={fields.title}>
          <input
            id="user-title"
            className="input"
            value={form.title}
            placeholder="Optional, e.g. Designer"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <fieldset className="plain-fieldset field">
          <legend className="field-label">Role</legend>
          <div className="radio-cards">
            <label className="radio-card">
              <input type="radio" name="role" checked={form.role === 'member'} onChange={() => setForm({ ...form, role: 'member' })} />
              <div>
                <strong>Member</strong>
                <span>Works on projects and tasks.</span>
              </div>
            </label>
            <label className="radio-card">
              <input type="radio" name="role" checked={form.role === 'admin'} onChange={() => setForm({ ...form, role: 'admin' })} />
              <div>
                <strong>Admin</strong>
                <span>Also manages people and all projects.</span>
              </div>
            </label>
          </div>
        </fieldset>
        {!user && (
          <fieldset className="plain-fieldset field">
            <legend className="field-label">How they get access</legend>
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
                      <strong>{option.title}</strong>
                      <span>
                        {unavailable ? 'Not available yet: email isn’t set up on this server (see “Email” in the README).' : option.description}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
            {form.access === 'password' && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                <PasswordInput
                  aria-label="Temporary password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                  placeholder="Leave empty to generate one"
                />
                {fields.password ? (
                  <span className="field-error">{fields.password}</span>
                ) : (
                  <span className="field-hint">Type one (at least {PASSWORD_MIN_LENGTH} characters) or leave it empty and we'll make one up.</span>
                )}
              </div>
            )}
          </fieldset>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending || !form.name.trim() || !form.email.trim()}
        >
          {mutation.isPending && <Spinner size={16} />}
          {user ? 'Save changes' : form.access === 'email' ? 'Send invitation' : 'Add person'}
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
        {copied ? 'Copied' : 'Copy'}
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
      title={info?.added ? `${info.name} has been added` : `Invite link for ${info?.name ?? ''}`}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {info && (
        <div className="modal-body stack" style={{ gap: 14 }}>
          {info.emailError && (
            <div className="alert alert-warning" role="alert">
              <StatusGlyph tone="warning" size={16} />
              <span>
                The invitation email couldn’t be sent. {info.emailError} You can send {firstName(info.name)} the link below
                yourself.
              </span>
            </div>
          )}
          <p className="secondary">
            Send this link to {firstName(info.name)}, for example in a direct message. It lets them choose a password and
            sign in as <strong style={{ color: 'var(--text)' }}>{info.email}</strong>.
            {info.expiresAt && ` It can be used once, until ${formatDate(localDateOf(info.expiresAt))}.`}
          </p>
          <CopyField value={info.url} label="Invite link" />
          <p className="field-hint">
            Anyone who has this link can join as {firstName(info.name)}, so only send it to them.
            {!info.added && ' Earlier invitation links no longer work.'}
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
    <Modal open={user !== null} onClose={onClose} title={`Reset ${user?.name ?? ''}'s password`}>
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
          else toast.success(`Reset link emailed to ${user.email}`);
        },
      },
    );
  };

  const temporaryDescription = `Their current password stops working now and they're signed out everywhere. You pass the new one on.`;

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body stack" style={{ gap: 14 }}>
        {reset.error && <ErrorNotice error={reset.error} />}
        {emailEnabled ? (
          <div className="radio-cards stacked" role="radiogroup" aria-label="How to reset the password">
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
                <strong>Email a reset link</strong>
                <span>
                  {first} chooses a new password. The current one keeps working until then. The link works for{' '}
                  {RESET_LINK_MINUTES} minutes.
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
                <strong>Set a temporary password</strong>
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
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={reset.isPending}>
          {reset.isPending && <Spinner size={16} />}
          {method === 'email' ? 'Send reset link' : 'Reset password'}
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
      title={info?.reset ? 'New temporary password' : `${info?.name ?? ''} has been added`}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {info && (
        <div className="modal-body stack" style={{ gap: 14 }}>
          <p className="secondary">
            Give {info.name} this temporary password in person or through a private channel. They sign in with{' '}
            <strong style={{ color: 'var(--text)' }}>{info.email}</strong> and then choose their own password.
          </p>
          <div className="temp-password">
            <KeyRound size={18} aria-hidden className="muted" />
            <code>{info.password}</code>
            <button type="button" className="btn btn-sm" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="alert alert-warning">
            <KeyRound size={16} aria-hidden />
            This password won't be shown again. If it gets lost, reset it from the Team page.
          </div>
        </div>
      )}
    </Modal>
  );
}
