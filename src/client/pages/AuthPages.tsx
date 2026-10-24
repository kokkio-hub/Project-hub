import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { MailCheck, ShieldCheck, SquareKanban } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, RESET_LINK_MINUTES, type User } from '../../shared/types';
import { ApiError, errorMessage } from '../api/client';
import { useChangePassword, useLogin, useLogout, useRequestPasswordReset, useSetup, useVerifyLogin } from '../api/queries';
import { ErrorNotice, Spinner } from '../components/Feedback';
import { Field, PasswordInput } from '../components/Form';

export function AuthCard({ appName, children }: { appName: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <main className="card auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <SquareKanban size={17} />
          </span>
          {appName}
        </div>
        {children}
      </main>
    </div>
  );
}

export function SubmitButton({ pending, children, disabled }: { pending: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending || disabled}>
      {pending && <Spinner size={16} />}
      {children}
    </button>
  );
}

/** A big round icon above a heading, for "check your email" and "link expired" screens. */
export function AuthIcon({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'warning' }) {
  return (
    <span className={`auth-icon ${tone === 'warning' ? 'is-warning' : ''}`} aria-hidden>
      {children}
    </span>
  );
}

/** Second sign-in step for accounts with two-factor sign-in. */
export function TwoFactorStep({ challenge, onBack, onDone }: { challenge: string; onBack: () => void; onDone?: () => void }) {
  const verify = useVerifyLogin();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const fields = verify.error instanceof ApiError ? verify.error.fields : {};
  const expired = verify.error instanceof ApiError && verify.error.status === 410;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate({ challenge, code }, { onSuccess: () => onDone?.() });
  };

  return (
    <>
      <AuthIcon>
        <ShieldCheck size={22} />
      </AuthIcon>
      <h1>Enter your code</h1>
      <p className="lead">
        {recovery
          ? 'Type one of the recovery codes you saved when you set up two-factor sign-in.'
          : 'Open your authenticator app and type the 6-digit code it shows for this account.'}
      </p>
      <form onSubmit={submit} noValidate>
        {verify.error && !fields.code && <ErrorNotice error={verify.error} />}
        <Field label={recovery ? 'Recovery code' : 'Code'} htmlFor="login-code" error={fields.code}>
          <input
            id="login-code"
            className="input mono code-input"
            inputMode={recovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            maxLength={recovery ? 20 : 7}
            value={code}
            onChange={(e) => {
              setCode(recovery ? e.target.value : e.target.value.replace(/[^\d ]/g, ''));
              if (verify.error) verify.reset();
            }}
            autoFocus
            disabled={expired}
          />
        </Field>
        {expired ? (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onBack}>
            Sign in again
          </button>
        ) : (
          <SubmitButton pending={verify.isPending} disabled={!code.trim()}>
            Verify and sign in
          </SubmitButton>
        )}
      </form>
      <p className="auth-footnote">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setRecovery((r) => !r);
            setCode('');
            verify.reset();
          }}
        >
          {recovery ? 'Use the code from my app instead' : 'Lost your phone? Use a recovery code'}
        </button>
        {' · '}
        <button type="button" className="link-button" onClick={onBack}>
          Back
        </button>
      </p>
    </>
  );
}

