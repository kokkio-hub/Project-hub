import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { COLOR_NAMES, type ColorName, type User } from '../../shared/types';

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-wrap">
      <input {...props} type={visible ? 'text' : 'password'} className="input" />
      <button
        type="button"
        className="icon-btn"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

/** Colour choice as a radio group of swatches. */
export function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: ColorName;
  onChange: (color: ColorName) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="swatches" role="radiogroup" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      {COLOR_NAMES.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          title={color[0]!.toUpperCase() + color.slice(1)}
          className="swatch"
          style={{ background: `var(--cat-${color})`, color: `var(--on-cat-${color})` }}
          onClick={() => onChange(color)}
        >
          {value === color && <Check size={14} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** Native select of active team members (plus the current assignee even if deactivated). People who haven't joined yet are marked. */
export function UserSelect({
  users,
  value,
  onChange,
  id,
  allowUnassigned = true,
  unassignedLabel = 'Unassigned',
  className = 'select',
  disabled,
}: {
  users: User[];
  value: number | null;
  onChange: (id: number | null) => void;
  id?: string;
  allowUnassigned?: boolean;
  unassignedLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const options = users.filter((u) => u.isActive || u.id === value);
  return (
    <select
      id={id}
      className={className}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      {allowUnassigned && <option value="">{unassignedLabel}</option>}
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {!u.isActive ? ' (deactivated)' : u.invitePending ? ' (invited)' : ''}
        </option>
      ))}
    </select>
  );
}
