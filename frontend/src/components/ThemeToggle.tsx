import { useState, useRef, useEffect, useCallback, type JSX } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type Theme = 'system' | 'light' | 'dark';

const themes: { value: Theme; label: string; icon: JSX.Element }[] = [
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const currentTheme = themes.find((t) => t.value === theme) || themes[0];

  const focusOption = useCallback((index: number) => {
    const clampedIndex = Math.max(0, Math.min(index, themes.length - 1));
    optionRefs.current[clampedIndex]?.focus();
  }, []);

  useEffect(() => {
    if (isOpen) {
      const currentIndex = themes.findIndex((t) => t.value === theme);
      focusOption(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [isOpen, theme, focusOption]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleBlur = (e: React.FocusEvent) => {
    if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
      setIsOpen(false);
    }
  };

  const handleSelect = (value: Theme) => {
    setTheme(value);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusOption(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusOption(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusOption(0);
        break;
      case 'End':
        e.preventDefault();
        focusOption(themes.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
        break;
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  return (
    <div ref={dropdownRef} className="relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-label="Theme"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex items-center justify-center w-9 h-9 rounded-lg border border-border cursor-pointer bg-surface text-text-secondary transition-colors hover:border-border-strong"
      >
        {currentTheme.icon}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Select theme"
          className="absolute top-[calc(100%+0.5rem)] right-0 min-w-[140px] bg-surface border border-border rounded-lg shadow-elevated z-50"
        >
          {themes.map((t, index) => (
            <button
              key={t.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              role="option"
              aria-selected={theme === t.value}
              onClick={() => handleSelect(t.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm transition-colors hover:bg-bg-tertiary ${
                index === 0 ? 'rounded-t-lg' : ''
              } ${index === themes.length - 1 ? 'rounded-b-lg' : ''} ${
                theme === t.value
                  ? 'bg-bg-secondary text-text-primary'
                  : 'bg-transparent text-text-secondary'
              }`}
            >
              <span className={theme === t.value ? 'text-accent' : ''}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