export function LoginPage({ appName, passwordResetEnabled }: { appName: string; passwordResetEnabled: boolean }) {
  const login = useLogin();
  const [searchParams, setSearchParams] = useSearchParams();
  const forgot = passwordResetEnabled && searchParams.has('forgot');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${forgot ? 'Reset password' : 'Sign in'} · ${appName}`;
  }, [appName, forgot]);

  // "Forgot password?" lives at ?forgot, so the back button returns to signing in.
  const showForgot = (show: boolean) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (show) next.set('forgot', '');
      else next.delete('forgot');
      return next;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: (result) => {
          if ('twoFactorRequired' in result) setChallenge(result.challenge);
        },
      },
    );
  };

  if (challenge) {
    return (
      <AuthCard appName={appName}>
        <TwoFactorStep
          challenge={challenge}
          onBack={() => {
            setChallenge(null);
            setPassword('');
            login.reset();
          }}
        />
      </AuthCard>
    );
  }

  if (forgot) {
    return (
      <AuthCard appName={appName}>
        <ForgotPassword email={email} onEmailChange={setEmail} onBack={() => showForgot(false)} />
      </AuthCard>
    );
  }

  return (
    <AuthCard appName={appName}>
      <h1>Sign in</h1>
      <p className="lead">Welcome back. Sign in with your work email.</p>
      <form onSubmit={submit} noValidate>
        {login.error && <ErrorNotice error={login.error} />}
        <Field label="Email" htmlFor="login-email">
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (login.error) login.reset();
            }}
            required
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="login-password">
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (login.error) login.reset();
            }}
            required
          />
        </Field>
        <SubmitButton pending={login.isPending}>Sign in</SubmitButton>
      </form>
      {passwordResetEnabled ? (
        <p className="auth-footnote">
          <button type="button" className="link-button" onClick={() => showForgot(true)}>
            Forgot your password?
          </button>
        </p>
      ) : (
        <p className="auth-footnote">Forgot your password? Ask an admin to reset it for you.</p>
      )}
    </AuthCard>
  );
}

/** Asks for a password reset link. Says the same thing whether or not the address has an account. */
function ForgotPassword({
  email,
  onEmailChange,
  onBack,
}: {
  email: string;
  onEmailChange: (email: string) => void;
  onBack: () => void;
}) {
  const request = useRequestPasswordReset();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const fields = request.error instanceof ApiError ? request.error.fields : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    request.mutate(address, { onSuccess: () => setSentTo(address) });
  };

  if (sentTo) {
    return (
      <div className="auth-message">
        <AuthIcon>
          <MailCheck size={22} />
        </AuthIcon>
        <h1>Check your email</h1>
        <p className="lead">
          If <strong>{sentTo}</strong> belongs to an account here, a link to choose a new password is on its way. The link
          works for {RESET_LINK_MINUTES} minutes.
        </p>
        <p className="auth-note">Nothing after a few minutes? Check your spam folder, or ask an admin to reset your password.</p>
        <button type="button" className="btn btn-lg btn-block" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <>
      <h1>Reset your password</h1>
      <p className="lead">Enter the email address you sign in with. We'll send you a link to choose a new password.</p>
      <form onSubmit={submit} noValidate>
        {request.error && !fields.email && <ErrorNotice error={request.error} />}
        <Field label="Email" htmlFor="forgot-email" error={fields.email}>
          <input
            id="forgot-email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              onEmailChange(e.target.value);
              if (request.error) request.reset();
            }}
            required
            autoFocus
          />
        </Field>
        <SubmitButton pending={request.isPending}>Email me a reset link</SubmitButton>
      </form>
      <p className="auth-footnote">
        <button type="button" className="link-button" onClick={onBack}>
          Back to sign in
        </button>
      </p>
    </>
  );
}

export function SetupPage({ appName }: { appName: string }) {
  const setup = useSetup();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const fields = setup.error instanceof ApiError ? setup.error.fields : {};

  useEffect(() => {
    document.title = `Set up · ${appName}`;
  }, [appName]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setup.mutate({ name: form.name, email: form.email, password: form.password });
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (setup.error) setup.reset();
    if (key === 'confirm' || key === 'password') setMismatch(false);
  };

  return (
    <AuthCard appName={appName}>
      <h1>Create the admin account</h1>
      <p className="lead">
        This is a fresh installation. The account you create now can add everyone else on your team.
      </p>
      <form onSubmit={submit} noValidate>
        {setup.error && !Object.keys(fields).length && <ErrorNotice error={setup.error} />}
        <Field label="Your name" htmlFor="setup-name" error={fields.name}>
          <input id="setup-name" className="input" value={form.name} onChange={set('name')} autoComplete="name" autoFocus />
        </Field>
        <Field label="Work email" htmlFor="setup-email" error={fields.email}>
          <input
            id="setup-email"
            className="input"
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="username"
          />
        </Field>
        <Field
          label="Password"
          htmlFor="setup-password"
          error={fields.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <PasswordInput id="setup-password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Repeat password" htmlFor="setup-confirm" error={mismatch ? "The passwords don't match." : undefined}>
          <PasswordInput id="setup-confirm" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </Field>
        <SubmitButton pending={setup.isPending}>Create account and continue</SubmitButton>
      </form>
    </AuthCard>
  );
}

/** Password change form, used both for the forced first-sign-in change and on the account page. */
export function ChangePasswordForm({ onDone, submitLabel = 'Update password' }: { onDone?: () => void; submitLabel?: string }) {
  const change = useChangePassword();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const fields = change.error instanceof ApiError ? change.error.fields : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (form.next !== form.confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate(
      { currentPassword: form.current, newPassword: form.next },
      {
        onSuccess: () => {
          setForm({ current: '', next: '', confirm: '' });
          onDone?.();
        },
      },
    );
  };

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (change.error) change.reset();
    if (key !== 'current') setMismatch(false);
  };

  return (
    <form onSubmit={submit} noValidate className="stack" style={{ gap: 16 }}>
      {change.error && !Object.keys(fields).length && <ErrorNotice error={change.error} />}
      <Field label="Current password" htmlFor="pw-current" error={fields.currentPassword}>
        <PasswordInput id="pw-current" value={form.current} onChange={set('current')} autoComplete="current-password" />
      </Field>
      <Field
        label="New password"
        htmlFor="pw-new"
        error={fields.newPassword}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. Signing in elsewhere will end after the change.`}
      >
        <PasswordInput id="pw-new" value={form.next} onChange={set('next')} autoComplete="new-password" />
      </Field>
      <Field label="Repeat new password" htmlFor="pw-confirm" error={mismatch ? "The passwords don't match." : undefined}>
        <PasswordInput id="pw-confirm" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
      </Field>
      <div>
        <button type="submit" className="btn btn-primary" disabled={change.isPending}>
          {change.isPending && <Spinner size={16} />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ForcedPasswordChangePage({ appName, user }: { appName: string; user: User }) {
  const logout = useLogout();
  useEffect(() => {
    document.title = `Choose a password · ${appName}`;
  }, [appName]);
  return (
    <AuthCard appName={appName}>
      <h1>Choose your own password</h1>
      <p className="lead">
        Hi {user.name.split(' ')[0]}, you signed in with a temporary password. Pick a new one that only you know to
        continue.
      </p>
      <ChangePasswordForm submitLabel="Save password and continue" />
      <p className="auth-footnote">
        Not {user.name}?{' '}
        <button type="button" className="link-button" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </p>
      {logout.error && <p className="field-error">{errorMessage(logout.error)}</p>}
    </AuthCard>
  );
}
