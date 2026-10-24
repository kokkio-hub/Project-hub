import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ChecklistItem } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useAddChecklistItem, useChecklist, useDeleteChecklistItem, useReorderChecklist, useUpdateChecklistItem } from '../../api/board';
import { Meter } from '../../components/Bits';
import { Spinner, useToast } from '../../components/Feedback';
import { t } from '../../i18n';

/** The checklist inside a task: tick items off, add, rename, reorder and remove them. */
export function Checklist({ taskId, readOnly }: { taskId: number; readOnly: boolean }) {
  const { data: items, isPending } = useChecklist(taskId);
  const add = useAddChecklistItem(taskId);
  const reorder = useReorderChecklist(taskId);
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const done = items?.filter((i) => i.done).length ?? 0;
  const total = items?.length ?? 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    add.mutate(body, { onSuccess: () => setDraft(''), onError: (e) => toast.error(errorMessage(e)) });
  };

  const move = (index: number, delta: number) => {
    if (!items) return;
    const ids = items.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids, { onError: (e) => toast.error(errorMessage(e)) });
  };

  if (readOnly && total === 0) return null;

  return (
    <section className="drawer-section">
      <h3 className="section-title">
        {t('Checklist')} {total > 0 && <span className="muted num">{done}/{total}</span>}
      </h3>
      {total > 0 && (
        <div className="meter-row" style={{ marginBottom: 8 }}>
          <Meter value={done / total} label={t('Checklist progress')} />
        </div>
      )}
      {isPending ? (
        <Spinner />
      ) : (
        <ul className="checklist">
          {items?.map((item, index) => (
            <ChecklistRow
              key={item.id}
              item={item}
              taskId={taskId}
              readOnly={readOnly}
              first={index === 0}
              last={index === items.length - 1}
              onMove={(delta) => move(index, delta)}
            />
          ))}
        </ul>
      )}
      {!readOnly &&
        (adding || total === 0 ? (
          <form className="checklist-add" onSubmit={submit}>
            <input
              className="input input-sm"
              value={draft}
              placeholder={t('Add an item… (Enter to add)')}
              aria-label={t('New checklist item')}
              maxLength={500}
              autoFocus={adding}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && adding) {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(false);
                }
              }}
            />
            <button type="submit" className="btn btn-sm" disabled={!draft.trim() || add.isPending}>
              {t('Add')}
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> {t('Add item')}
          </button>
        ))}
    </section>
  );
}

function ChecklistRow({
  item,
  taskId,
  readOnly,
  first,
  last,
  onMove,
}: {
  item: ChecklistItem;
  taskId: number;
  readOnly: boolean;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
}) {
  const update = useUpdateChecklistItem(taskId);
  const remove = useDeleteChecklistItem(taskId);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.body);

  const save = () => {
    const body = value.trim();
    setEditing(false);
    if (!body || body === item.body) {
      setValue(item.body);
      return;
    }
    update.mutate({ id: item.id, patch: { body } }, { onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <li className={`checklist-item ${item.done ? 'is-done' : ''}`}>
      <input
        type="checkbox"
        className="checkbox"
        checked={item.done}
        disabled={readOnly}
        aria-label={item.done ? t('Untick {body}', { body: item.body }) : t('Tick off {body}', { body: item.body })}
        onChange={(e) => update.mutate({ id: item.id, patch: { done: e.target.checked } }, { onError: (err) => toast.error(errorMessage(err)) })}
      />
      {editing ? (
        <input
          className="input input-sm"
          value={value}
          autoFocus
          maxLength={500}
          aria-label={t('Checklist item')}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setValue(item.body);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="checklist-body"
          onClick={() => !readOnly && setEditing(true)}
          onKeyDown={(e) => {
            if (!readOnly && e.key === 'Enter') setEditing(true);
          }}
          tabIndex={readOnly ? -1 : 0}
          role={readOnly ? undefined : 'button'}
          title={readOnly ? undefined : t('Click to edit')}
        >
          {item.body}
        </span>
      )}
      {!readOnly && !editing && (
        <span className="checklist-actions">
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => onMove(-1)} disabled={first} aria-label={t('Move up')}>
            <ArrowUp size={13} />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => onMove(1)} disabled={last} aria-label={t('Move down')}>
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => remove.mutate(item.id, { onError: (e) => toast.error(errorMessage(e)) })}
            aria-label={t('Remove {body}', { body: item.body })}
          >
            <Trash2 size={13} />
          </button>
        </span>
      )}
    </li>
  );
}
