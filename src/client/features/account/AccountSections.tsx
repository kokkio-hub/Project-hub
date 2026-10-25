import { useState, type FormEvent } from 'react';
import { CalendarPlus, Copy, Info, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { NOTIFY_EMAIL_MODES, type NotifyEmailMode } from '../../../shared/types';
import { ApiError, errorMessage } from '../../api/client';
import {
  useCalendarScope,
  useCreateCalendarFeed,
  useDeleteCalendarFeed,
  useDisableTwoFactor,
  useEnableTwoFactor,
  useNewRecoveryCodes,
  useRevokeSession,
  useSessions,
  useSignOutOthers,
  useStartTwoFactor,
  type TwoFactorSetup,
} from '../../api/account';
import { useAppStatus, useUpdateProfile } from '../../api/queries';
import { useAppName, useCurrentUser } from '../../auth/session';
import { ErrorNotice, Spinner, useConfirm, useToast } from '../../components/Feedback';
import { Field, PasswordInput } from '../../components/Form';
import { StatusGlyph } from '../../components/Icons';
import { Modal } from '../../components/Modal';
import { formatDateTime, timeAgo } from '../../lib/format';
import { N_, t, tn } from '../../i18n';

const EMAIL_LABELS: Record<NotifyEmailMode, { title: string; text: string }> = {
  instant: { title: N_('Right away'), text: N_('An email a few minutes after something happens, unless you saw it in the app.') },
  daily: { title: N_('Once a day'), text: N_('Every morning at 8: what’s overdue, due today, and what you missed.') },
  off: { title: N_('Never'), text: N_('Only see notifications in the app.') },
};

export function NotificationSettings() {
  const me = useCurrentUser();
  const status = useAppStatus();
  const update = useUpdateProfile();
  const toast = useToast();
  const set = (notifyEmail: NotifyEmailMode) =>
    update.mutate({ notifyEmail }, { onSuccess: () => toast.success(t('Saved')), onError: (e) => toast.error(errorMessage(e)) });

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('Notification emails')}</h2>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <p className="secondary">
          {t('The bell in the sidebar shows when you’re assigned a task, mentioned with @{name}, or someone comments on a task you follow.', {
            name: me.name.split(' ')[0],
          })}
        </p>
        {!status.data?.emailEnabled && (
          <div className="alert alert-info">
            <Info size={16} aria-hidden /> {t('Email isn’t set up on this server yet, so these emails won’t go out until an admin sets it up.')}
          </div>
        )}
        <div className="radio-cards stacked" role="radiogroup" aria-label={t('Notification emails')}>
          {NOTIFY_EMAIL_MODES.map((mode) => (
            <label key={mode} className="radio-card">
              <input type="radio" name="notify-email" checked={me.notifyEmail === mode} onChange={() => set(mode)} />
              <div>
                <strong>{t(EMAIL_LABELS[mode].title)}</strong>
                <span>{t(EMAIL_LABELS[mode].text)}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CalendarSettings() {
  const me = useCurrentUser();
  const create = useCreateCalendarFeed();
  const scope = useCalendarScope();
  const remove = useDeleteCalendarFeed();
  const confirm = useConfirm();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);

  const make = async () => {
    if (me.calendarFeed) {
      const ok = await confirm({
        title: t('Make a new calendar address?'),
        message: t('The current address stops working. Calendars subscribed to it need the new one.'),
        confirmLabel: t('Make a new address'),
      });
      if (!ok) return;
    }
    create.mutate(me.calendarScope, { onSuccess: (r) => setUrl(r.url), onError: (e) => toast.error(errorMessage(e)) });
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('Address copied'));
    } catch {
      toast.info(url);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('Calendar')}</h2>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <p className="secondary">
          {t('See your due dates in Google Calendar, Outlook or Apple Calendar. Subscribe to your personal address (“From URL” or “Subscribe to calendar”); it updates by itself.')}
        </p>
        <div className="segmented" role="group" aria-label={t('Which tasks')}>
          {(['mine', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={me.calendarScope === s}
              onClick={() => scope.mutate(s, { onError: (e) => toast.error(errorMessage(e)) })}
            >
              {s === 'mine' ? t('My tasks') : t('All tasks I can see')}
            </button>
          ))}
        </div>
        {url && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="copy-field">
              <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('Calendar address')} />
              <button type="button" className="btn" onClick={() => void copy()}>
                <Copy size={15} /> {t('Copy')}
              </button>
            </div>
            <span className="field-hint">{t('Keep this address to yourself: anyone who has it can see these tasks. It’s only shown now.')}</span>
          </div>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => void make()} disabled={create.isPending}>
            <CalendarPlus size={16} />
            {me.calendarFeed ? t('Make a new address') : t('Get my calendar address')}
          </button>
          {me.calendarFeed && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    setUrl(null);
                    toast.success(t('Calendar address turned off'));
                  },
                })
              }
            >
              {t('Turn off')}
            </button>
          )}
          {me.calendarFeed && !url && <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>{t('An address is active.')}</span>}
        </div>
      </div>
    </section>
  );
}

