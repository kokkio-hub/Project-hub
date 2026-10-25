import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { COLOR_NAMES, FIELD_TYPES, MAX_FIELD_OPTIONS, MAX_FIELDS, type CustomField, type FieldType, type Project } from '../../../shared/types';
import { ApiError, errorMessage } from '../../api/client';
import { useCreateField, useDeleteField, useReorderFields, useUpdateField, type FieldOptionInput } from '../../api/planning';
import { EmptyState, Spinner, useConfirm, useToast } from '../../components/Feedback';
import { Modal } from '../../components/Modal';
import { ColorSelect } from '../labels/LabelManager';
import { FIELD_TYPE_LABELS } from './Fields';
import { t } from '../../i18n';

/** The project owner and admins add their own fields to the project's tasks. */
export function FieldsDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={t('Custom fields')} wide>
      {open && <FieldsBody project={project} />}
    </Modal>
  );
}

function FieldsBody({ project }: { project: Project }) {
  const reorder = useReorderFields(project.id);
  const toast = useToast();
  const [adding, setAdding] = useState(project.fields.length === 0);
  const fields = [...project.fields].sort((a, b) => a.position - b.position || a.id - b.id);

  const move = (index: number, delta: number) => {
    const ids = fields.map((f) => f.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids, { onError: (e) => toast.error(errorMessage(e)) });
  };

  return (
    <div className="modal-body stack" style={{ gap: 16 }}>
      <p className="secondary">
        {t('Add the details your team tracks to every task in this project, such as the client, story points or a sign-off box.')}
      </p>
      {fields.length === 0 && !adding ? (
        <EmptyState icon={<SlidersHorizontal size={22} />} title={t('No custom fields yet')}>
          {t('Add the first one below.')}
        </EmptyState>
      ) : (
        fields.length > 0 && (
          <ul className="field-list">
            {fields.map((field, index) => (
              <FieldRow key={field.id} field={field} first={index === 0} last={index === fields.length - 1} onMove={(d) => move(index, d)} />
            ))}
          </ul>
        )
      )}
      {fields.length < MAX_FIELDS &&
        (adding ? (
          <FieldForm project={project} onDone={() => setAdding(false)} />
        ) : (
          <div>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> {t('Add field')}
            </button>
          </div>
        ))}
    </div>
  );
}

function FieldRow({ field, first, last, onMove }: { field: CustomField; first: boolean; last: boolean; onMove: (delta: number) => void }) {
  const update = useUpdateField();
  const remove = useDeleteField();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState(false);

  const del = async () => {
    const ok = await confirm({
      title: t('Delete the field “{name}”?', { name: field.name }),
      message: t('What tasks have filled in for it is removed too.'),
      confirmLabel: t('Delete field'),
      danger: true,
    });
    if (ok) remove.mutate(field.id, { onError: (e) => toast.error(errorMessage(e)) });
  };

  if (editing) {
    return (
      <li className="field-row is-editing">
        <FieldForm field={field} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="field-row">
      <div className="field-row-main">
        <strong className="truncate">{field.name}</strong>
        <span className="badge">{t(FIELD_TYPE_LABELS[field.type])}</span>
        {field.type === 'select' && (
          <span className="field-row-options truncate secondary">{field.options.map((o) => o.name).join(', ')}</span>
        )}
      </div>
      <label className="row" style={{ gap: 6, fontSize: 'var(--text-sm)', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <input
          type="checkbox"
          className="checkbox"
          checked={field.showOnCard}
          onChange={(e) => update.mutate({ id: field.id, patch: { showOnCard: e.target.checked } }, { onError: (err) => toast.error(errorMessage(err)) })}
        />
        {t('On cards')}
      </label>
      <span className="row" style={{ gap: 2 }}>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => onMove(-1)} disabled={first} aria-label={t('Move {name} up', { name: field.name })}>
          <ArrowUp size={14} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => onMove(1)} disabled={last} aria-label={t('Move {name} down', { name: field.name })}>
          <ArrowDown size={14} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label={t('Edit {name}', { name: field.name })}>
          <Pencil size={14} />
        </button>
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => void del()} aria-label={t('Delete {name}', { name: field.name })}>
          <Trash2 size={14} />
        </button>
      </span>
    </li>
  );
}

