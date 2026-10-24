import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import type { AppStatus } from '../shared/types';
import { onAuthFailure } from './api/client';
import { qk, resetSessionData, useAppStatus, useMe } from './api/queries';
import { AppNameContext, CurrentUserContext } from './auth/session';
import { ErrorNotice, PageLoading } from './components/Feedback';
import { AppLayout } from './components/AppLayout';
import { AccountPage } from './pages/AccountPage';
import { ForcedPasswordChangePage, LoginPage, SetupPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { AcceptInvitePage, ResetPasswordPage } from './pages/LinkPages';
import { MyTasksPage } from './pages/MyTasksPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TeamPage } from './pages/TeamPage';
import { TimelinePage } from './pages/TimelinePage';
import { TrashPage } from './pages/TrashPage';

function FullScreenError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="auth-screen">
      <div style={{ width: 'min(420px, 100%)' }}>
        <ErrorNotice error={error} onRetry={onRetry} />
      </div>
    </div>
  );
}

export function App() {
  const qc = useQueryClient();
  const status = useAppStatus();

  // If the session ends mid-use (expired, signed out elsewhere, deactivated), show the sign-in screen.
  useEffect(() => {
    onAuthFailure((error) => {
      if (error.status === 401) resetSessionData(qc, null);
      else void qc.invalidateQueries({ queryKey: qk.me });
    });
    return () => onAuthFailure(null);
  }, [qc]);

  if (status.isPending) return <PageLoading />;
  if (status.isError) return <FullScreenError error={status.error} onRetry={() => void status.refetch()} />;
  if (status.data.setupRequired) return <SetupPage appName={status.data.appName} />;

  return (
    <AppNameContext.Provider value={status.data.appName}>
      <BrowserRouter>
        <Routes>
          {/* Links from invitation and password reset emails work whether or not someone is signed in. */}
          <Route path="invite" element={<AcceptInvitePage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route element={<SignedIn status={status.data} />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="my-tasks" element={<MyTasksPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:projectId/:view?" element={<ProjectPage />} />
              <Route path="timeline" element={<TimelinePage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="trash" element={<TrashPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AppNameContext.Provider>
  );
}

/** Shows the sign-in page (or the forced password change) until someone is signed in, then the app. */
function SignedIn({ status }: { status: AppStatus }) {
  const me = useMe();
  if (me.isPending) return <PageLoading />;
  if (me.isError) return <FullScreenError error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) return <LoginPage appName={status.appName} passwordResetEnabled={status.passwordResetEnabled} />;
  if (me.data.mustChangePassword) return <ForcedPasswordChangePage appName={status.appName} user={me.data} />;
  return (
    <CurrentUserContext.Provider value={me.data}>
      <Outlet />
    </CurrentUserContext.Provider>
  );
}
