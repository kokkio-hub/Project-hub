import { createContext, useContext, useEffect } from 'react';
import type { Me, User } from '../../shared/types';

export const CurrentUserContext = createContext<Me | null>(null);
export const AppNameContext = createContext<string>('Project Hub');

/** The signed-in person. Only use inside the authenticated part of the app. */
export function useCurrentUser(): Me {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUser must be used while signed in');
  return user;
}

export function useAppName(): string {
  return useContext(AppNameContext);
}

export function useDocumentTitle(title: string | undefined): void {
  const appName = useAppName();
  useEffect(() => {
    document.title = title ? `${title} · ${appName}` : appName;
  }, [title, appName]);
}

export function canManageProject(user: User, project: { ownerId: number | null }): boolean {
  return user.role === 'admin' || project.ownerId === user.id;
}

/** Guests can look and comment; everyone else can also change the work. */
export function canChangeWork(user: Pick<User, 'role'>): boolean {
  return user.role !== 'guest';
}
