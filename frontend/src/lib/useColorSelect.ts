import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from './api';
import type { ProfileColor } from './profileColors';

export function useColorSelect(): (color: ProfileColor) => Promise<void> {
  const { updateProfileColor } = useAuth();

  return useCallback(
    async (color: ProfileColor) => {
      await api.users.updateProfile(color);
      updateProfileColor(color);
    },
    [updateProfileColor]
  );
}
