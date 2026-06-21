import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Photo, ReactionSummary, ReactionWithUser } from './types';
import { toggleReaction, toggleReactionDetails } from './reactions';

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
  const [userReaction, setUserReaction] = useState<string | null>(photo.userReaction);
  const [reactions, setReactions] = useState<ReactionSummary[]>(photo.reactions);
  const [details, setDetails] = useState<ReactionWithUser[]>([]);

  const cache = useRef<Map<string, ReactionWithUser[]>>(new Map());
  const currentPhotoIdRef = useRef(photo.id);
  const loadingRef = useRef(false);

  // Reset to the active photo's state when it changes (using cached details if
  // we have them). Runs before the load effects below.
  useLayoutEffect(() => {
    currentPhotoIdRef.current = photo.id;
    setUserReaction(photo.userReaction);
    setReactions(photo.reactions);
    setDetails(cache.current.get(photo.id) ?? []);
    // Intentionally keyed on photo.id only: optimistic updates must not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  // Single fetch path shared by load and prefetch: fetch, cache, return.
  const fetchDetails = useCallback(async (photoId: string): Promise<ReactionWithUser[]> => {
    const data = await api.photos.getReactions(photoId);
    cache.current.set(photoId, data.reactions);
    return data.reactions;
  }, []);

  const loadReactionDetails = useCallback(async () => {
    if (loadingRef.current) return;

    const cached = cache.current.get(photo.id);
    if (cached) {
      if (currentPhotoIdRef.current === photo.id) setDetails(cached);
      return;
    }

    loadingRef.current = true;
    try {
      const fetched = await fetchDetails(photo.id);
      if (currentPhotoIdRef.current === photo.id) setDetails(fetched);
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
    const previous = { userReaction, reactions, details };

    const {
      userReaction: nextUserReaction,
      reactions: nextReactions,
      isRemoving,
    } = toggleReaction(userReaction, reactions, emoji);
    const nextDetails = toggleReactionDetails(details, user, emoji, isRemoving);

    setUserReaction(nextUserReaction);
    setReactions(nextReactions);
    setDetails(nextDetails);
    cache.current.set(photoId, nextDetails);

    try {
      if (isRemoving) {
        await api.photos.removeReaction(photoId);
      } else {
        await api.photos.addReaction(photoId, emoji);
      }
      onPhotoUpdate({ id: photoId, userReaction: nextUserReaction, reactions: nextReactions });
    } catch (err) {
      console.error('Failed to update reaction:', err);
      cache.current.set(photoId, previous.details);
      // Only roll the visible state back if we're still on this photo.
      if (currentPhotoIdRef.current === photoId) {
        setUserReaction(previous.userReaction);
        setReactions(previous.reactions);
        setDetails(previous.details);
      }
    }
  };

  return {
    userReaction,
    reactions,
    reactionDetails: details,
    loadReactionDetails,
    handleReactionClick,
  };
}
