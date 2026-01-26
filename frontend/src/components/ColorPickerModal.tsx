import { useState } from 'react';
import { PROFILE_COLORS, type ProfileColor } from '../lib/profileColors';
import { Modal } from './Modal';

interface ColorPickerModalProps {
  currentColor: ProfileColor;
  onSelect: (color: ProfileColor) => Promise<void>;
  onClose: () => void;
}

export function ColorPickerModal({ currentColor, onSelect, onClose }: ColorPickerModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (color: ProfileColor) => {
    if (color === currentColor || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSelect(color);
      onClose();
    } catch {
      setError('Failed to update color. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Choose your color" onClose={onClose} maxWidth="sm">
      <div className="grid grid-cols-5 gap-3 py-2">
        {PROFILE_COLORS.map((color) => (
          <button
            key={color}
            onClick={() => handleSelect(color)}
            disabled={saving}
            className={`w-full aspect-square rounded-full transition-all cursor-pointer border-2 disabled:cursor-not-allowed ${
              color === currentColor
                ? 'border-text-primary scale-110 shadow-elevated'
                : 'border-transparent hover:scale-110 hover:shadow-card'
            }`}
            style={{ backgroundColor: `var(--profile-${color})` }}
            aria-label={`${color}${color === currentColor ? ' (current)' : ''}`}
            aria-pressed={color === currentColor}
          >
            {color === currentColor && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="3"
                className="mx-auto"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-error mt-2">{error}</p>}
    </Modal>
  );
}
