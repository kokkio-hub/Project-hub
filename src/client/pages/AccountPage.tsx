import { useState, type FormEvent } from 'react';
import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { USER_ROLE_LABELS } from '../../shared/types';
import { ApiError, errorMessage } from '../api/client';
import { useUpdateProfile } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, Spinner, useToast } from '../components/Feedback';
import { ColorPicker, Field } from '../components/Form';
import { useTheme, type ThemePreference } from '../lib/theme';
import { CalendarSettings, DevicesSettings, NotificationSettings, TwoFactorSettings } from '../features/account/AccountSections';
import { ChangePasswordForm } from './AuthPages';
import { t, useLanguage, type Lang } from '../i18n';
import { LANGUAGE_NAMES, LANGUAGES } from '../../shared/i18n/core';

export function AccountPage() {
  useDocumentTitle(t('Account'));
  const me = useCurrentUser();
  const update = useUpdateProfile();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const { setLang, followAutomatic } = useLanguage();

  const chooseLanguage = (language: Lang | null) =>
    update.mutate(
      { language },
      {
        onSuccess: () => {
          if (language) setLang(language);
          else followAutomatic();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  const [form, setForm] = useState({ name: me.name, title: me.title, color: me.color });
  const fields = update.error instanceof ApiError ? update.error.fields : {};
  const dirty = form.name !== me.name || form.title !== me.title || form.color !== me.color;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(form, { onSuccess: () => toast.success(t('Profile saved')) });
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <header className="page-header">
        <div className="titles">
          <h1>{t('Account settings')}</h1>
          <p className="subtitle">
            {t('Signed in as {email}', { email: me.email })} · {t(USER_ROLE_LABELS[me.role])}
          </p>
        </div>
      </header>

      <div className="stack" style={{ gap: 20 }}>
        <section className="card">
          <div className="card-header">
            <h2>{t('Profile')}</h2>
          </div>
          <form className="card-body stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
            {update.error && !Object.keys(fields).length && <ErrorNotice error={update.error} />}
            <div className="row" style={{ gap: 14 }}>
              <Avatar user={{ name: form.name || me.name, color: form.color }} size="xl" title={null} />
              <div className="stack" style={{ gap: 6 }}>
                <span className="field-label">{t('Colour')}</span>
                <ColorPicker label={t('Avatar colour')} value={form.color} onChange={(color) => setForm({ ...form, color })} />
              </div>
            </div>
            <div className="form-grid">
              <Field label={t('Name')} htmlFor="profile-name" error={fields.name}>
                <input id="profile-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('Job title')} htmlFor="profile-title" error={fields.title}>
                <input id="profile-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={!dirty || update.isPending || !form.name.trim()}>
                {update.isPending && <Spinner size={16} />}
                {t('Save profile')}
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{t('Password')}</h2>
          </div>
          <div className="card-body">
            <ChangePasswordForm onDone={() => toast.success(t('Password updated. Other sessions were signed out.'))} />
          </div>
        </section>

        <TwoFactorSettings />

        <DevicesSettings />

        <NotificationSettings />

        <CalendarSettings />

        <section className="card">
          <div className="card-header">
            <h2>{t('Appearance')}</h2>
          </div>
          <div className="card-body stack" style={{ gap: 16 }}>
            <div className="field">
              <span className="field-label" id="language-label">
                <Languages size={14} aria-hidden /> {t('Language')}
              </span>
              <div className="segmented" role="group" aria-labelledby="language-label">
                <button type="button" aria-pressed={me.language === null} onClick={() => chooseLanguage(null)}>
                  {t('Automatic')}
                </button>
                {LANGUAGES.map((code) => (
                  <button key={code} type="button" lang={code} aria-pressed={me.language === code} onClick={() => chooseLanguage(code)}>
                    {LANGUAGE_NAMES[code]}
                  </button>
                ))}
              </div>
              <span className="field-hint">
                {t('Automatic follows your browser’s language. Emails come in the language you choose too.')}
              </span>
            </div>
            <div className="field">
            <span className="field-label" id="theme-label">
              {t('Theme')}
            </span>
            <div className="segmented" role="group" aria-labelledby="theme-label">
              {(
                [
                  ['system', t('Match system'), <Monitor size={14} key="m" />],
                  ['light', t('Light'), <Sun size={14} key="s" />],
                  ['dark', t('Dark'), <Moon size={14} key="d" />],
                ] as [ThemePreference, string, React.ReactNode][]
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
