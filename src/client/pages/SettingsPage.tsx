import { CloudUpload, Download, HardDrive, Mail } from 'lucide-react';
import { errorMessage } from '../api/client';
import { useAdminStatus, useRunBackup } from '../api/account';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { ErrorNotice, PageLoading, Spinner, useToast } from '../components/Feedback';
import { StatusGlyph } from '../components/Icons';
import { formatBytes } from '../features/tasks/Attachments';
import { formatDateTime, timeAgo } from '../lib/format';
import { t, tn, tx } from '../i18n';

/** Admins: backups, storage use and exports. */
export function SettingsPage() {
  useDocumentTitle(t('Workspace settings'));
  const me = useCurrentUser();
  const status = useAdminStatus();
  const run = useRunBackup();
  const toast = useToast();

  if (me.role !== 'admin') {
    return (
      <div className="page">
        <ErrorNotice error={new Error(t('Only admins can see the workspace settings.'))} />
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <header className="page-header">
        <div className="titles">
          <h1>{t('Workspace settings')}</h1>
          <p className="subtitle">{t('Backups, storage and exports for the whole workspace.')}</p>
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
              <h2>{t('Off-site backups')}</h2>
            </div>
            <div className="card-body stack" style={{ gap: 12 }}>
              {status.data.backup.configured ? (
                <>
                  <p className="secondary">
                    {tx(
                      'Every night after {hour}:00 UTC, a copy of the database and any new attachments go to {target}. Copies older than {days} days are removed (the newest seven always stay).',
                      {
                        hour: String(status.data.backup.hourUtc).padStart(2, '0'),
                        target: <strong>{status.data.backup.target}</strong>,
                        days: status.data.backup.keepDays,
                      },
                    )}
                  </p>
                  <dl className="facts">
                    <dt>{t('Last backup')}</dt>
                    <dd>
                      {status.data.backup.lastSuccessAt ? (
                        <span className="status-label" title={formatDateTime(status.data.backup.lastSuccessAt)}>
                          <StatusGlyph tone="good" size={14} /> {timeAgo(status.data.backup.lastSuccessAt)}
                          {status.data.backup.lastSize !== null && <span className="muted">· {formatBytes(status.data.backup.lastSize)}</span>}
                        </span>
                      ) : (
                        <span className="muted">{t('Not yet')}</span>
                      )}
                    </dd>
                    {status.data.backup.lastFile && (
                      <>
                        <dt>{t('File')}</dt>
                        <dd className="mono truncate">{status.data.backup.lastFile}</dd>
                      </>
                    )}
                    {status.data.backup.lastError && (
                      <>
                        <dt>{t('Last problem')}</dt>
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
                          onSuccess: () => toast.info(t('Backup started. This page updates when it’s done.')),
                          onError: (e) => toast.error(errorMessage(e)),
                        })
                      }
                    >
                      {status.data.backup.running ? <Spinner size={16} /> : <CloudUpload size={16} />}
                      {status.data.backup.running ? t('Backing up…') : t('Back up now')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="alert alert-warning">
                    <StatusGlyph tone="warning" size={16} />
                    <span>
                      {t('No backup bucket is set up. The database and its own backups live on the same disk, so if that disk is lost, so is everything.')}
                    </span>
                  </div>
                  <p className="secondary">
                    {tx('To fix that, create a storage bucket (Railway, Cloudflare R2, Backblaze B2 or any S3-compatible storage) and set {bucket}, {endpoint}, {key} and {secret} on the server. See “Backups” in the README.', {
                      bucket: <code>BACKUP_S3_BUCKET</code>,
                      endpoint: <code>BACKUP_S3_ENDPOINT</code>,
                      key: <code>BACKUP_S3_ACCESS_KEY_ID</code>,
                      secret: <code>BACKUP_S3_SECRET_ACCESS_KEY</code>,
                    })}
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <HardDrive size={17} aria-hidden className="secondary" />
              <h2>{t('Storage')}</h2>
            </div>
            <div className="card-body">
              <dl className="facts">
                <dt>{t('Database')}</dt>
                <dd>{formatBytes(status.data.storage.databaseBytes)}</dd>
                <dt>{t('Attachments')}</dt>
                <dd>
                  {tn('{count} file, {size}', '{count} files, {size}', status.data.storage.attachments, {
                    size: formatBytes(status.data.storage.attachmentBytes),
                  })}
                </dd>
                <dt>{t('Largest upload')}</dt>
                <dd>{t('{size} per file', { size: formatBytes(status.data.storage.uploadLimitBytes) })}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <Mail size={17} aria-hidden className="secondary" />
              <h2>{t('Email')}</h2>
            </div>
            <div className="card-body">
              {status.data.emailEnabled && status.data.appUrlSet ? (
                <span className="status-label">
                  <StatusGlyph tone="good" size={14} /> {t('Email is set up. Invitations, password resets and notification emails go out.')}
                </span>
              ) : (
                <span className="status-label" style={{ whiteSpace: 'normal' }}>
                  <StatusGlyph tone="warning" size={14} />
                  <span>
                    {status.data.emailEnabled
                      ? t('Email works, but APP_URL isn’t set, so notification emails and reset links are off.')
                      : t('Email isn’t set up, so nobody gets notification emails. Notifications still show in the app.')}
                  </span>
                </span>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <Download size={17} aria-hidden className="secondary" />
              <h2>{t('Export')}</h2>
            </div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <p className="secondary">{t('All tasks in every project as one spreadsheet (CSV), for Excel, Numbers or Google Sheets.')}</p>
              <div>
                <a className="btn" href="/api/export/tasks.csv" download>
                  <Download size={16} /> {t('Download all tasks')}
                </a>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
