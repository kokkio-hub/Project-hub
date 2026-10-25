import { useState, type FormEvent } from 'react';
import { Bookmark, BookmarkPlus, Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { MAX_SAVED_VIEWS, type ProjectView, type SavedView, type ViewSettings } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useCreateView, useDeleteView, useUpdateView, useViews } from '../../api/planning';
import { Spinner, useConfirm, useToast } from '../../components/Feedback';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/Menu';
import { Modal } from '../../components/Modal';
import { t } from '../../i18n';

/**
 * Personal saved views of a project: a name for a combination of view,
 * filters and grouping, one click away here and in the sidebar.
 */
export function ViewsMenu({
  projectId,
  view,
  settings,
  active,
  changed,
  onOpen,
  onClose,
}: {
  projectId: number;
  view: ProjectView;
  settings: ViewSettings;
  active: SavedView | undefined;
  changed: boolean;
  onOpen: (view: SavedView) => void;
  /** Leave the saved view (back to everything). */
  onClose: () => void;
}) {
  const { views: all } = useViews();
  const views = all.filter((v) => v.projectId === projectId);
  const update = useUpdateView();
  const remove = useDeleteView();
  const confirm = useConfirm();
  const toast = useToast();
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);

  const saveChanges = () => {
    if (!active) return;
    update.mutate(
      { id: active.id, patch: { view, settings } },
      { onSuccess: () => toast.success(t('View “{name}” updated', { name: active.name })), onError: (e) => toast.error(errorMessage(e)) },
    );
  };

  const del = async () => {
    if (!active) return;
    const ok = await confirm({
      title: t('Delete the view “{name}”?', { name: active.name }),
      message: t('Only the saved view goes; no tasks change.'),
      confirmLabel: t('Delete view'),
      danger: true,
    });
    if (!ok) return;
    remove.mutate(active.id, { onError: (e) => toast.error(errorMessage(e)) });
    onClose();
  };

  return (
    <>
      <Menu
        trigger={(props) => (
          <button type="button" className={`btn btn-sm ${active ? 'is-active' : ''}`} {...props}>
            <Bookmark size={14} aria-hidden />
            <span className="truncate" style={{ maxWidth: 180 }}>
              {active ? active.name : t('Views')}
            </span>
            {active && changed && (
              <span className="dot-changed" title={t('Changed since it was saved')} aria-label={t('Changed since it was saved')} />
            )}
          </button>
        )}
      >
        {views.length > 0 && <MenuLabel>{t('Your saved views')}</MenuLabel>}
        {views.map((v) => (
          <MenuItem key={v.id} icon={<Bookmark size={16} />} onSelect={() => onOpen(v)}>
            <span className="truncate">{v.name}</span>
            {active?.id === v.id && <Check size={16} style={{ marginLeft: 'auto' }} aria-label={t('(selected)')} />}
          </MenuItem>
        ))}
        {views.length > 0 && <MenuSeparator />}
        {active && changed && (
          <MenuItem icon={<RefreshCw size={16} />} onSelect={saveChanges}>
            {t('Save changes to “{name}”', { name: active.name })}
          </MenuItem>
        )}
        <MenuItem icon={<BookmarkPlus size={16} />} onSelect={() => setNaming('new')} disabled={all.length >= MAX_SAVED_VIEWS}>
          {t('Save as a new view…')}
        </MenuItem>
        {active && (
          <>
            <MenuItem icon={<Pencil size={16} />} onSelect={() => setNaming('rename')}>
              {t('Rename view…')}
            </MenuItem>
            <MenuItem icon={<X size={16} />} onSelect={onClose}>
              {t('Close view')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => void del()}>
              {t('Delete view')}
            </MenuItem>
          </>
        )}
      </Menu>
      <NameViewDialog
        open={naming !== null}
        mode={naming ?? 'new'}
        projectId={projectId}
        view={view}
        settings={settings}
        active={active}
        onClose={() => setNaming(null)}
        onCreated={onOpen}
      />
    </>
  );
}

function NameViewDialog({
  open,
  mode,
  projectId,
  view,
  settings,
  active,
  onClose,
  onCreated,
}: {
  open: boolean;
  mode: 'new' | 'rename';
  projectId: number;
  view: ProjectView;
  settings: ViewSettings;
  active: SavedView | undefined;
  onClose: () => void;
  onCreated: (view: SavedView) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={mode === 'new' ? t('Save view') : t('Rename view')}>
      {open && <NameViewForm mode={mode} projectId={projectId} view={view} settings={settings} active={active} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function NameViewForm({
  mode,
  projectId,
  view,
  settings,
  active,
  onClose,
  onCreated,
}: {
  mode: 'new' | 'rename';
  projectId: number;
  view: ProjectView;
  settings: ViewSettings;
  active: SavedView | undefined;
  onClose: () => void;
  onCreated: (view: SavedView) => void;
}) {
  const create = useCreateView(projectId);
  const update = useUpdateView();
  const toast = useToast();
  const [name, setName] = useState(mode === 'rename' ? (active?.name ?? '') : '');
  const pending = create.isPending || update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    if (mode === 'rename' && active) {
      update.mutate({ id: active.id, patch: { name: value } }, { onSuccess: onClose, onError: (e) => toast.error(errorMessage(e)) });
      return;
    }
    create.mutate(
      { name: value, view, settings },
      {
        onSuccess: (saved) => {
          toast.success(t('View “{name}” saved. It’s in the sidebar too.', { name: saved.name }));
          onCreated(saved);
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <div className="modal-body stack" style={{ gap: 12 }}>
        {mode === 'new' && <p className="secondary">{t('Saves this view with its filters and grouping. Only you see your saved views.')}</p>}
        <label className="field">
          <span className="field-label">{t('Name')}</span>
          <input className="input" value={name} maxLength={60} autoFocus placeholder={t('e.g. My urgent work')} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
          {pending && <Spinner size={16} />}
          {t('Save')}
        </button>
      </div>
    </form>
  );
}
