import { useNavigate } from 'react-router';
import { AtSign, Bell, CalendarClock, CheckCheck, CircleCheckBig, MessageSquare, Unlock, UserPlus } from 'lucide-react';
import type { Notification, NotificationType, User } from '../../../shared/types';
import { useMarkRead, useNotifications } from '../../api/inbox';
import { useUsers } from '../../api/queries';
import { Spinner } from '../../components/Feedback';
import { Popover } from '../../components/Popover';
import { formatDate, formatDateTime, timeAgo } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { t, tx } from '../../i18n';

const ICONS: Record<NotificationType, React.ReactNode> = {
  assigned: <UserPlus size={15} aria-hidden />,
  mentioned: <AtSign size={15} aria-hidden />,
  commented: <MessageSquare size={15} aria-hidden />,
  completed: <CircleCheckBig size={15} aria-hidden />,
  unblocked: <Unlock size={15} aria-hidden />,
  due_soon: <CalendarClock size={15} aria-hidden />,
};

function Sentence({ n, usersById }: { n: Notification; usersById: Map<number, User> }) {
  const actor = <strong>{n.actorId ? (usersById.get(n.actorId)?.name ?? t('Someone')) : t('Someone')}</strong>;
  const task = <strong>{n.data.taskTitle ?? t('a task')}</strong>;
  switch (n.type) {
    case 'assigned':
      return tx('{actor} assigned {task} to you', { actor, task });
    case 'mentioned':
      return tx('{actor} mentioned you on {task}', { actor, task });
    case 'commented':
      return tx('{actor} commented on {task}', { actor, task });
    case 'completed':
      return tx('{actor} completed {task}', { actor, task });
    case 'unblocked':
      return tx('{task} is ready to start: everything it was waiting for is done', { task });
    case 'due_soon':
      return n.data.dueDate
        ? tx('{task} is due tomorrow ({date})', { task, date: formatDate(n.data.dueDate) })
        : tx('{task} is due tomorrow', { task });
    default:
      return tx('{actor} changed {task}', { actor, task });
  }
}

/** The bell: notifications about your work, newest first. */
export function NotificationsButton() {
  const { data, isPending } = useNotifications();
  const markRead = useMarkRead();
  const { byId } = useUsers();
  const navigate = useNavigate();
  useNow(60_000);
  const unread = data?.unread ?? 0;

  const open = (n: Notification, close: () => void) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    close();
    if (n.projectId && n.taskId) navigate(`/projects/${n.projectId}?task=${n.taskId}`);
    else if (n.projectId) navigate(`/projects/${n.projectId}`);
  };

  return (
    <Popover
      label={t('Notifications')}
      width={380}
      className="notifications-popover"
      trigger={(props) => (
        <button
          type="button"
          className="icon-btn bell"
          aria-label={unread > 0 ? t('Notifications, {count} unread', { count: unread }) : t('Notifications')}
          title={t('Notifications')}
          {...props}
        >
          <Bell size={18} />
          {unread > 0 && <span className="bell-count num">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="notifications">
          <div className="notifications-head">
            <strong>{t('Notifications')}</strong>
            <span className="spacer" />
            {unread > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => markRead.mutate({ all: true })}>
                <CheckCheck size={14} /> {t('Mark all read')}
              </button>
            )}
          </div>
          {isPending ? (
            <div className="notifications-empty">
              <Spinner />
            </div>
          ) : !data || data.notifications.length === 0 ? (
            <div className="notifications-empty">
              <Bell size={20} aria-hidden />
              <p>
                {t('Nothing yet. You’ll hear about tasks assigned to you, comments on your tasks and when someone mentions you with @name.')}
              </p>
            </div>
          ) : (
            <ul className="notification-list">
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`notification ${n.readAt ? '' : 'is-unread'}`} onClick={() => open(n, close)}>
                    <span className={`notification-icon is-${n.type}`}>{ICONS[n.type]}</span>
                    <span className="notification-text">
                      <span>
                        <Sentence n={n} usersById={byId} />
                      </span>
                      {n.data.excerpt && <span className="notification-excerpt">“{n.data.excerpt}”</span>}
                      <span className="notification-meta" title={formatDateTime(n.createdAt)}>
                        {n.data.projectName ? `${n.data.projectName} · ` : ''}
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    {!n.readAt && <span className="unread-dot" aria-label={t('Unread')} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
