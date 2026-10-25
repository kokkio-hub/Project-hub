import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { CustomField, FieldType } from '../../../shared/types';
import { formatDate, formatNumber } from '../../lib/format';
import { N_, t } from '../../i18n';

/** Custom field values: how they read, look on a card, and are edited in the task details. */

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: N_('Text'),
  number: N_('Number'),
  select: N_('Dropdown'),
  date: N_('Date'),
  checkbox: N_('Checkbox'),
};

/** A stored value as text a person can read ('' when empty). */
export function fieldText(field: CustomField, value: string | undefined): string {
  if (value === undefined || value === '') return '';
  switch (field.type) {
    case 'select':
      return field.options.find((o) => o.id === value)?.name ?? '';
    case 'checkbox':
      return value === 'true' ? t('Yes') : '';
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? formatNumber(n) : value;
    }
    case 'date':
      return formatDate(value);
    default:
      return value;
  }
}

/** A value as a sortable key (numbers and dates sort as such; empty values last). */
export function fieldSortKey(field: CustomField, value: string | undefined): string | number {
  if (value === undefined || value === '') return '￿';
  if (field.type === 'number') return Number(value);
  if (field.type === 'select') {
    const index = field.options.findIndex((o) => o.id === value);
    return index < 0 ? '￿' : String(index).padStart(3, '0');
  }
  return value.toLowerCase();
}

/** A value on a board card, or (compact, without the field name) in a list column. */
export function FieldChip({ field, value, compact = false }: { field: CustomField; value: string | undefined; compact?: boolean }) {
  const text = fieldText(field, value);
  if (!text) return null;
  if (compact && field.type !== 'select') {
    return field.type === 'checkbox' ? <Check size={15} aria-label={text} /> : <span className={field.type === 'number' ? 'num' : undefined}>{text}</span>;
  }
  if (field.type === 'select') {
    const option = field.options.find((o) => o.id === value)!;
    return (
      <span className="label-chip is-sm field-chip" title={`${field.name}: ${text}`}>
        <span className="label-dot" style={{ background: `var(--cat-${option.color})` }} aria-hidden />
        <span className="truncate">{text}</span>
      </span>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <span className="chip field-chip" title={`${field.name}: ${text}`}>
        <Check size={12} aria-hidden />
        <span className="truncate">{field.name}</span>
      </span>
    );
  }
  return (
    <span className="chip field-chip" title={`${field.name}: ${text}`}>
      <span className="muted">{field.name}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Edits one value in the task details. `onChange` gets what to send (null clears it). */
export function FieldInput({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: CustomField;
  value: string | undefined;
  readOnly: boolean;
  onChange: (value: string | boolean | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const label = field.name;

  const commitText = () => {
    const next = draft.trim();
    if (next === (value ?? '')) return;
    onChange(next === '' ? null : next);
  };

  switch (field.type) {
    case 'select':
      return (
        <select className="select select-sm" value={value ?? ''} disabled={readOnly} aria-label={label} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t('None')}</option>
          {field.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="checkbox"
          checked={value === 'true'}
          disabled={readOnly}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className="input input-sm"
          value={value ?? ''}
          disabled={readOnly}
          aria-label={label}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 1900)) onChange(v || null);
          }}
        />
      );
    default:
      return (
        <input
          className="input input-sm"
          value={draft}
          readOnly={readOnly}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          maxLength={500}
          aria-label={label}
          placeholder={readOnly ? '' : field.type === 'number' ? t('Number') : t('Empty')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape' && draft !== (value ?? '')) {
              e.preventDefault();
              e.stopPropagation();
              setDraft(value ?? '');
            }
          }}
        />
      );
  }
}
