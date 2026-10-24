import { CloudUpload, Download, HardDrive, Mail } from 'lucide-react';
import { errorMessage } from '../api/client';
import { useAdminStatus, useRunBackup } from '../api/account';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { ErrorNotice, PageLoading, Spinner, useToast } from '../components/Feedback';
import { StatusGlyph } from '../components/Icons';
import { formatBytes } from '../features/tasks/Attachments';
import { formatDateTime, timeAgo } from '../lib/format';

/** Admins: backups, storage use and exports. */
export function SettingsPage() {
  useDocumentTitle('Workspace settings');
  const me = useCurrentUser();
  const status = useAdminStatus();
  const run = useRunBackup();
  const toast = useToast();

  if (me.role !== 'admin') {
    return (
      <div className="page">
        <ErrorNotice error={new Error('Only admins can see the workspace settings.')} />
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <header className="page-header">
        <div className="titles">
          <h1>Workspace settings</h1>
          <p className="subtitle">Backups, storage and exports for the whole workspace.</p>
        </div>
      </header>

      {status.isPending ? (
        <PageLoading />
      ) : status.isError ? (
        <ErrorNotice error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <div className="stack" style={{ gap: 20 }}>
          <section className="card">
            <div className="card-header">
              <CloudUpload size={17} aria-hidden className="secondary" />
              <h2>Off-site backups</h2>
            </div>
            <div className="card-body stack" style={{ gap: 12 }}>
              {status.data.backup.configured ? (
                <>
                  <p className="secondary">
                    Every night after {String(status.data.backup.hourUtc).padStart(2, '0')}:00 UTC, a copy of the database and any new
                    attachments go to <strong>{status.data.backup.target}</strong>. Copies older than {status.data.backup.keepDays} days are
                    removed (the newest seven always stay).
                  </p>
                  <dl className="facts">
                    <dt>Last backup</dt>
                    <dd>
                      {status.data.backup.lastSuccessAt ? (
                        <span className="status-label" title={formatDateTime(status.data.backup.lastSuccessAt)}>
                          <StatusGlyph tone="good" size={14} /> {timeAgo(status.data.backup.lastSuccessAt)}
                          {status.data.backup.lastSize !== null && <span className="muted">· {formatBytes(status.data.backup.lastSize)}</span>}
                        </span>
                      ) : (
                        <span className="muted">Not yet</span>
                      )}
                    </dd>
                    {status.data.backup.lastFile && (
                      <>
                        <dt>File</dt>
                        <dd className="mono truncate">{status.data.backup.lastFile}</dd>
                      </>
                    )}
                    {status.data.backup.lastError && (
                      <>
                        <dt>Last problem</dt>
                        <dd>
                          <span className="status-label" style={{ whiteSpace: 'normal' }}>
                            <StatusGlyph tone="critical" size={14} />
                            <span>
                              {status.data.backup.lastError}
                              {status.data.backup.lastErrorAt && <span className="muted"> ({timeAgo(status.data.backup.lastErrorAt)})</span>}
                            </span>
                          </span>
                        </dd>
                      </>
                    )}
                  </dl>
                  <div>
                    <button
                      type="button"
                      className="btn"
                      disabled={status.data.backup.running || run.isPending}
                      onClick={() =>
                        run.mutate(undefined, {
                          onSuccess: () => toast.info('Backup started. This page updates when it’s done.'),
                          onError: (e) => toast.error(errorMessage(e)),
                        })
                      }
                    >
                      {status.data.backup.running ? <Spinner size={16} /> : <CloudUpload size={16} />}
                      {status.data.backup.running ? 'Backing up…' : 'Back up now'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="alert alert-warning">
                    <StatusGlyph tone="warning" size={16} />
                    <span>
                      No backup bucket is set up. The database and its own backups live on the same disk, so if that disk is lost, so is
                      everything.
                    </span>
                  </div>
                  <p className="secondary">
                    To fix that, create a storage bucket (Railway, Cloudflare R2, Backblaze B2 or any S3-compatible storage) and set{' '}
                    <code>BACKUP_S3_BUCKET</code>, <code>BACKUP_S3_ENDPOINT</code>, <code>BACKUP_S3_ACCESS_KEY_ID</code> and{' '}
                    <code>BACKUP_S3_SECRET_ACCESS_KEY</code> on the server. See “Backups” in the README.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <HardDrive size={17} aria-hidden className="secondary" />
              <h2>Storage</h2>
            </div>
            <div className="card-body">
              <dl className="facts">
                <dt>Database</dt>
                <dd>{formatBytes(status.data.storage.databaseBytes)}</dd>
                <dt>Attachments</dt>
                <dd>
                  {status.data.storage.attachments.toLocaleString()} {status.data.storage.attachments === 1 ? 'file' : 'files'},{' '}
                  {formatBytes(status.data.storage.attachmentBytes)}
                </dd>
                <dt>Largest upload</dt>
                <dd>{formatBytes(status.data.storage.uploadLimitBytes)} per file</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <Mail size={17} aria-hidden className="secondary" />
              <h2>Email</h2>
            </div>
            <div className="card-body">
              {status.data.emailEnabled && status.data.appUrlSet ? (
                <span className="status-label">
                  <StatusGlyph tone="good" size={14} /> Email is set up. Invitations, password resets and notification emails go out.
                </span>
              ) : (
                <span className="status-label" style={{ whiteSpace: 'normal' }}>
                  <StatusGlyph tone="warning" size={14} />
                  <span>
                    {status.data.emailEnabled
                      ? 'Email works, but APP_URL isn’t set, so notification emails and reset links are off.'
                      : 'Email isn’t set up, so nobody gets notification emails. Notifications still show in the app.'}
                  </span>
                </span>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <Download size={17} aria-hidden className="secondary" />
              <h2>Export</h2>
            </div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <p className="secondary">All tasks in every project as one spreadsheet (CSV), for Excel, Numbers or Google Sheets.</p>
              <div>
                <a className="btn" href="/api/export/tasks.csv" download>
                  <Download size={16} /> Download all tasks
                </a>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
