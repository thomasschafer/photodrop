import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ROLE_DISPLAY_NAMES } from '../lib/roles';
import { isVerticalNavKey } from '../lib/keyboard';
import { useDropdown } from '../lib/useDropdown';

export function GroupSwitcher() {
  const { user, currentGroup, groups, switchGroup } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const currentIndex = currentGroup ? groups.findIndex((g) => g.id === currentGroup.id) : 0;
  const { containerRef, triggerRef, setOptionRef, handleOptionKeyDown, handleBlur } = useDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    itemCount: groups.length,
    initialFocusIndex: currentIndex >= 0 ? currentIndex : 0,
    horizontal: false,
  });

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

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isVerticalNavKey(e)) {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  if (!currentGroup || groups.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
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
              ref={setOptionRef(index)}
              role="option"
              aria-selected={currentGroup?.id === group.id}
              onClick={() => handleSelect(group.id)}
              onKeyDown={(e) => handleOptionKeyDown(e, index)}
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
          ))}
        </div>
      )}
    </div>
  );
}
