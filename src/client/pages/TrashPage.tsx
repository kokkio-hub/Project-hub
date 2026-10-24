import { FolderKanban, RotateCcw, SquareCheck, Trash2 } from 'lucide-react';
import { TRASH_DAYS, type TrashItem } from '../../shared/types';
import { errorMessage } from '../api/client';
import { useDestroy, useEmptyTrash, useRestore, useTrash } from '../api/inbox';
import { useUsers } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { EmptyState, ErrorNotice, PageLoading, useConfirm, useToast } from '../components/Feedback';
import { ProjectDot } from '../components/Icons';
import { formatDate, formatDateTime, localDateOf, timeAgo } from '../lib/format';

/** Deleted tasks and projects, kept for 30 days so they can be brought back. */
export function TrashPage() {
  useDocumentTitle('Trash');
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
      onSuccess: () => toast.success(`“${item.title}” is back`),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const deleteForGood = async (item: TrashItem) => {
    const ok = await confirm({
      title: `Delete “${item.title}” for good?`,
      message:
        item.kind === 'project'
          ? 'The project, all its tasks, comments and files are removed permanently. This cannot be undone.'
          : 'The task, its comments and files are removed permanently. This cannot be undone.',
      confirmLabel: 'Delete for good',
      danger: true,
    });
    if (ok) destroy.mutate(item, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const emptyAll = async () => {
    const ok = await confirm({
      title: 'Empty the trash?',
      message: 'Everything in the trash is removed permanently, for the whole team. This cannot be undone.',
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (ok) empty.mutate(undefined, { onSuccess: () => toast.success('Trash emptied'), onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <header className="page-header">
        <div className="titles">
          <h1>Trash</h1>
          <p className="subtitle">Deleted tasks and projects stay here for {TRASH_DAYS} days. After that they’re removed for good.</p>
        </div>
        {isAdmin && (trash.data?.length ?? 0) > 0 && (
          <div className="actions">
            <button type="button" className="btn" onClick={() => void emptyAll()}>
              <Trash2 size={16} /> Empty trash
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
          <EmptyState icon={<Trash2 size={22} />} title="The trash is empty">
            When you delete a task or a project, it comes here first, so a mistake is easy to undo.
          </EmptyState>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Deleted</th>
                <th>Removed for good</th>
                <th aria-label="Actions" />
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
                              'Project, with all its tasks'
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
                      {timeAgo(item.deletedAt)}
                      {by ? ` by ${by}` : ''}
                    </td>
                    <td className="secondary">{formatDate(localDateOf(item.purgeAt))}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {item.canRestore && (
                        <button type="button" className="btn btn-sm" onClick={() => bringBack(item)} disabled={restore.isPending}>
                          <RotateCcw size={14} /> Restore
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => void deleteForGood(item)}
                          aria-label={`Delete ${item.title} for good`}
                          title="Delete for good"
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
