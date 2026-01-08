import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type Theme = 'system' | 'light' | 'dark';

const themes: { value: Theme; label: string; icon: JSX.Element }[] = [
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentTheme = themes.find((t) => t.value === theme) || themes[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
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

  const handleSelect = (value: Theme) => {
    setTheme(value);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Theme"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '2.25rem',
          height: '2.25rem',
          borderRadius: '0.5rem',
          border: '1px solid var(--color-border)',
          cursor: 'pointer',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-secondary)',
          transition: 'border-color 0.15s ease, color 0.15s ease',
        }}
      >
        {currentTheme.icon}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Select theme"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            right: 0,
            minWidth: '140px',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          {themes.map((t) => (
            <button
              key={t.value}
              role="option"
              aria-selected={theme === t.value}
              onClick={() => handleSelect(t.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                width: '100%',
                padding: '0.625rem 0.875rem',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.875rem',
                backgroundColor: theme === t.value ? 'var(--color-bg-secondary)' : 'transparent',
                color: theme === t.value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (theme !== t.value) {
                  e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                }
              }}
              onMouseLeave={(e) => {
                if (theme !== t.value) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              <span style={{ color: theme === t.value ? 'var(--color-accent)' : 'inherit' }}>
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
