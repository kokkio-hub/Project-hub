import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { COLOR_NAMES, type ColorName, type Label, type Project } from '../../../shared/types';
import { errorMessage } from '../../api/client';
import { useCreateLabel, useDeleteLabel, useUpdateLabel } from '../../api/board';
import { useConfirm, useToast } from '../../components/Feedback';
import { t } from '../../i18n';

/** Rename, recolour, add and remove a project's labels. Changes save straight away. */
export function LabelManager({ project }: { project: Project }) {
  const create = useCreateLabel(project.id);
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColorName>('blue');

  // This sits inside the project settings form, so Enter must not submit that form.
  const add = (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim(), color }, { onSuccess: () => setName(''), onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <div className="label-manager">
      {project.labels.length > 0 && (
        <ul className="label-rows">
          {project.labels.map((l) => (
            <LabelRow key={l.id} label={l} />
          ))}
        </ul>
      )}
      <div className="label-row label-row-new">
        <ColorSelect value={color} onChange={setColor} />
        <input
          className="input input-sm"
          value={name}
          maxLength={40}
          placeholder={t('New label, e.g. Bug')}
          aria-label={t('New label name')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(e);
          }}
        />
        <button type="button" className="btn btn-sm" onClick={() => add()} disabled={!name.trim() || create.isPending}>
          <Plus size={14} /> {t('Add')}
        </button>
      </div>
    </div>
  );
}

function ColorSelect({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  return (
    <span className="color-select">
      <span className="label-dot" style={{ background: `var(--cat-${value})` }} aria-hidden />
      <select className="select select-sm" value={value} onChange={(e) => onChange(e.target.value as ColorName)} aria-label={t('Label colour')}>
        {COLOR_NAMES.map((c) => (
          <option key={c} value={c}>
            {c[0]!.toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
    </span>
  );
}

function LabelRow({ label }: { label: Label }) {
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const confirm = useConfirm();
  const toast = useToast();
  const [name, setName] = useState(label.name);

  const saveName = () => {
    const value = name.trim();
    if (!value || value === label.name) {
      setName(label.name);
      return;
    }
    update.mutate({ id: label.id, patch: { name: value } }, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const del = async () => {
    const ok = await confirm({
      title: t('Delete the label “{name}”?', { name: label.name }),
      message: t('It is taken off every task that has it.'),
      confirmLabel: t('Delete label'),
      danger: true,
    });
    if (ok) remove.mutate(label.id, { onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <li className="label-row">
      <ColorSelect value={label.color} onChange={(color) => update.mutate({ id: label.id, patch: { color } })} />
      <input
        className="input input-sm"
        value={name}
        maxLength={40}
        aria-label={t('Name of label {name}', { name: label.name })}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveName();
          }
        }}
      />
      <button type="button" className="icon-btn icon-btn-sm" onClick={() => void del()} aria-label={t('Delete label {name}', { name: label.name })}>
        <Trash2 size={14} />
      </button>
    </li>
  );
}