/** Adds a field (with `project`) or changes one (with `field`). The type can't change afterwards. */
function FieldForm({ project, field, onDone }: { project?: Project; field?: CustomField; onDone: () => void }) {
  const create = useCreateField(project?.id ?? 0);
  const update = useUpdateField();
  const toast = useToast();
  const [name, setName] = useState(field?.name ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'select');
  const [showOnCard, setShowOnCard] = useState(field?.showOnCard ?? false);
  const [options, setOptions] = useState<FieldOptionInput[]>(
    field?.options.map((o) => ({ ...o })) ?? [
      { name: '', color: 'blue' },
      { name: '', color: 'orange' },
    ],
  );
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const errors = error instanceof ApiError ? error.fields : {};

  const setOption = (index: number, patch: Partial<FieldOptionInput>) => setOptions((list) => list.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const addOption = () => setOptions((list) => [...list, { name: '', color: COLOR_NAMES[list.length % COLOR_NAMES.length]! }]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const filled = options.map((o) => ({ ...o, name: o.name.trim() })).filter((o) => o.name);
    const done = { onSuccess: onDone, onError: (e: unknown) => toast.error(errorMessage(e)) };
    if (field) {
      update.mutate({ id: field.id, patch: { name: name.trim(), showOnCard, ...(field.type === 'select' ? { options: filled } : {}) } }, done);
    } else {
      create.mutate({ name: name.trim(), type, showOnCard, options: type === 'select' ? filled : [] }, done);
    }
  };

  const removedChoices = field?.type === 'select' ? field.options.filter((o) => !options.some((x) => x.id === o.id)) : [];

  return (
    <form className="field-form stack" style={{ gap: 12 }} onSubmit={submit}>
      <div className="field-form-row">
        <label className="field" style={{ flex: 2 }}>
          <span className="field-label">{t('Name')}</span>
          <input className="input input-sm" value={name} maxLength={40} autoFocus placeholder={t('e.g. Client')} onChange={(e) => setName(e.target.value)} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">{t('Type')}</span>
          <select className="select select-sm" value={type} disabled={!!field} onChange={(e) => setType(e.target.value as FieldType)}>
            {FIELD_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(FIELD_TYPE_LABELS[x])}
              </option>
            ))}
          </select>
        </label>
      </div>

      {type === 'select' && (
        <fieldset className="field">
          <legend className="field-label">{t('Choices')}</legend>
          <ul className="option-rows">
            {options.map((o, index) => (
              <li key={o.id ?? `new-${index}`} className="label-row">
                <ColorSelect value={o.color} onChange={(color) => setOption(index, { color })} label={t('Colour of choice {n}', { n: index + 1 })} />
                <input
                  className="input input-sm"
                  value={o.name}
                  maxLength={40}
                  placeholder={t('Choice {n}', { n: index + 1 })}
                  aria-label={t('Choice {n}', { n: index + 1 })}
                  onChange={(e) => setOption(index, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => setOptions((list) => list.filter((_, i) => i !== index))}
                  aria-label={t('Remove choice {n}', { n: index + 1 })}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          {options.length < MAX_FIELD_OPTIONS && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addOption}>
              <Plus size={14} /> {t('Add choice')}
            </button>
          )}
          {errors.options && <span className="field-error">{errors.options}</span>}
          {removedChoices.length > 0 && (
            <span className="field-hint">{t('Tasks set to a removed choice become empty for this field.')}</span>
          )}
        </fieldset>
      )}

      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" className="checkbox" checked={showOnCard} onChange={(e) => setShowOnCard(e.target.checked)} />
        {t('Show on board cards')}
      </label>

      <div className="row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !name.trim()}>
          {pending && <Spinner size={14} />}
          {field ? t('Save') : t('Add field')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}
