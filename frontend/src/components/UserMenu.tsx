import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useColorSelect } from '../lib/useColorSelect';
import { isVerticalNavKey } from '../lib/keyboard';
import { useDropdown } from '../lib/useDropdown';
import { Avatar } from './Avatar';
import { ColorPickerModal } from './ColorPickerModal';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const handleColorSelect = useColorSelect();

  const { containerRef, triggerRef, setOptionRef, handleOptionKeyDown, handleBlur } = useDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    itemCount: 2,
    closeOnScroll: true,
  });

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isVerticalNavKey(e)) {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  if (!user) return null;

  return (
    <>
      <div ref={containerRef} className="relative" onBlur={handleBlur}>
        <button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={handleTriggerKeyDown}
          aria-label={`${user.name} menu`}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          className="flex items-center gap-2 rounded-lg p-1 cursor-pointer transition-colors hover:bg-bg-secondary border-none bg-transparent"
        >
          <Avatar name={user.name} color={user.profileColor} size="md" />
        </button>

        {isOpen && (
          <div
            role="menu"
            aria-label="User menu"
            className="absolute top-[calc(100%+0.5rem)] right-0 min-w-[180px] bg-surface border border-border rounded-lg shadow-elevated z-50"
          >
            <div className="px-3.5 py-2 text-xs text-text-tertiary border-b border-border">
              Signed in as <span className="font-medium text-text-secondary">{user.name}</span>
            </div>
            <div className="py-1">
              <button
                ref={setOptionRef(0)}
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  setShowColorPicker(true);
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, 0)}
                className="flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm text-text-secondary bg-transparent transition-colors hover:bg-bg-tertiary"
              >
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: `var(--profile-${user.profileColor})` }}
                  aria-hidden="true"
                />
                Change color
              </button>
              <button
                ref={setOptionRef(1)}
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  logout();
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, 1)}
                className="flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm text-accent bg-transparent transition-colors hover:bg-bg-tertiary rounded-b-lg"
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

      {showColorPicker && (
        <ColorPickerModal
          currentColor={user.profileColor}
          onSelect={handleColorSelect}
          onClose={() => {
            setShowColorPicker(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
