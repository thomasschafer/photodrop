import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Photo, ReactionSummary, ReactionWithUser } from './types';
import type { ReactionActor } from './reactions';
import { usePhotoReactionsEngine } from './usePhotoReactionsEngine';

interface UseLightboxReactionsArgs {
  photo: Photo;
  prevPhoto: Photo | undefined;
  nextPhoto: Photo | undefined;
  user: ReactionActor | null;
  onPhotoUpdate: (photo: Partial<Photo> & { id: string }) => void;
}

/**
 * Owns the lightbox's reaction state for the active photo: the optimistic
 * summary (counts shown in the UI), the detailed per-user list (names, loaded
 * lazily), and — via usePhotoReactionsEngine — a shared cache used to
 * prefetch neighbours so swiping is instant. All async work is guarded
 * against the user navigating away mid-flight.
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

  const engine = usePhotoReactionsEngine();
  const currentPhotoIdRef = useRef(photo.id);

  // Reset to the active photo's state when it changes (using cached details if
  // we have them). Runs before the load effects below.
  useLayoutEffect(() => {
    currentPhotoIdRef.current = photo.id;
    setUserReactions(photo.userReactions);
    setReactions(photo.reactions);
    setDetails(engine.getCachedDetails(photo.id));
    // Intentionally keyed on photo.id only: optimistic updates must not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  const loadReactionDetails = useCallback(async () => {
    await engine.loadDetails(photo.id, (loaded) => {
      if (currentPhotoIdRef.current === photo.id) setDetails(loaded);
    });
  }, [photo.id, engine]);

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
      if (!photoId || !hasReactions || engine.getCachedDetails(photoId)) return;
      engine.fetchDetails(photoId).catch(() => {
        /* prefetch is best-effort */
      });
    };
    prefetch(prevId, prevHasReactions);
    prefetch(nextId, nextHasReactions);
  }, [prevId, nextId, prevHasReactions, nextHasReactions, engine]);

  const handleReactionClick = async (emoji: string) => {
    if (!user) return;

    const photoId = photo.id;
    await engine.toggleReactionForPhoto(
      photoId,
      { reactions, userReactions, details },
      emoji,
      user,
      {
        onOptimisticUpdate: (next) => {
          setUserReactions(next.userReactions);
          setReactions(next.reactions);
          if (next.details !== undefined) setDetails(next.details);
        },
        onSuccess: (next) => {
          onPhotoUpdate({
            id: photoId,
            userReactions: next.userReactions,
            reactions: next.reactions,
          });
        },
        onRollback: (previous) => {
          // Only roll the visible state back if we're still on this photo.
          if (currentPhotoIdRef.current === photoId) {
            setUserReactions(previous.userReactions);
            setReactions(previous.reactions);
            setDetails(previous.details);
          }
        },
        onDetailsRefreshed: (refreshed) => {
          if (currentPhotoIdRef.current === photoId) setDetails(refreshed);
        },
      }
    );
  };

  return {
    userReactions,
    reactions,
    reactionDetails: details,
    loadReactionDetails,
    handleReactionClick,
  };
}
