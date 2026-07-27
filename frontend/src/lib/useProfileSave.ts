import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api, type ProfileUpdate } from './api';

/**
 * Persist a change to the signed-in user's own profile and apply it to auth
 * state. The stored values from the response are applied rather than the ones
 * requested, so the UI can never end up asserting something the server didn't
 * save. Rejects on failure — callers own how the error is surfaced.
 */
export function useProfileSave(): (update: ProfileUpdate) => Promise<void> {
  const { updateProfile } = useAuth();

  return useCallback(
    async (update: ProfileUpdate) => {
      const saved = await api.users.updateProfile(update);
      updateProfile({ name: saved.name, profileColor: saved.profileColor });
    },
    [updateProfile]
  );
}
