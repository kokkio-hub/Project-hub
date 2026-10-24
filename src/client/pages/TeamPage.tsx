import { useMemo, useState, type ReactNode } from 'react';
import { Ellipsis, Eye, KeyRound, Link2, Mail, Pencil, ShieldCheck, ShieldOff, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import { USER_ROLE_LABELS, type CreatedUserResponse, type InviteResponse, type User } from '../../shared/types';
import { errorMessage } from '../api/client';
import { useAdminDisableTwoFactor } from '../api/account';
import { useCancelInvite, useSendInvite, useTasks, useUpdateUser, useUsers } from '../api/queries';
import { useCurrentUser, useDocumentTitle } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { ErrorNotice, PageLoading, useConfirm, useToast } from '../components/Feedback';
import { StatusGlyph } from '../components/Icons';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu';
import {
  InviteLinkDialog,
  ResetPasswordDialog,
  TemporaryPasswordDialog,
  UserFormModal,
  useEmailEnabled,
  type InviteLinkInfo,
} from '../features/team/UserDialogs';
import { firstName, timeAgo } from '../lib/format';

type PasswordInfo = { name: string; email: string; password: string; reset: boolean };

export function TeamPage() {
  useDocumentTitle('Team');
  const me = useCurrentUser();
  const isAdmin = me.role === 'admin';
  const users = useUsers();
  const toast = useToast();
  const openTasks = useTasks({ status: 'todo,in_progress,review' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [password, setPassword] = useState<PasswordInfo | null>(null);
  const [inviteLink, setInviteLink] = useState<InviteLinkInfo | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const openCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const t of openTasks.data ?? []) if (t.assigneeId) counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
    return counts;
  }, [openTasks.data]);

  const inactiveCount = users.users.filter((u) => !u.isActive).length;
  const visible = users.users.filter((u) => u.isActive || showInactive);

  const onCreated = (result: CreatedUserResponse) => {
    const { user } = result;
    if (result.temporaryPassword) {
      setPassword({ name: user.name, email: user.email, password: result.temporaryPassword, reset: false });
    } else if (result.inviteUrl) {
      setInviteLink({
        name: user.name,
        email: user.email,
        url: result.inviteUrl,
        expiresAt: user.invite?.expiresAt,
        emailError: result.emailError,
        added: true,
      });
    } else if (result.emailed) {
      toast.success(`Invitation emailed to ${user.email}`);
    } else {
      toast.success(`${user.name} can now sign in with the password you chose`);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div className="titles">
          <h1>Team</h1>
          <p className="subtitle">
            {isAdmin
              ? 'Invite people, manage roles and reset passwords. Everyone signs in with their own account.'
              : 'Everyone who works in this workspace.'}
          </p>
        </div>
        <div className="actions">
          {inactiveCount > 0 && (
            <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
              <input type="checkbox" className="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show deactivated ({inactiveCount})
            </label>
          )}
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <UserPlus size={16} /> Add person
            </button>
          )}
        </div>
      </header>

      {users.isPending ? (
        <PageLoading />
      ) : users.isError ? (
        <ErrorNotice error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <div className="card table-wrap">
          <table className="table team-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th className="num">Open tasks</th>
                {isAdmin && <th>Last sign-in</th>}
                {isAdmin && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.id} className={user.isActive ? '' : 'is-inactive'}>
                  <td>
                    <div className="row" style={{ gap: 12 }}>
                      <Avatar user={user} size="lg" title={null} />
                      <div style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap', rowGap: 2 }}>
                          <strong style={{ fontWeight: 600 }}>{user.name}</strong>
                          {user.id === me.id && <span className="badge">You</span>}
                          {!user.isActive && <span className="badge">Deactivated</span>}
                          {user.isActive && user.invitePending && (
                            <span className="badge badge-accent" title="Hasn't accepted the invitation yet">
                              Invited
                            </span>
                          )}
                          {user.isActive && !user.invitePending && user.mustChangePassword && isAdmin && (
                            <span className="badge" title="Hasn't replaced the temporary password yet">
                              Temporary password
                            </span>
                          )}
                        </div>
                        <div className="secondary truncate" style={{ fontSize: 'var(--text-sm)' }}>
                          {user.title ? `${user.title} · ` : ''}
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="status-label">
                      {user.role === 'admin' && <ShieldCheck size={15} className="secondary" aria-hidden />}
                      {user.role === 'guest' && <Eye size={15} className="secondary" aria-hidden />}
                      {USER_ROLE_LABELS[user.role]}
                      {isAdmin && user.twoFactorEnabled && (
                        <span className="badge" title="Signs in with a code from an authenticator app">
                          2FA
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="num">{openCounts.get(user.id) ?? 0}</td>
                  {isAdmin && <td className="secondary">{lastSignIn(user)}</td>}
                  {isAdmin && (
                    <td style={{ width: 48 }}>
                      <UserActions
                        user={user}
                        isSelf={user.id === me.id}
                        onEdit={() => setEditing(user)}
                        onResetPassword={() => setResetting(user)}
                        onInviteLink={setInviteLink}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal open={adding} onClose={() => setAdding(false)} onCreated={onCreated} />
      <UserFormModal open={editing !== null} onClose={() => setEditing(null)} user={editing ?? undefined} />
      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onTemporaryPassword={(user, pw) => setPassword({ name: user.name, email: user.email, password: pw, reset: true })}
      />
      <TemporaryPasswordDialog info={password} onClose={() => setPassword(null)} />
      <InviteLinkDialog info={inviteLink} onClose={() => setInviteLink(null)} />
    </div>
  );
}

/** When someone last signed in, or where their invitation stands. */
function lastSignIn(user: User): ReactNode {
  if (!user.invitePending) return user.lastLoginAt ? timeAgo(user.lastLoginAt) : 'Never';
  if (!user.isActive) return 'Never';
  if (!user.invite) {
    return (
      <span className="status-label" title="The invitation link has expired. Send a new invitation.">
        <StatusGlyph tone="warning" /> Invitation expired
      </span>
    );
  }
  return user.invite.emailedAt ? `Invited ${timeAgo(user.invite.emailedAt)}` : `Link created ${timeAgo(user.invite.createdAt)}`;
}

function UserActions({
  user,
  isSelf,
  onEdit,
  onResetPassword,
  onInviteLink,
}: {
  user: User;
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onInviteLink: (info: InviteLinkInfo) => void;
}) {
  const update = useUpdateUser();
  const disable2fa = useAdminDisableTwoFactor();
  const sendInvite = useSendInvite();
  const cancelInvite = useCancelInvite();
  const emailEnabled = useEmailEnabled();
  const confirm = useConfirm();
  const toast = useToast();
  const first = firstName(user.name);

  const invite = (sendEmail: boolean) => {
    sendInvite.mutate(
      { id: user.id, sendEmail },
      {
        onSuccess: (result: InviteResponse) => {
          if (result.emailed) {
            toast.success(`New invitation emailed to ${user.email}`);
          } else if (result.inviteUrl) {
            onInviteLink({
              name: user.name,
              email: user.email,
              url: result.inviteUrl,
              expiresAt: result.expiresAt,
              emailError: result.emailError,
              added: false,
            });
          }
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const revoke = async () => {
    const ok = await confirm({
      title: `Revoke ${user.name}'s invitation?`,
      message: `The invitation link stops working and ${first} is removed from the team. Tasks assigned to ${first} become unassigned. You can invite them again later.`,
      confirmLabel: 'Revoke invitation',
      danger: true,
    });
    if (!ok) return;
    cancelInvite.mutate(user.id, {
      onSuccess: () => toast.success(`Invitation for ${user.name} revoked`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const turnOff2fa = async () => {
    const ok = await confirm({
      title: `Turn off two-factor sign-in for ${user.name}?`,
      message: `Only do this when ${first} lost their phone and recovery codes, and you're sure it's really them asking. They can then sign in with just their password, and set it up again.`,
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (!ok) return;
    disable2fa.mutate(user.id, {
      onSuccess: () => toast.success(`Two-factor sign-in is off for ${user.name}`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const setActive = async (isActive: boolean) => {
    if (!isActive) {
      const ok = await confirm({
        title: `Deactivate ${user.name}?`,
        message:
          'They are signed out immediately and can no longer sign in. Their tasks, comments and history stay. You can reactivate the account at any time.',
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    update.mutate(
      { id: user.id, patch: { isActive } },
      {
        onSuccess: () => toast.success(isActive ? `${user.name} can sign in again` : `${user.name} has been deactivated`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Menu
      trigger={(props) => (
        <button type="button" className="icon-btn" aria-label={`Actions for ${user.name}`} {...props}>
          <Ellipsis size={18} />
        </button>
      )}
    >
      <MenuItem icon={<Pencil size={16} />} onSelect={onEdit}>
        Edit details
      </MenuItem>
      {user.invitePending ? (
        <>
          {user.isActive && emailEnabled && (
            <MenuItem icon={<Mail size={16} />} onSelect={() => invite(true)} disabled={sendInvite.isPending}>
              {user.invite?.emailedAt ? 'Resend invitation email' : 'Email an invitation'}
            </MenuItem>
          )}
          {user.isActive && (
            <MenuItem icon={<Link2 size={16} />} onSelect={() => invite(false)} disabled={sendInvite.isPending}>
              Get a new invite link
            </MenuItem>
          )}
          <MenuSeparator />
          {!user.isActive && (
            <MenuItem icon={<UserCheck size={16} />} onSelect={() => void setActive(true)}>
              Reactivate
            </MenuItem>
          )}
          <MenuItem icon={<X size={16} />} danger onSelect={() => void revoke()}>
            Revoke invitation
          </MenuItem>
        </>
      ) : (
        !isSelf && (
          <>
            {user.isActive && (
              <MenuItem icon={<KeyRound size={16} />} onSelect={onResetPassword}>
                Reset password…
              </MenuItem>
            )}
            {user.twoFactorEnabled && (
              <MenuItem icon={<ShieldOff size={16} />} onSelect={() => void turnOff2fa()}>
                Turn off two-factor sign-in…
              </MenuItem>
            )}
            <MenuSeparator />
            {user.isActive ? (
              <MenuItem icon={<UserX size={16} />} danger onSelect={() => void setActive(false)}>
                Deactivate
              </MenuItem>
            ) : (
              <MenuItem icon={<UserCheck size={16} />} onSelect={() => void setActive(true)}>
                Reactivate
              </MenuItem>
            )}
          </>
        )
      )}
    </Menu>
  );
}
