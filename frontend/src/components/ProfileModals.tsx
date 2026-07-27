import { useAuth } from '../contexts/AuthContext';
import { useProfileSave } from '../lib/useProfileSave';
import type { ProfileColor } from '../lib/profileColors';
import { ColorPickerModal } from './ColorPickerModal';
import { NameSettingsModal } from './NameSettingsModal';

/** Which of the signed-in user's own settings a menu has opened, if any. */
export type ProfileModalKind = 'color' | 'name';

interface ProfileModalsProps {
  open: ProfileModalKind | null;
  onClose: () => void;
}

/**
 * The signed-in user's own settings modals, shared by the desktop user menu and
 * the mobile menu so the two offer exactly the same surfaces.
 */
export function ProfileModals({ open, onClose }: ProfileModalsProps) {
  const { user } = useAuth();
  const saveProfile = useProfileSave();

  if (!user || open === null) return null;

  if (open === 'color') {
    return (
      <ColorPickerModal
        currentColor={user.profileColor}
        onSelect={(profileColor: ProfileColor) => saveProfile({ profileColor })}
        onClose={onClose}
      />
    );
  }

  return <NameSettingsModal onClose={onClose} />;
}
