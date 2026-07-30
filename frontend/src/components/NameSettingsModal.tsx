import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../lib/api';
import { displayNameFromInput } from '../lib/displayName';
import { notifyFeedRefresh } from '../lib/feedRefresh';
import { useProfileSave } from '../lib/useProfileSave';
import { Button } from './Button';
import { Modal } from './Modal';
import { NameField } from './NameField';

/**
 * The per-group display name is not part of auth state — /auth/refresh doesn't
 * carry it, so anything cached would go stale on a group switch — and it must
 * never be guessed: an empty field is a request to clear the override, so
 * rendering an editable field over an unknown value could silently wipe one.
 * 'unavailable' therefore hides the field entirely rather than showing a blank.
 */
type DisplayNameState =
  | { status: 'loading' }
  | { status: 'ready'; saved: string | null; value: string }
  | { status: 'unavailable' };

interface NameSettingsModalProps {
  onClose: () => void;
}

export function NameSettingsModal({ onClose }: NameSettingsModalProps) {
  const { user, currentGroup } = useAuth();
  const saveProfile = useProfileSave();
  const [name, setName] = useState(user?.name ?? '');
  const [displayName, setDisplayName] = useState<DisplayNameState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupId = currentGroup?.id;

  useEffect(() => {
    if (!groupId) {
      setDisplayName({ status: 'unavailable' });
      return;
    }

    let cancelled = false;
    api.users
      .getMe()
      .then((me) => {
        if (cancelled) return;
        setDisplayName({
          status: 'ready',
          saved: me.currentGroupDisplayName,
          value: me.currentGroupDisplayName ?? '',
        });
      })
      .catch((err) => {
        console.error('Failed to load the current group display name:', err);
        if (!cancelled) setDisplayName({ status: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (!user) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Your name cannot be empty.');
      return;
    }

    const nextDisplayName =
      displayName.status === 'ready' ? displayNameFromInput(displayName.value) : undefined;
    const displayNameChanged =
      displayName.status === 'ready' && nextDisplayName !== displayName.saved;
    const nameChanged = trimmedName !== user.name;

    if (!nameChanged && !displayNameChanged) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (nameChanged) {
        await saveProfile({ name: trimmedName });
      }
      if (displayNameChanged) {
        // Unreachable: the field only reaches 'ready' after a fetch that a
        // current group gated. Fail loudly rather than send a request to a
        // group we can't name.
        if (!groupId) throw new Error('No current group to set a display name in');
        const updated = await api.groups.setMemberDisplayName(
          groupId,
          user.id,
          nextDisplayName ?? null
        );
        setDisplayName({
          status: 'ready',
          saved: updated.displayName,
          value: updated.displayName ?? '',
        });
        // saveProfile notifies for canonical-name changes; a display-name-only
        // save must re-sync feed bylines too.
        notifyFeedRefresh();
      }
      onClose();
    } catch (err) {
      console.error('Failed to save name settings:', err);
      // A partial save (canonical name stored, display name rejected) leaves the
      // modal open on the up-to-date values, so retrying only sends what's left.
      setError(err instanceof ApiError ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Name settings" onClose={onClose} maxWidth="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <NameField
          id="profile-name"
          label="Your name"
          value={name}
          onChange={setName}
          disabled={saving}
          autoFocus
          hint="Shown everywhere in photodrop, and in every group you're in. Only you can change it."
        />

        {currentGroup && (
          <div>
            {displayName.status === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="spinner spinner-sm" />
                Loading your display name in {currentGroup.name}...
              </div>
            )}

            {displayName.status === 'unavailable' && (
              <p className="text-sm text-error" role="alert">
                Couldn't load your display name in {currentGroup.name}. Close this and try again to
                change it.
              </p>
            )}

            {displayName.status === 'ready' && (
              <NameField
                id="profile-display-name"
                label={`Display name in ${currentGroup.name}`}
                value={displayName.value}
                onChange={(value) =>
                  setDisplayName((prev) => (prev.status === 'ready' ? { ...prev, value } : prev))
                }
                placeholder={user.name}
                disabled={saving}
                hint={
                  <>
                    Optional. Leave this empty to appear as{' '}
                    <span className="font-medium">{user.name}</span> here, like everywhere else.
                    Group admins can see both names.
                  </>
                }
              />
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button type="button" onClick={onClose} disabled={saving} variant="secondary" size="md">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} size="md">
            {saving ? <span className="spinner spinner-sm" /> : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
