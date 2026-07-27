import type { ReactNode } from 'react';
import { NAME_MAX_LENGTH } from '@photodrop/common/limits';

interface NameFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Rendered under the field; use it to explain what an empty field means. */
  hint?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Submit handler for Enter. Only needed outside a <form>; inside one the form
   * already submits on Enter.
   */
  onEnter?: () => void;
}

/**
 * A labelled name input, shared by every surface that edits a name: the user's
 * own canonical name, their per-group display name, and an admin setting a
 * member's display name. Enforces the shared length limit so an over-long name
 * can't be typed rather than being rejected on save.
 */
export function NameField({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  disabled = false,
  autoFocus = false,
  onEnter,
}: NameFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary mb-2">
        {label}
      </label>
      <input
        type="text"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={
          onEnter
            ? (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onEnter();
                }
              }
            : undefined
        }
        placeholder={placeholder}
        maxLength={NAME_MAX_LENGTH}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="input-field w-full"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
