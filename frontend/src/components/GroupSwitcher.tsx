import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function GroupSwitcher() {
  const { currentGroup, groups, switchGroup } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusOption = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, groups.length - 1));
      optionRefs.current[clampedIndex]?.focus();
    },
    [groups.length]
  );

  useEffect(() => {
    if (isOpen && currentGroup) {
      const currentIndex = groups.findIndex((g) => g.id === currentGroup.id);
      focusOption(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [isOpen, currentGroup, groups, focusOption]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = async (groupId: string) => {
    if (groupId === currentGroup?.id) {
      setIsOpen(false);
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
        focusOption(groups.length - 1);
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

  // Don't show if user only has one group
  if (groups.length <= 1) {
    return currentGroup ? (
      <span className="text-sm font-medium text-text-primary">{currentGroup.name}</span>
    ) : null;
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border cursor-pointer bg-surface text-text-primary text-sm font-medium transition-colors hover:border-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <span className="animate-pulse">Switching...</span>
        ) : (
          <>
            <span>{currentGroup?.name || 'Select group'}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Select group"
          className="absolute top-[calc(100%+0.5rem)] left-0 min-w-[200px] bg-surface border border-border rounded-lg shadow-elevated z-50"
        >
          {groups.map((group, index) => (
            <button
              key={group.id}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              role="option"
              aria-selected={currentGroup?.id === group.id}
              onClick={() => handleSelect(group.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`flex items-center justify-between w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm transition-colors hover:bg-bg-tertiary ${
                index === 0 ? 'rounded-t-lg' : ''
              } ${index === groups.length - 1 ? 'rounded-b-lg' : ''} ${
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
                <span className={currentGroup?.id !== group.id ? 'ml-5' : ''}>{group.name}</span>
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  group.role === 'admin'
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-tertiary text-text-tertiary'
                }`}
              >
                {group.role}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
