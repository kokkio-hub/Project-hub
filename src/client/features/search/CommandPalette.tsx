import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ChartGantt,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Plus,
  Search,
  Settings,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { TASK_STATUS_LABELS } from '../../../shared/types';
import { useSearch } from '../../api/inbox';
import { useProjects } from '../../api/queries';
import { canChangeWork, useCurrentUser } from '../../auth/session';
import { Avatar } from '../../components/Avatar';
import { Spinner } from '../../components/Feedback';
import { ProjectDot, StatusIcon } from '../../components/Icons';
import { Modal } from '../../components/Modal';
import { useDebounced, useOpenTask } from '../../lib/hooks';
import { t } from '../../i18n';

interface Item {
  key: string;
  group: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Ctrl+K (⌘K on a Mac): jump to any task, project or person, or run a
 * command, from anywhere in the app.
 */
export function CommandPalette({
  open,
  onClose,
  onNewTask,
  onNewProject,
}: {
  open: boolean;
  onClose: () => void;
  onNewTask: () => void;
  onNewProject: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={t('Search')} className="modal palette" header={<></>} labelledBy="palette-input">
      {open && <Palette onClose={onClose} onNewTask={onNewTask} onNewProject={onNewProject} />}
    </Modal>
  );
}

function Palette({ onClose, onNewTask, onNewProject }: { onClose: () => void; onNewTask: () => void; onNewProject: () => void }) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const openTask = useOpenTask();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 120);
  const search = useSearch(debounced);
  const { data: projects } = useProjects(true, 'include');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const projectsById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);

  const go = (path: string) => () => {
    onClose();
    navigate(path);
  };

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const commands: Item[] = [
      ...(canChangeWork(me)
        ? [
            { key: 'new-task', group: t('Actions'), icon: <Plus size={16} />, label: t('New task'), run: () => (onClose(), onNewTask()) },
            { key: 'new-project', group: t('Actions'), icon: <Plus size={16} />, label: t('New project'), run: () => (onClose(), onNewProject()) },
          ]
        : []),
      { key: 'dash', group: t('Go to'), icon: <LayoutDashboard size={16} />, label: t('Dashboard'), run: go('/') },
      { key: 'mine', group: t('Go to'), icon: <ListTodo size={16} />, label: t('My tasks'), run: go('/my-tasks') },
      { key: 'projects', group: t('Go to'), icon: <FolderKanban size={16} />, label: t('Projects'), run: go('/projects') },
      { key: 'timeline', group: t('Go to'), icon: <ChartGantt size={16} />, label: t('Timeline'), run: go('/timeline') },
      { key: 'team', group: t('Go to'), icon: <Users size={16} />, label: t('Team'), run: go('/team') },
      { key: 'trash', group: t('Go to'), icon: <Trash2 size={16} />, label: t('Trash'), run: go('/trash') },
      { key: 'account', group: t('Go to'), icon: <UserRound size={16} />, label: t('Account settings'), run: go('/account') },
      ...(me.role === 'admin' ? [{ key: 'settings', group: t('Go to'), icon: <Settings size={16} />, label: t('Workspace settings'), run: go('/settings') }] : []),
    ].filter((c) => !q || c.label.toLowerCase().includes(q));

    if (!debounced.trim()) return commands;
    const r = search.data;
    const found: Item[] = [
      ...(r?.tasks ?? []).map((task) => {
        const project = projectsById.get(task.projectId);
        return {
          key: `t${task.id}`,
          group: t('Tasks'),
          icon: <StatusIcon status={task.status} size={16} />,
          label: task.title,
          hint: `${project?.name ?? ''} · ${t(TASK_STATUS_LABELS[task.status])} · #${task.id}`,
          run: () => {
            onClose();
            if (project) navigate(`/projects/${project.id}?task=${task.id}`);
            else openTask(task.id);
          },
        };
      }),
      ...(r?.projects ?? []).map((p) => ({
        key: `p${p.id}`,
        group: t('Projects'),
        icon: <ProjectDot color={p.color} />,
        label: p.name,
        hint: p.isTemplate ? t('Template') : p.status === 'archived' ? t('Archived') : undefined,
        run: go(`/projects/${p.id}`),
      })),
      ...(r?.people ?? []).map((u) => ({
        key: `u${u.id}`,
        group: t('People'),
        icon: <Avatar user={u} size="xs" title={null} />,
        label: u.name,
        hint: u.title || u.email,
        run: go('/team'),
      })),
    ];
    return [...found, ...commands];
  }, [query, debounced, search.data, projectsById, me]);

  useEffect(() => setIndex(0), [debounced]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const groups: { name: string; items: (Item & { i: number })[] }[] = [];
  items.forEach((item, i) => {
    let g = groups.find((x) => x.name === item.group);
    if (!g) groups.push((g = { name: item.group, items: [] }));
    g.items.push({ ...item, i });
  });

  return (
    <div className="palette-inner">
      <div className="palette-search">
        <Search size={18} aria-hidden className="secondary" />
        <input
          id="palette-input"
          className="palette-input"
          placeholder={t('Search tasks, projects and people, or type a command…')}
          value={query}
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={items[index] ? `palette-${items[index]!.key}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              items[index]?.run();
            }
          }}
        />
        {search.isFetching && <Spinner size={16} />}
        <span className="kbd">Esc</span>
      </div>
      <ul className="palette-list" id="palette-list" role="listbox" ref={listRef} aria-label={t('Results')}>
        {groups.map((g) => (
          <li key={g.name} role="presentation">
            <div className="palette-group">{g.name}</div>
            <ul role="group" aria-label={g.name}>
              {g.items.map((item) => (
                <li
                  key={item.key}
                  id={`palette-${item.key}`}
                  role="option"
                  aria-selected={item.i === index}
                  className={`palette-item ${item.i === index ? 'is-active' : ''}`}
                  onMouseMove={() => setIndex(item.i)}
                  onClick={() => item.run()}
                >
                  <span className="palette-icon">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                  {item.hint && <span className="palette-hint truncate">{item.hint}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {items.length === 0 && <li className="palette-empty">{t('Nothing found for “{query}”.', { query })}</li>}
      </ul>
    </div>
  );
}

/** Opens the palette with Ctrl+K / ⌘K, and with "/" when not typing. */
export function usePaletteShortcut(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
