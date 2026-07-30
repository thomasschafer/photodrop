import { useEffect, useRef, useState, type JSX } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ROLE_DISPLAY_NAMES } from '../lib/roles';
import { isVerticalNavKey } from '../lib/keyboard';
import { useDropdown } from '../lib/useDropdown';
import { Avatar } from './Avatar';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { PushNotificationSettings } from './NotificationBell';
import { ProfileModals, type ProfileModalKind } from './ProfileModals';

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
  const { user, displayName, currentGroup, groups, switchGroup, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [openModal, setOpenModal] = useState<ProfileModalKind | null>(null);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const buildStamp = import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_GIT_SHA || 'dev';
  const itemCount = groups.length + themes.length + 4;
  const currentGroupIndex = groups.findIndex((g) => g.id === currentGroup?.id);

  const { containerRef, triggerRef, setOptionRef, handleOptionKeyDown, handleBlur } = useDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    itemCount,
    initialFocusIndex: currentGroupIndex >= 0 ? currentGroupIndex : 0,
    closeOnScroll: true,
  });

  // The trigger carries `disabled` while switching, and setIsLoading(false)
  // doesn't re-render synchronously, so focusing it from the handler itself is
  // a silent no-op on a still-disabled element — focus is left on <body> and a
  // keyboard user has to tab from the top of the page. Ask for the focus here
  // and hand it back once the re-render has dropped the disabled attribute.
  const restoreTriggerFocus = useRef(false);
  useEffect(() => {
    if (!isLoading && restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [isLoading, triggerRef]);

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
      restoreTriggerFocus.current = true;
      setIsLoading(false);
    }
  };

  const handleThemeSelect = (value: Theme) => {
    setTheme(value);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleSignOut = () => {
    setIsOpen(false);
    setShowSignOutConfirm(true);
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

  const changeNameIdx = groups.length + themes.length;
  const changeColorIdx = changeNameIdx + 1;
  const notificationSettingsIdx = changeColorIdx + 1;
  const signOutIdx = notificationSettingsIdx + 1;

  const openProfileModal = (kind: ProfileModalKind) => {
    setIsOpen(false);
    setOpenModal(kind);
  };

  return (
    <>
      <div ref={containerRef} className="relative" onBlur={handleBlur}>
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
              <div className="px-3.5 py-2 text-xs font-medium text-text-muted uppercase tracking-wide">
                Groups
              </div>
              {groups.map((group, i) => (
                <button
                  key={group.id}
                  ref={setOptionRef(i)}
                  role="menuitemradio"
                  aria-checked={currentGroup?.id === group.id}
                  onClick={() => handleGroupSelect(group.id)}
                  onKeyDown={(e) => handleOptionKeyDown(e, i)}
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
                          : 'bg-bg-tertiary text-text-muted'
                    }`}
                  >
                    {ROLE_DISPLAY_NAMES[group.ownerId === user?.id ? 'owner' : group.role]}
                  </span>
                </button>
              ))}
            </div>

            <div className="h-px bg-border mx-2" />

            {/* Theme section */}
            <div className="py-1">
              <div className="px-3.5 py-2 text-xs font-medium text-text-muted uppercase tracking-wide">
                Theme
              </div>
              {themes.map((t, i) => {
                const idx = groups.length + i;
                return (
                  <button
                    key={t.value}
                    ref={setOptionRef(idx)}
                    role="menuitemradio"
                    aria-checked={theme === t.value}
                    onClick={() => handleThemeSelect(t.value)}
                    onKeyDown={(e) => handleOptionKeyDown(e, idx)}
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
              <div className="px-3.5 py-2 flex items-center gap-2 text-xs text-text-muted">
                <Avatar name={displayName ?? user.name} color={user.profileColor} size="sm" />
                <span>
                  Signed in as <span className="font-medium text-text-secondary">{user.name}</span>
                </span>
              </div>
              <button
                ref={setOptionRef(changeNameIdx)}
                role="menuitem"
                onClick={() => openProfileModal('name')}
                onKeyDown={(e) => handleOptionKeyDown(e, changeNameIdx)}
                className="flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm text-text-secondary bg-transparent transition-colors hover:bg-bg-tertiary"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Change name
              </button>
              <button
                ref={setOptionRef(changeColorIdx)}
                role="menuitem"
                onClick={() => openProfileModal('color')}
                onKeyDown={(e) => handleOptionKeyDown(e, changeColorIdx)}
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
                ref={setOptionRef(notificationSettingsIdx)}
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  setShowNotificationSettings(true);
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, notificationSettingsIdx)}
                className="flex items-center gap-2.5 w-full py-2.5 px-3.5 border-none cursor-pointer text-left text-sm text-text-secondary bg-transparent transition-colors hover:bg-bg-tertiary"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                Notification settings
              </button>
              <div className="px-3.5 pt-1 pb-1 text-[10px] text-text-muted">
                Version: {buildStamp}
              </div>
              <button
                ref={setOptionRef(signOutIdx)}
                role="menuitem"
                onClick={handleSignOut}
                onKeyDown={(e) => handleOptionKeyDown(e, signOutIdx)}
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

      {showNotificationSettings && (
        <Modal
          title="Notification settings"
          onClose={() => setShowNotificationSettings(false)}
          maxWidth="sm"
        >
          <PushNotificationSettings />
        </Modal>
      )}

      {showSignOutConfirm && (
        <ConfirmModal
          title="Sign out?"
          message="Signing back in needs a fresh login link sent to your email."
          confirmLabel="Sign out"
          onConfirm={() => {
            setShowSignOutConfirm(false);
            logout();
          }}
          onCancel={() => setShowSignOutConfirm(false)}
        />
      )}

      <ProfileModals
        open={openModal}
        onClose={() => {
          setOpenModal(null);
          triggerRef.current?.focus();
        }}
      />
    </>
  );
}
