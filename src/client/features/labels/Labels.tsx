import { useState } from 'react';
import { Check, Plus, Tag } from 'lucide-react';
import { COLOR_NAMES, type ColorName, type Label } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useCreateLabel } from '../../api/board';
import { useToast } from '../../components/Feedback';
import { Popover } from '../../components/Popover';
import { t } from '../../i18n';

/** A label: its colour as a small dot, then its name. */
export function LabelChip({ label, size = 'md' }: { label: Pick<Label, 'name' | 'color'>; size?: 'sm' | 'md' }) {
  return (
    <span className={`label-chip ${size === 'sm' ? 'is-sm' : ''}`} title={label.name}>
      <span className="label-dot" style={{ background: `var(--cat-${label.color})` }} aria-hidden />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export function LabelList({ ids, labels, size = 'sm' }: { ids: number[]; labels: Label[]; size?: 'sm' | 'md' }) {
  const shown = labels.filter((l) => ids.includes(l.id));
  if (shown.length === 0) return null;
  return (
    <span className="label-list">
      {shown.map((l) => (
        <LabelChip key={l.id} label={l} size={size} />
      ))}
    </span>
  );
}

function nextLabelColor(labels: Label[]): ColorName {
  const used = new Map<string, number>();
  for (const l of labels) used.set(l.color, (used.get(l.color) ?? 0) + 1);
  let best: ColorName = COLOR_NAMES[0];
  for (const c of COLOR_NAMES) if ((used.get(c) ?? 0) < (used.get(best) ?? 0)) best = c;
  return best;
}

/** Choose a task's labels, or create a new one by typing its name. */
export function LabelPicker({
  projectId,
  labels,
  value,
  onChange,
  disabled,
}: {
  projectId: number;
  labels: Label[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const create = useCreateLabel(projectId);
  const toast = useToast();
  const q = query.trim().toLowerCase();
  const matches = labels.filter((l) => l.name.toLowerCase().includes(q));
  const exact = labels.some((l) => l.name.toLowerCase() === q);

  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const add = () => {
    const name = query.trim();
    if (!name) return;
    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id]);
      setQuery('');
      return;
    }
    create.mutate(
      { name, color: nextLabelColor(labels) },
      {
        onSuccess: (label) => {
          onChange([...value, label.id]);
          setQuery('');
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Popover
      label={t('Labels')}
      trigger={(props) => (
        <button type="button" className="btn btn-sm btn-ghost label-trigger" disabled={disabled} {...props}>
          <Tag size={14} aria-hidden />
          {value.length === 0 ? t('Add labels') : t('Edit labels')}
        </button>
      )}
    >
      {() => (
        <div className="label-picker">
          {/* Not a <form>: the picker can sit inside another form (the new task dialog). */}
          <input
            className="input input-sm"
            placeholder={t('Find or create a label…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            maxLength={40}
            aria-label={t('Find or create a label')}
            data-autofocus
          />
          <ul className="label-options" role="listbox" aria-multiselectable="true" aria-label={t('Labels')}>
            {matches.map((l) => {
              const selected = value.includes(l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="label-option"
                    onClick={() => toggle(l.id)}
                  >
                    <span className="label-check" aria-hidden>
                      {selected && <Check size={13} strokeWidth={3} />}
                    </span>
                    <LabelChip label={l} />
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && !q && <li className="muted label-empty">{t('No labels yet. Type a name to create one.')}</li>}
          </ul>
          {q && !exact && (
            <button type="button" className="label-option label-create" onClick={() => add()} disabled={create.isPending}>
              <Plus size={14} aria-hidden /> {t('Create “{name}”', { name: query.trim() })}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}
