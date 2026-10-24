import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  ChartGantt,
  Check,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  SquareKanban,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';
import { USER_ROLE_LABELS } from '../../shared/types';
import { useLiveUpdates } from '../api/live';
import { useLogout, useProjects, useTasks } from '../api/queries';
import { canChangeWork, useAppName, useCurrentUser } from '../auth/session';
import { NotificationsButton } from '../features/notifications/NotificationsButton';
import { ProjectFormModal } from '../features/projects/ProjectFormModal';
import { CommandPalette, usePaletteShortcut } from '../features/search/CommandPalette';
import { NewTaskModal } from '../features/tasks/NewTaskModal';
import { TaskDrawer } from '../features/tasks/TaskDrawer';
import { useTheme, type ThemePreference } from '../lib/theme';
import { Avatar } from './Avatar';
import { ProjectDot } from './Icons';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu';

export function AppLayout() {
  const appName = useAppName();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  usePaletteShortcut(openPalette);
  const [searchParams, setSearchParams] = useSearchParams();
  const taskParam = Number(searchParams.get('task'));
  const taskId = Number.isInteger(taskParam) && taskParam > 0 ? taskParam : null;

  useLiveUpdates(true);

  useEffect(() => setNavOpen(false), [location.pathname]);

  const closeTask = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('task');
      return next;
    });

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar onNewProject={() => setNewProjectOpen(true)} onSearch={openPalette} />
      <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <MenuIcon size={20} />
          </button>
          <span className="brand-mark" aria-hidden style={{ width: 24, height: 24, borderRadius: 6 }}>
            <SquareKanban size={14} />
          </span>
          <span className="truncate">{appName}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={openPalette} aria-label="Search">
            <Search size={18} />
          </button>
          <NotificationsButton />
        </header>
        <Outlet />
      </div>
      <TaskDrawer taskId={taskId} onClose={closeTask} />
      <ProjectFormModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewTask={() => setNewTaskOpen(true)}
        onNewProject={() => setNewProjectOpen(true)}
      />
    </div>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Sidebar({ onNewProject, onSearch }: { onNewProject: () => void; onSearch: () => void }) {
  const appName = useAppName();
  const user = useCurrentUser();
  const canCreate = canChangeWork(user);
  const { data: projects } = useProjects();
  const { data: myOpenTasks } = useTasks({ assigneeId: 'me', status: 'todo,in_progress,review' });
  const visibleProjects = (projects ?? []).filter((p) => p.status === 'active' || p.status === 'on_hold');

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-top">
        <NavLink to="/" className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            <SquareKanban size={17} />
          </span>
          <span className="truncate">{appName}</span>
        </NavLink>
        <NotificationsButton />
      </div>

      <button type="button" className="sidebar-search" onClick={onSearch}>
        <Search size={15} aria-hidden />
        <span>Search</span>
        <span className="kbd">{isMac ? '⌘' : 'Ctrl'} K</span>
      </button>

      <nav className="sidebar-nav">
        <NavLink to="/" end className="nav-link">
          <LayoutDashboard size={17} aria-hidden /> Dashboard
        </NavLink>
        <NavLink to="/my-tasks" className="nav-link">
          <ListTodo size={17} aria-hidden /> My tasks
          {myOpenTasks && myOpenTasks.length > 0 && (
            <span className="nav-count" aria-label={`${myOpenTasks.length} open`}>
              {myOpenTasks.length}
            </span>
          )}
        </NavLink>
        <NavLink to="/projects" end className="nav-link">
          <FolderKanban size={17} aria-hidden /> Projects
        </NavLink>
        <NavLink to="/timeline" className="nav-link">
          <ChartGantt size={17} aria-hidden /> Timeline
        </NavLink>
        <NavLink to="/team" className="nav-link">
          <Users size={17} aria-hidden /> Team
        </NavLink>
      </nav>

      <div className="sidebar-section">
        Projects
        {canCreate && (
          <button type="button" className="icon-btn icon-btn-sm" onClick={onNewProject} aria-label="New project" title="New project">
            <Plus size={15} />
          </button>
        )}
      </div>
      <nav className="sidebar-projects" aria-label="Projects">
        {visibleProjects.map((project) => (
          <NavLink key={project.id} to={`/projects/${project.id}`} className="nav-link">
            <ProjectDot color={project.color} />
            <span className="truncate">{project.name}</span>
          </NavLink>
        ))}
        {projects && visibleProjects.length === 0 && canCreate && (
          <button type="button" className="nav-link" onClick={onNewProject} style={{ border: 'none', background: 'none', width: '100%' }}>
            <Plus size={15} aria-hidden /> Create a project
          </button>
        )}
      </nav>

      {user.role !== 'guest' && (
        <nav className="sidebar-nav sidebar-extra" aria-label="More">
          <NavLink to="/trash" className="nav-link">
            <Trash2 size={16} aria-hidden /> Trash
          </NavLink>
          {user.role === 'admin' && (
            <NavLink to="/settings" className="nav-link">
              <SlidersHorizontal size={16} aria-hidden /> Workspace settings
            </NavLink>
          )}
        </nav>
      )}

      <div className="sidebar-footer">
        <UserMenu user={user} />
      </div>
    </aside>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'system', label: 'Match system', icon: <Monitor size={16} /> },
  { value: 'light', label: 'Light', icon: <Sun size={16} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
];

function UserMenu({ user }: { user: ReturnType<typeof useCurrentUser> }) {
  const navigate = useNavigate();
  const logout = useLogout();
  const [theme, setTheme] = useTheme();
  return (
    <Menu
      align="start"
      placement="above"
      trigger={(props) => (
        <button type="button" className="user-button" {...props}>
          <Avatar user={user} size="md" title={null} />
          <span className="who">
            <strong className="truncate">{user.name}</strong>
            <span className="truncate">{user.title || USER_ROLE_LABELS[user.role]}</span>
          </span>
          <Settings size={16} className="muted" aria-hidden />
        </button>
      )}
    >
      <MenuItem icon={<Settings size={16} />} onSelect={() => navigate('/account')}>
        Account settings
      </MenuItem>
      <MenuSeparator />
      <MenuLabel>Theme</MenuLabel>
      {THEMES.map((t) => (
        <MenuItem key={t.value} icon={t.icon} onSelect={() => setTheme(t.value)}>
          {t.label}
          {theme === t.value && <Check size={16} style={{ marginLeft: 'auto' }} aria-label="(selected)" />}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<LogOut size={16} />} onSelect={() => logout.mutate()}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
