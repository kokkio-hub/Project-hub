import { UserRound } from 'lucide-react';
import type { User } from '../../shared/types';
import { initials } from '../lib/format';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  user: Pick<User, 'name' | 'color'> & { isActive?: boolean } | null | undefined;
  size?: Size;
  /** Tooltip text; defaults to the person's name. Pass null to omit. */
  title?: string | null;
}

/** A person's initials on their identity colour. Unassigned shows a dashed outline. */
export function Avatar({ user, size = 'md', title }: AvatarProps) {
  const sizeClass = size === 'md' ? '' : `avatar-${size}`;
  if (!user) {
    const iconSize = size === 'xs' ? 11 : size === 'sm' ? 13 : 15;
    return (
      <span className={`avatar avatar-empty ${sizeClass}`} title={title === null ? undefined : (title ?? 'Unassigned')}>
        <UserRound size={iconSize} aria-hidden />
        <span className="sr-only">Unassigned</span>
      </span>
    );
  }
  const label = title === null ? undefined : (title ?? user.name);
  return (
    <span
      className={`avatar ${sizeClass} ${user.isActive === false ? 'avatar-inactive' : ''}`}
      style={{ background: `var(--cat-${user.color})`, color: `var(--on-cat-${user.color})` }}
      title={label}
      role="img"
      aria-label={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

export function Person({ user, size = 'sm', muted }: { user: AvatarProps['user']; size?: Size; muted?: boolean }) {
  return (
    <span className="person">
      <Avatar user={user} size={size} title={null} />
      <span className={`truncate ${muted ? 'secondary' : ''}`}>{user ? user.name : 'Unassigned'}</span>
    </span>
  );
}