export function TwoFactorSettings() {
  const me = useCurrentUser();
  const [mode, setMode] = useState<null | 'setup' | 'disable' | 'codes'>(null);
  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('Two-factor sign-in')}</h2>
        {me.twoFactorEnabled && (
          <span className="badge badge-accent">
            <ShieldCheck size={12} aria-hidden /> {t('On')}
          </span>
        )}
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        {me.twoFactorEnabled ? (
          <>
            <p className="secondary">
              {tn(
                'When you sign in, you enter a code from your authenticator app after your password. You have {count} unused recovery code for when your phone isn’t at hand.',
                'When you sign in, you enter a code from your authenticator app after your password. You have {count} unused recovery codes for when your phone isn’t at hand.',
                me.recoveryCodesLeft,
              )}
            </p>
            {me.recoveryCodesLeft <= 2 && (
              <div className="alert alert-warning">
                <StatusGlyph tone="warning" size={16} /> {t('You’re running out of recovery codes. Make new ones.')}
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => setMode('codes')}>
                <KeyRound size={16} /> {t('New recovery codes')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('disable')}>
                {t('Turn off')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="secondary">
              {t('Protect your account with a code from an app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), so a stolen password alone isn’t enough.')}
            </p>
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setMode('setup')}>
                <Smartphone size={16} /> {t('Set up two-factor sign-in')}
              </button>
            </div>
          </>
        )}
      </div>
      <TwoFactorSetupDialog open={mode === 'setup'} onClose={() => setMode(null)} />
      <PasswordDialog mode={mode === 'disable' || mode === 'codes' ? mode : null} onClose={() => setMode(null)} />
    </section>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const appName = useAppName();
  const toast = useToast();
  const text = `${t('{app} recovery codes', { app: appName })}\n\n${codes.join('\n')}\n\n${t('Each code works once.')}`;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="secondary">
        {t('Save these somewhere safe, like a password manager. Each one signs you in once if you lose your phone. They won’t be shown again.')}
      </p>
      <ul className="recovery-codes">
        {codes.map((c) => (
          <li key={c} className="mono">
            {c}
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast.success(t('Codes copied')),
              () => toast.info(t('Select the codes and copy them')),
            )
          }
        >
          <Copy size={15} /> {t('Copy')}
        </button>
        <a className="btn" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="recovery-codes.txt">
          {t('Download')}
        </a>
      </div>
    </div>
  );
}

function TwoFactorSetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={t('Set up two-factor sign-in')}>
      {open && <TwoFactorSetupSteps onClose={onClose} />}
    </Modal>
  );
}

function TwoFactorSetupSteps({ onClose }: { onClose: () => void }) {
  const start = useStartTwoFactor();
  const enable = useEnableTwoFactor();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const startFields = start.error instanceof ApiError ? start.error.fields : {};
  const enableFields = enable.error instanceof ApiError ? enable.error.fields : {};

  if (codes) {
    return (
      <>
        <div className="modal-body stack" style={{ gap: 12 }}>
          <div className="alert alert-info">
            <StatusGlyph tone="good" size={16} /> {t('Two-factor sign-in is on. Your other devices were signed out.')}
          </div>
          <RecoveryCodes codes={codes} />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('I’ve saved them')}
          </button>
        </div>
      </>
    );
  }

  if (!setup) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      start.mutate(password, { onSuccess: setSetup });
    };
    return (
      <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
        <div className="modal-body stack" style={{ gap: 12 }}>
          {start.error && !startFields.password && <ErrorNotice error={start.error} />}
          <p className="secondary">{t('First, confirm it’s you.')}</p>
          <Field label={t('Your password')} htmlFor="tfa-password" error={startFields.password}>
            <PasswordInput id="tfa-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
          </Field>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!password || start.isPending}>
            {start.isPending && <Spinner size={16} />}
            {t('Continue')}
          </button>
        </div>
      </form>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    enable.mutate(code, { onSuccess: (r) => setCodes(r.recoveryCodes) });
  };
  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body stack" style={{ gap: 14 }}>
        <ol className="steps">
          <li>{t('Open your authenticator app and add an account.')}</li>
          <li>{t('Scan this QR code, or type in the key below.')}</li>
        </ol>
        <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
        <div className="copy-field">
          <input className="input mono" readOnly value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} aria-label={t('Setup key')} onFocus={(e) => e.target.select()} />
        </div>
        <Field label={t('Enter the 6-digit code the app shows')} htmlFor="tfa-code" error={enableFields.code}>
          <input
            id="tfa-code"
            className="input mono code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            autoFocus
          />
        </Field>
        {enable.error && !enableFields.code && <ErrorNotice error={enable.error} />}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={code.replace(/\s/g, '').length !== 6 || enable.isPending}>
          {enable.isPending && <Spinner size={16} />}
          {t('Turn on')}
        </button>
      </div>
    </form>
  );
}

