import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { isVerticalNavKey } from '../lib/keyboard';
import { useDropdown } from '../lib/useDropdown';
import { Avatar } from './Avatar';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { PushNotificationSettings } from './NotificationBell';
import { ProfileModals, type ProfileModalKind } from './ProfileModals';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [openModal, setOpenModal] = useState<ProfileModalKind | null>(null);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const buildStamp = import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_GIT_SHA || 'dev';

  const { containerRef, triggerRef, setOptionRef, handleOptionKeyDown, handleBlur } = useDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    itemCount: 4,
    closeOnScroll: true,
  });

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isVerticalNavKey(e)) {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  const openProfileModal = (kind: ProfileModalKind) => {
    setIsOpen(false);
    setOpenModal(kind);
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
            <div className="px-3.5 py-2 text-xs text-text-muted border-b border-border">
              Signed in as <span className="font-medium text-text-secondary">{user.name}</span>
            </div>
            <div className="py-1">
              <button
                ref={setOptionRef(0)}
                role="menuitem"
                onClick={() => openProfileModal('name')}
                onKeyDown={(e) => handleOptionKeyDown(e, 0)}
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
                ref={setOptionRef(1)}
                role="menuitem"
                onClick={() => openProfileModal('color')}
                onKeyDown={(e) => handleOptionKeyDown(e, 1)}
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
                ref={setOptionRef(2)}
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  setShowNotificationSettings(true);
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, 2)}
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
                ref={setOptionRef(3)}
                role="menuitem"
                onClick={() => {
                  setIsOpen(false);
                  setShowSignOutConfirm(true);
                }}
                onKeyDown={(e) => handleOptionKeyDown(e, 3)}
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

      <ProfileModals
        open={openModal}
        onClose={() => {
          setOpenModal(null);
          triggerRef.current?.focus();
        }}
      />

      {showSignOutConfirm && (
        <ConfirmModal
          title="Sign out?"
          message="Signing back in needs a fresh login link sent to your email."
          confirmLabel="Sign out"
          onConfirm={() => {
            setShowSignOutConfirm(false);
            logout();
          }}
          onCancel={() => {
            setShowSignOutConfirm(false);
            triggerRef.current?.focus();
          }}
        />
      )}

      {showNotificationSettings && (
        <Modal
          title="Notification settings"
          onClose={() => {
            setShowNotificationSettings(false);
            triggerRef.current?.focus();
          }}
          maxWidth="sm"
        >
          <PushNotificationSettings />
        </Modal>
      )}
    </>
  );
}
