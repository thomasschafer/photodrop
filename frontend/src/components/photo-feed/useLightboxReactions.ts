import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Photo, ReactionSummary, ReactionWithUser } from './types';
import { toggleReaction } from './reactions';

interface ReactionUser {
  id: string;
  name: string;
  profileColor: string;
}

interface UseLightboxReactionsArgs {
  photo: Photo;
  prevPhoto: Photo | undefined;
  nextPhoto: Photo | undefined;
  user: ReactionUser | null;
  onPhotoUpdate: (photo: Partial<Photo> & { id: string }) => void;
}

/**
 * Owns the lightbox's reaction state for the active photo: the optimistic
 * summary (counts shown in the UI), the detailed per-user list (names, loaded
 * lazily), and a shared cache used to prefetch neighbours so swiping is
 * instant. All async work is guarded against the user navigating away mid-flight.
 */
export function useLightboxReactions({
  photo,
  prevPhoto,
  nextPhoto,
  user,
  onPhotoUpdate,
}: UseLightboxReactionsArgs) {
  const [userReactions, setUserReactions] = useState<string[]>(photo.userReactions);
  const [reactions, setReactions] = useState<ReactionSummary[]>(photo.reactions);
  const [details, setDetails] = useState<ReactionWithUser[] | undefined>();

  const cache = useRef<Map<string, ReactionWithUser[]>>(new Map());
  const cacheVersions = useRef<Map<string, number>>(new Map());
  const pendingMutationCounts = useRef<Map<string, number>>(new Map());
  const currentPhotoIdRef = useRef(photo.id);
  const loadingRef = useRef(false);

  const bumpCacheVersion = useCallback((photoId: string) => {
    cacheVersions.current.set(photoId, (cacheVersions.current.get(photoId) ?? 0) + 1);
  }, []);

  const beginPendingMutation = useCallback((photoId: string) => {
    pendingMutationCounts.current.set(
      photoId,
      (pendingMutationCounts.current.get(photoId) ?? 0) + 1
    );
  }, []);

  const endPendingMutation = useCallback((photoId: string) => {
    const nextCount = (pendingMutationCounts.current.get(photoId) ?? 1) - 1;
    if (nextCount > 0) {
      pendingMutationCounts.current.set(photoId, nextCount);
    } else {
      pendingMutationCounts.current.delete(photoId);
    }
  }, []);

  const hasPendingMutation = useCallback(
    (photoId: string) => pendingMutationCounts.current.has(photoId),
    []
  );

  // Reset to the active photo's state when it changes (using cached details if
  // we have them). Runs before the load effects below.
  useLayoutEffect(() => {
    currentPhotoIdRef.current = photo.id;
    setUserReactions(photo.userReactions);
    setReactions(photo.reactions);
    setDetails(cache.current.get(photo.id));
    // Intentionally keyed on photo.id only: optimistic updates must not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  // Single fetch path shared by load, refresh, and prefetch. A request is only
  // allowed to write if no optimistic mutation started while it was in flight.
  const fetchDetails = useCallback(
    async (photoId: string): Promise<ReactionWithUser[] | undefined> => {
      const versionAtStart = cacheVersions.current.get(photoId) ?? 0;
      const startedDuringMutation = hasPendingMutation(photoId);
      const data = await api.photos.getReactions(photoId);

      if (startedDuringMutation || (cacheVersions.current.get(photoId) ?? 0) !== versionAtStart) {
        return undefined;
      }

      cache.current.set(photoId, data.reactions);
      return data.reactions;
    },
    [hasPendingMutation]
  );

  const loadReactionDetails = useCallback(async () => {
    if (loadingRef.current) return;

    const cached = cache.current.get(photo.id);
    if (cached !== undefined) {
      if (currentPhotoIdRef.current === photo.id) setDetails(cached);
      return;
    }

    loadingRef.current = true;
    try {
      const fetched = await fetchDetails(photo.id);
      if (fetched !== undefined && currentPhotoIdRef.current === photo.id) setDetails(fetched);
    } catch (err) {
      console.error('Failed to load reaction details:', err);
    } finally {
      loadingRef.current = false;
    }
  }, [photo.id, fetchDetails]);

  // Load details once the active photo is known to have reactions.
  useEffect(() => {
    if (reactions.length > 0) loadReactionDetails();
  }, [reactions.length, loadReactionDetails]);

  // Prefetch neighbours that have reactions so their names are ready on swipe.
  const prevId = prevPhoto?.id;
  const nextId = nextPhoto?.id;
  const prevHasReactions = (prevPhoto?.reactions.length ?? 0) > 0;
  const nextHasReactions = (nextPhoto?.reactions.length ?? 0) > 0;
  useEffect(() => {
    const prefetch = (photoId: string | undefined, hasReactions: boolean) => {
      if (!photoId || !hasReactions || cache.current.has(photoId)) return;
      fetchDetails(photoId).catch(() => {
        /* prefetch is best-effort */
      });
    };
    prefetch(prevId, prevHasReactions);
    prefetch(nextId, nextHasReactions);
  }, [prevId, nextId, prevHasReactions, nextHasReactions, fetchDetails]);

  const handleReactionClick = async (emoji: string) => {
    if (!user) return;

    const photoId = photo.id;
    const previous = { userReactions, reactions, details };
    bumpCacheVersion(photoId);
    beginPendingMutation(photoId);

    const {
      reactions: nextReactions,
      userReactions: nextUserReactions,
      details: nextDetails,
      isRemoving,
    } = toggleReaction({ reactions, userReactions, details }, emoji, user);

    setUserReactions(nextUserReactions);
    setReactions(nextReactions);
    if (nextDetails !== undefined) {
      setDetails(nextDetails);
      cache.current.set(photoId, nextDetails);
    }

    try {
      if (isRemoving) {
        await api.photos.removeReaction(photoId, emoji);
      } else {
        await api.photos.addReaction(photoId, emoji);
      }
      onPhotoUpdate({ id: photoId, userReactions: nextUserReactions, reactions: nextReactions });
    } catch (err) {
      console.error('Failed to update reaction:', err);
      endPendingMutation(photoId);
      bumpCacheVersion(photoId);
      if (previous.details !== undefined) {
        cache.current.set(photoId, previous.details);
      } else {
        cache.current.delete(photoId);
      }
      // Only roll the visible state back if we're still on this photo.
      if (currentPhotoIdRef.current === photoId) {
        setUserReactions(previous.userReactions);
        setReactions(previous.reactions);
        setDetails(previous.details);
      }
      return;
    }

    endPendingMutation(photoId);
    if (previous.details === undefined && !hasPendingMutation(photoId)) {
      try {
        const refreshed = await fetchDetails(photoId);
        if (refreshed !== undefined && currentPhotoIdRef.current === photoId) {
          setDetails(refreshed);
        }
      } catch (err) {
        console.error('Failed to refresh reaction details:', err);
      }
    }
  };

  return {
    userReactions,
    reactions,
    reactionDetails: details,
    loadReactionDetails,
    handleReactionClick,
  };
}
