import { useState, type FormEvent } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { USER_ROLE_LABELS } from '../../shared/types';
import { ApiError } from '../api/client';
import { useUpdateProfile } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, Spinner, useToast } from '../components/Feedback';
import { ColorPicker, Field } from '../components/Form';
import { useTheme, type ThemePreference } from '../lib/theme';
import { ChangePasswordForm } from './AuthPages';

export function AccountPage() {
  useDocumentTitle('Account');
  const me = useCurrentUser();
  const update = useUpdateProfile();
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [form, setForm] = useState({ name: me.name, title: me.title, color: me.color });
  const fields = update.error instanceof ApiError ? update.error.fields : {};
  const dirty = form.name !== me.name || form.title !== me.title || form.color !== me.color;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(form, { onSuccess: () => toast.success('Profile saved') });
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <header className="page-header">
        <div className="titles">
          <h1>Account settings</h1>
          <p className="subtitle">
            Signed in as {me.email} · {USER_ROLE_LABELS[me.role]}
          </p>
        </div>
      </header>

      <div className="stack" style={{ gap: 20 }}>
        <section className="card">
          <div className="card-header">
            <h2>Profile</h2>
          </div>
          <form className="card-body stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
            {update.error && !Object.keys(fields).length && <ErrorNotice error={update.error} />}
            <div className="row" style={{ gap: 14 }}>
              <Avatar user={{ name: form.name || me.name, color: form.color }} size="xl" title={null} />
              <div className="stack" style={{ gap: 6 }}>
                <span className="field-label">Colour</span>
                <ColorPicker label="Avatar colour" value={form.color} onChange={(color) => setForm({ ...form, color })} />
              </div>
            </div>
            <div className="form-grid">
              <Field label="Name" htmlFor="profile-name" error={fields.name}>
                <input id="profile-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Job title" htmlFor="profile-title" error={fields.title}>
                <input id="profile-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={!dirty || update.isPending || !form.name.trim()}>
                {update.isPending && <Spinner size={16} />}
                Save profile
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Password</h2>
          </div>
          <div className="card-body">
            <ChangePasswordForm onDone={() => toast.success('Password updated. Other sessions were signed out.')} />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Appearance</h2>
          </div>
          <div className="card-body">
            <div className="segmented" role="group" aria-label="Theme">
              {(
                [
                  ['system', 'Match system', <Monitor size={14} key="m" />],
                  ['light', 'Light', <Sun size={14} key="s" />],
                  ['dark', 'Dark', <Moon size={14} key="d" />],
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
        </section>
      </div>
    </div>
  );
}
