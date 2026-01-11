import { useState, useRef, useEffect, useCallback, type JSX } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ROLE_DISPLAY_NAMES } from '../lib/roles';
import { getNavDirection, isVerticalNavKey } from '../lib/keyboard';

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

export function MobileMenu() {
  const { user, currentGroup, groups, switchGroup, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const allItems = [
    ...groups.map((g) => ({ type: 'group' as const, id: g.id, group: g })),
    ...themes.map((t) => ({ type: 'theme' as const, id: t.value, theme: t })),
    { type: 'signout' as const, id: 'signout' },
  ];

  const focusItem = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, allItems.length - 1));
      itemRefs.current[clampedIndex]?.focus();
    },
    [allItems.length]
  );

  useEffect(() => {
    if (isOpen) {
      const currentGroupIndex = groups.findIndex((g) => g.id === currentGroup?.id);
      focusItem(currentGroupIndex >= 0 ? currentGroupIndex : 0);
    }
  }, [isOpen, currentGroup, groups, focusItem]);

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

    const handleScroll = (e: Event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('scroll', handleScroll, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handleBlur = (e: React.FocusEvent) => {
    if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
      setIsOpen(false);
    }
  };

  const handleGroupSelect = async (groupId: string) => {
    if (groupId === currentGroup?.id) {
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    setIsLoading(true);
    try {
      await switchGroup(groupId);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to switch group:', error);
    } finally {
      setIsLoading(false);
      triggerRef.current?.focus();
    }
  };

  const handleThemeSelect = (value: Theme) => {
    setTheme(value);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleSignOut = () => {
    setIsOpen(false);
    logout();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const direction = getNavDirection(e);
    if (direction === 'down') {
      e.preventDefault();
      focusItem(index + 1);
    } else if (direction === 'up') {
      e.preventDefault();
      focusItem(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(allItems.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isVerticalNavKey(e)) {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  if (!currentGroup || !user) {
    return null;
  }

  let itemIndex = 0;

  return (
    <div ref={dropdownRef} className="relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-label="Menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        disabled={isLoading}
        className="flex items-center justify-center w-9 h-9 rounded-lg border border-border cursor-pointer bg-surface text-text-secondary transition-colors hover:border-border-strong disabled:opacity-50"
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-text-tertiary border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Main menu"
          className="absolute top-[calc(100%+0.5rem)] right-0 min-w-[220px] bg-surface border border-border rounded-lg shadow-elevated z-50"
        >
          {/* Groups section */}
          <div className="py-1">
            <div className="px-3.5 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wide">
              Groups
            </div>
            {groups.map((group) => {
              const idx = itemIndex++;
              return (
                <button
                  key={group.id}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  role="menuitemradio"
                  aria-checked={currentGroup?.id === group.id}
                  onClick={() => handleGroupSelect(group.id)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  className={`flex items-center justify-between w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm transition-colors hover:bg-bg-tertiary ${
                    currentGroup?.id === group.id
                      ? 'bg-bg-secondary text-text-primary'
                      : 'bg-transparent text-text-secondary'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {currentGroup?.id === group.id && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-accent"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                    <span className={currentGroup?.id !== group.id ? 'ml-5' : ''}>
                      {group.name}
                    </span>
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      group.ownerId === user?.id
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : group.role === 'admin'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-bg-tertiary text-text-tertiary'
                    }`}
                  >
                    {ROLE_DISPLAY_NAMES[group.ownerId === user?.id ? 'owner' : group.role]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="h-px bg-border mx-2" />

          {/* Theme section */}
          <div className="py-1">
            <div className="px-3.5 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wide">
              Theme
            </div>
            {themes.map((t) => {
              const idx = itemIndex++;
              return (
                <button
                  key={t.value}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  role="menuitemradio"
                  aria-checked={theme === t.value}
                  onClick={() => handleThemeSelect(t.value)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  className={`flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm transition-colors hover:bg-bg-tertiary ${
                    theme === t.value
                      ? 'bg-bg-secondary text-text-primary'
                      : 'bg-transparent text-text-secondary'
                  }`}
                >
                  <span className={theme === t.value ? 'text-accent' : ''}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="h-px bg-border mx-2" />

          {/* User section */}
          <div className="py-1">
            <div className="px-3.5 py-2 text-xs text-text-tertiary">
              Signed in as <span className="font-medium text-text-secondary">{user.name}</span>
            </div>
            <button
              ref={(el) => {
                itemRefs.current[itemIndex] = el;
              }}
              role="menuitem"
              onClick={handleSignOut}
              onKeyDown={(e) => handleKeyDown(e, itemIndex)}
              className="flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm text-accent transition-colors hover:bg-bg-tertiary rounded-b-lg"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
