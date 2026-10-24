import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Link2Off } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, type LinkInfo } from '../../shared/types';
import { ApiError } from '../api/client';
import {
  useAcceptInvite,
  useAppStatus,
  useCompletePasswordReset,
  useLinkInfo,
  useMe,
  type LinkKind,
} from '../api/queries';
import { useAppName } from '../auth/session';
import { ErrorNotice, Spinner, useToast } from '../components/Feedback';
import { Field, PasswordInput } from '../components/Form';
import { firstName } from '../lib/format';
import { AuthCard, AuthIcon, SubmitButton } from './AuthPages';

/*
 * The pages behind the links in invitation and password reset emails. The
 * secret part of the link comes after the # (so it never reaches server logs),
 * and is sent to the server in request bodies.
 */

function useLinkToken(): string {
  const { hash } = useLocation();
  return useMemo(() => {
    const raw = hash.replace(/^#/, '');
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [hash]);
}

const isGone = (error: unknown) => error instanceof ApiError && error.status === 410;

function useTitle(title: string) {
  const appName = useAppName();
  useEffect(() => {
    document.title = `${title} · ${appName}`;
  }, [title, appName]);
}

/** Loads who the link is for, and shows the right screen while loading or when the link doesn't work. */
function LinkGate({
  kind,
  token,
  gone,
  children,
}: {
  kind: LinkKind;
  token: string;
  /** What to show when the link has expired or was used. */
  gone: ReactNode;
  children: (info: LinkInfo) => ReactNode;
}) {
  const appName = useAppName();
  const info = useLinkInfo(kind, token);

  if (!token) {
    return (
      <LinkProblem title="This link is incomplete">
        Copy the whole link from the email into your browser's address bar, including the long code at the end.
      </LinkProblem>
    );
  }
  if (info.isPending) {
    return (
      <AuthCard appName={appName}>
        <div className="auth-loading">
          <Spinner size={24} />
        </div>
      </AuthCard>
    );
  }
  if (isGone(info.error)) return gone;
  if (info.isError) {
    return (
      <AuthCard appName={appName}>
        <ErrorNotice error={info.error} onRetry={() => void info.refetch()} />
      </AuthCard>
    );
  }
  return children(info.data);
}

function LinkProblem({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const appName = useAppName();
  const me = useMe();
  return (
    <AuthCard appName={appName}>
      <div className="auth-message">
        <AuthIcon tone="warning">
          <Link2Off size={22} />
        </AuthIcon>
        <h1>{title}</h1>
        <p className="lead">{children}</p>
        <div className="stack" style={{ gap: 10 }}>
          {actions}
          <Link to="/" className="btn btn-lg btn-block">
            {me.data ? `Continue to ${appName}` : 'Go to sign in'}
          </Link>
        </div>
      </div>
    </AuthCard>
  );
}

/** Warns that using the link switches accounts, when someone else is signed in in this browser. */
function SignedInAsSomeoneElse({ email, children }: { email: string; children: (name: string) => ReactNode }) {
  const me = useMe();
  if (!me.data || me.data.email.toLowerCase() === email.toLowerCase()) return null;
  return <div className="alert alert-info">{children(me.data.name)}</div>;
}

/** The two password boxes, with a check that they match. */
function useNewPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  return {
    password,
    confirm,
    mismatch,
    setPassword: (value: string) => {
      setPassword(value);
      setMismatch(false);
    },
    setConfirm: (value: string) => {
      setConfirm(value);
      setMismatch(false);
    },
    /** True when the passwords match; otherwise shows the mismatch message. */
    check: () => {
      const ok = password === confirm;
      setMismatch(!ok);
      return ok;
    },
  };
}

// ---------------------------------------------------------------------------
// Accepting an invitation
// ---------------------------------------------------------------------------

export function AcceptInvitePage() {
  useTitle('Join');
  const token = useLinkToken();
  const accept = useAcceptInvite();

  const gone = (
    <LinkProblem title="This invitation has expired">
      Invitation links work once, for a limited time, and stop working when a newer invitation is sent. Ask your admin to
      send you a new one.
    </LinkProblem>
  );
  // The link can also stop working while the form is open (for example, the admin sent a newer one).
  if (isGone(accept.error)) return gone;

  return (
    <LinkGate kind="invitation" token={token} gone={gone}>
      {(info) => <AcceptInviteForm token={token} info={info} accept={accept} />}
    </LinkGate>
  );
}

function AcceptInviteForm({
  token,
  info,
  accept,
}: {
  token: string;
  info: LinkInfo;
  accept: ReturnType<typeof useAcceptInvite>;
}) {
  const appName = useAppName();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(info.name);
  const pw = useNewPassword();
  const fields = accept.error instanceof ApiError ? accept.error.fields : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pw.check()) return;
    accept.mutate(
      { token, name, password: pw.password },
      {
        onSuccess: (user) => {
          navigate('/', { replace: true });
          toast.success(`Welcome to ${appName}, ${firstName(user.name)}!`);
        },
      },
    );
  };

  const edited = () => {
    if (accept.error) accept.reset();
  };

  return (
    <AuthCard appName={appName}>
      <h1>Join {appName}</h1>
      <p className="lead">
        {info.invitedBy ? `${info.invitedBy} invited you to join the team.` : 'You have been invited to join the team.'}{' '}
        Choose a password to finish setting up your account.
      </p>
      <form onSubmit={submit} noValidate>
        <SignedInAsSomeoneElse email={info.email}>
          {(current) => `You're signed in as ${current} in this browser. Joining signs you in as ${info.name} instead.`}
        </SignedInAsSomeoneElse>
        {accept.error && !Object.keys(fields).length && <ErrorNotice error={accept.error} />}
        <Field label="Email" htmlFor="invite-email" hint="You'll sign in with this address.">
          <input id="invite-email" className="input" type="email" value={info.email} autoComplete="username" readOnly />
        </Field>
        <Field label="Your name" htmlFor="invite-name" error={fields.name}>
          <input
            id="invite-name"
            className="input"
            value={name}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              edited();
            }}
          />
        </Field>
        <Field
          label="Choose a password"
          htmlFor="invite-password"
          error={fields.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        >
          <PasswordInput
            id="invite-password"
            value={pw.password}
            onChange={(e) => {
              pw.setPassword(e.target.value);
              edited();
            }}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        <Field label="Repeat password" htmlFor="invite-confirm" error={pw.mismatch ? "The passwords don't match." : undefined}>
          <PasswordInput
            id="invite-confirm"
            value={pw.confirm}
            onChange={(e) => {
              pw.setConfirm(e.target.value);
              edited();
            }}
            autoComplete="new-password"
          />
        </Field>
        <SubmitButton pending={accept.isPending} disabled={accept.isSuccess || !name.trim()}>
          Join {appName}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// Choosing a new password from a reset link
// ---------------------------------------------------------------------------

export function ResetPasswordPage() {
  useTitle('Choose a new password');
  const token = useLinkToken();
  const complete = useCompletePasswordReset();
  const status = useAppStatus();
  const me = useMe();
  const canRequest = (status.data?.passwordResetEnabled ?? false) && !me.data;

  const gone = (
    <LinkProblem
      title="This link has expired"
      actions={
        canRequest && (
          <Link to="/?forgot" className="btn btn-primary btn-lg btn-block">
            Email me a new link
          </Link>
        )
      }
    >
      Password reset links work once, for a limited time. {canRequest ? 'You can ask for a new one.' : 'Ask an admin to send you a new one.'}
    </LinkProblem>
  );
  if (isGone(complete.error)) return gone;

  return (
    <LinkGate kind="password-reset" token={token} gone={gone}>
      {(info) => <ResetPasswordForm token={token} info={info} complete={complete} />}
    </LinkGate>
  );
}

function ResetPasswordForm({
  token,
  info,
  complete,
}: {
  token: string;
  info: LinkInfo;
  complete: ReturnType<typeof useCompletePasswordReset>;
}) {
  const appName = useAppName();
  const navigate = useNavigate();
  const toast = useToast();
  const pw = useNewPassword();
  const fields = complete.error instanceof ApiError ? complete.error.fields : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pw.check()) return;
    complete.mutate(
      { token, password: pw.password },
      {
        onSuccess: () => {
          navigate('/', { replace: true });
          toast.success("Your new password is saved and you're signed in.");
        },
      },
    );
  };

  const edited = () => {
    if (complete.error) complete.reset();
  };

  return (
    <AuthCard appName={appName}>
      <h1>Choose a new password</h1>
      <p className="lead">Hi {firstName(info.name)}, pick a new password that only you know.</p>
      <form onSubmit={submit} noValidate>
        <SignedInAsSomeoneElse email={info.email}>
          {(current) => `You're signed in as ${current} in this browser. Saving signs you in as ${info.name} instead.`}
        </SignedInAsSomeoneElse>
        {complete.error && !Object.keys(fields).length && <ErrorNotice error={complete.error} />}
        <Field label="Email" htmlFor="reset-email">
          <input id="reset-email" className="input" type="email" value={info.email} autoComplete="username" readOnly />
        </Field>
        <Field
          label="New password"
          htmlFor="reset-password"
          error={fields.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. You'll be signed out on your other devices.`}
        >
          <PasswordInput
            id="reset-password"
            value={pw.password}
            onChange={(e) => {
              pw.setPassword(e.target.value);
              edited();
            }}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        <Field label="Repeat new password" htmlFor="reset-confirm" error={pw.mismatch ? "The passwords don't match." : undefined}>
          <PasswordInput
            id="reset-confirm"
            value={pw.confirm}
            onChange={(e) => {
              pw.setConfirm(e.target.value);
              edited();
            }}
            autoComplete="new-password"
          />
        </Field>
        <SubmitButton pending={complete.isPending} disabled={complete.isSuccess}>
          Save password and sign in
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