function PasswordDialog({ mode, onClose }: { mode: 'disable' | 'codes' | null; onClose: () => void }) {
  return (
    <Modal open={mode !== null} onClose={onClose} title={mode === 'disable' ? t('Turn off two-factor sign-in?') : t('New recovery codes')}>
      {mode && <PasswordStep mode={mode} onClose={onClose} />}
    </Modal>
  );
}

function PasswordStep({ mode, onClose }: { mode: 'disable' | 'codes'; onClose: () => void }) {
  const disable = useDisableTwoFactor();
  const regen = useNewRecoveryCodes();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const mutation = mode === 'disable' ? disable : regen;
  const fields = mutation.error instanceof ApiError ? mutation.error.fields : {};

  if (codes) {
    return (
      <>
        <div className="modal-body">
          <RecoveryCodes codes={codes} />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('I’ve saved them')}
          </button>
        </div>
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'disable') {
      disable.mutate(password, {
        onSuccess: () => {
          toast.success(t('Two-factor sign-in is off'));
          onClose();
        },
      });
    } else {
      regen.mutate(password, { onSuccess: (r) => setCodes(r.recoveryCodes) });
    }
  };

  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <div className="modal-body stack" style={{ gap: 12 }}>
        <p className="secondary">
          {mode === 'disable'
            ? t('Signing in will only need your password again.')
            : t('Your old recovery codes stop working and you get ten new ones.')}
        </p>
        {mutation.error && !fields.password && <ErrorNotice error={mutation.error} />}
        <Field label={t('Your password')} htmlFor="tfa-confirm" error={fields.password}>
          <PasswordInput id="tfa-confirm" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit" className={`btn ${mode === 'disable' ? 'btn-danger' : 'btn-primary'}`} disabled={!password || mutation.isPending}>
          {mutation.isPending && <Spinner size={16} />}
          {mode === 'disable' ? t('Turn off') : t('Make new codes')}
        </button>
      </div>
    </form>
  );
}

export function DevicesSettings() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const others = useSignOutOthers();
  const toast = useToast();
  const list = sessions.data ?? [];
  const otherCount = list.filter((s) => !s.current).length;

  return (
    <section className="card">
      <div className="card-header">
        <h2>{t('Signed-in devices')}</h2>
        <span className="spacer" />
        {otherCount > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => others.mutate(undefined, { onSuccess: () => toast.success(t('Signed out everywhere else')) })}
            disabled={others.isPending}
          >
            <LogOut size={14} /> {t('Sign out everywhere else')}
          </button>
        )}
      </div>
      <div className="card-body">
        {sessions.isPending ? (
          <Spinner />
        ) : sessions.isError ? (
          <ErrorNotice error={sessions.error} />
        ) : (
          <ul className="devices">
            {list.map((s) => (
              <li key={s.id} className="device">
                {/iPhone|Android|iPad/.test(s.device) ? <Smartphone size={18} aria-hidden /> : <Monitor size={18} aria-hidden />}
                <div className="device-main">
                  <strong>
                    {s.device}
                    {s.current && <span className="badge badge-accent" style={{ marginLeft: 8 }}>{t('This device')}</span>}
                  </strong>
                  <span className="secondary" title={t('Signed in {time}', { time: formatDateTime(s.createdAt) })}>
                    {s.current ? t('Active now') : t('Last active {time}', { time: timeAgo(s.lastActiveAt) })}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </span>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => revoke.mutate(s.id, { onSuccess: () => toast.success(t('Signed out {device}', { device: s.device })), onError: (e) => toast.error(errorMessage(e)) })}
                  >
                    {t('Sign out')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
