import { FolderKanban, RotateCcw, SquareCheck, Trash2 } from 'lucide-react';
import { TRASH_DAYS, type TrashItem } from '../../shared/types';
import { errorMessage } from '../api/client';
import { useDestroy, useEmptyTrash, useRestore, useTrash } from '../api/inbox';
import { useUsers } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { EmptyState, ErrorNotice, PageLoading, useConfirm, useToast } from '../components/Feedback';
import { ProjectDot } from '../components/Icons';
import { formatDate, formatDateTime, localDateOf, timeAgo } from '../lib/format';
import { t } from '../i18n';

/** Deleted tasks and projects, kept for 30 days so they can be brought back. */
export function TrashPage() {
  useDocumentTitle(t('Trash'));
  const me = useCurrentUser();
  const trash = useTrash();
  const restore = useRestore();
  const destroy = useDestroy();
  const empty = useEmptyTrash();
  const { byId } = useUsers();
  const confirm = useConfirm();
  const toast = useToast();
  const isAdmin = me.role === 'admin';

  const bringBack = (item: TrashItem) =>
    restore.mutate(item, {
      onSuccess: () => toast.success(t('“{title}” is back', { title: item.title })),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const deleteForGood = async (item: TrashItem) => {
    const ok = await confirm({
      title: t('Delete “{title}” for good?', { title: item.title }),
      message:
        item.kind === 'project'
          ? t('The project, all its tasks, comments and files are removed permanently. This cannot be undone.')
          : t('The task, its comments and files are removed permanently. This cannot be undone.'),
      confirmLabel: t('Delete for good'),
      danger: true,
    });
    if (ok) destroy.mutate(item, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const emptyAll = async () => {
    const ok = await confirm({
      title: t('Empty the trash?'),
      message: t('Everything in the trash is removed permanently, for the whole team. This cannot be undone.'),
      confirmLabel: t('Empty trash'),
      danger: true,
    });
    if (ok) empty.mutate(undefined, { onSuccess: () => toast.success(t('Trash emptied')), onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <header className="page-header">
        <div className="titles">
          <h1>{t('Trash')}</h1>
          <p className="subtitle">{t('Deleted tasks and projects stay here for {days} days. After that they’re removed for good.', { days: TRASH_DAYS })}</p>
        </div>
        {isAdmin && (trash.data?.length ?? 0) > 0 && (
          <div className="actions">
            <button type="button" className="btn" onClick={() => void emptyAll()}>
              <Trash2 size={16} /> {t('Empty trash')}
            </button>
          </div>
        )}
      </header>

      {trash.isPending ? (
        <PageLoading />
      ) : trash.isError ? (
        <ErrorNotice error={trash.error} onRetry={() => void trash.refetch()} />
      ) : trash.data.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Trash2 size={22} />} title={t('The trash is empty')}>
            {t('When you delete a task or a project, it comes here first, so a mistake is easy to undo.')}
          </EmptyState>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th>{t('Deleted')}</th>
                <th>{t('Removed for good')}</th>
                <th aria-label={t('Actions')} />
              </tr>
            </thead>
            <tbody>
              {trash.data.map((item) => {
                const by = item.deletedBy ? byId.get(item.deletedBy)?.name : undefined;
                return (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td style={{ maxWidth: 420 }}>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="secondary" aria-hidden>
                          {item.kind === 'project' ? <FolderKanban size={16} /> : <SquareCheck size={16} />}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontWeight: 560 }}>
                            {item.title}
                          </div>
                          <div className="row secondary" style={{ gap: 6, fontSize: 'var(--text-sm)' }}>
                            {item.kind === 'project' ? (
                              t('Project, with all its tasks')
                            ) : (
                              <>
                                {item.projectColor && <ProjectDot color={item.projectColor} />}
                                <span className="truncate">{item.projectName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="secondary" title={formatDateTime(item.deletedAt)}>
                      {by ? t('{time} by {name}', { time: timeAgo(item.deletedAt), name: by }) : timeAgo(item.deletedAt)}
                    </td>
                    <td className="secondary">{formatDate(localDateOf(item.purgeAt))}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {item.canRestore && (
                        <button type="button" className="btn btn-sm" onClick={() => bringBack(item)} disabled={restore.isPending}>
                          <RotateCcw size={14} /> {t('Restore')}
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => void deleteForGood(item)}
                          aria-label={t('Delete {title} for good', { title: item.title })}
                          title={t('Delete for good')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
