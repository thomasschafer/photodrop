import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OnPhotoUpdate, Photo } from './types';
import type { ReactionActor } from './reactions';
import { usePhotoReactionsEngine, type ReactionKeyState } from './usePhotoReactionsEngine';

interface UseLightboxReactionsArgs {
  photo: Photo;
  prevPhoto: Photo | undefined;
  nextPhoto: Photo | undefined;
  user: ReactionActor | null;
  onPhotoUpdate: OnPhotoUpdate;
}

/**
 * Owns the lightbox's reaction state for the active photo: the optimistic
 * summary (counts shown in the UI), the detailed per-user list (names, loaded
 * lazily), and — via usePhotoReactionsEngine — a shared cache used to
 * prefetch neighbours so swiping is instant. All async work is guarded
 * against the user navigating away mid-flight.
 *
 * The summary, the user's own reactions, and the detail list are kept in one
 * ReactionKeyState (rather than three separate useState calls) so a rollback
 * can read-and-write all three atomically via a single functional update —
 * see the onRollback handler in handleReactionClick.
 */
export function useLightboxReactions({
  photo,
  prevPhoto,
  nextPhoto,
  user,
  onPhotoUpdate,
}: UseLightboxReactionsArgs) {
  const [reactionState, setReactionState] = useState<ReactionKeyState>({
    reactions: photo.reactions,
    userReactions: photo.userReactions,
    details: undefined,
  });

  const engine = usePhotoReactionsEngine();
  const currentPhotoIdRef = useRef(photo.id);

  // Reset to the active photo's state when it changes (using cached details if
  // we have them). Runs before the load effects below.
  useLayoutEffect(() => {
    currentPhotoIdRef.current = photo.id;
    setReactionState({
      reactions: photo.reactions,
      userReactions: photo.userReactions,
      details: engine.getCachedDetails(photo.id),
    });
    // Intentionally keyed on photo.id only: optimistic updates must not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  const loadReactionDetails = useCallback(async () => {
    await engine.loadDetails(photo.id, (loaded) => {
      if (currentPhotoIdRef.current === photo.id) {
        setReactionState((prev) => ({ ...prev, details: loaded }));
      }
    });
  }, [photo.id, engine]);

  // Load details once the active photo is known to have reactions.
  useEffect(() => {
    if (reactionState.reactions.length > 0) loadReactionDetails();
  }, [reactionState.reactions.length, loadReactionDetails]);

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
    await engine.toggleReactionForPhoto(photoId, reactionState, emoji, user, {
      onOptimisticUpdate: (next) => setReactionState(next),
      onSuccess: (reconcile) => {
        // Re-apply this toggle to the feed's live copy of the photo instead of
        // pushing the snapshot this toggle captured when it started: with two
        // different emojis in flight at once, whichever settled last would
        // otherwise overwrite the other's confirmed result (and swiping back
        // would re-seed us from that clobbered feed state).
        onPhotoUpdate(photoId, (live) => {
          const { reactions, userReactions } = reconcile({
            reactions: live.reactions,
            userReactions: live.userReactions,
          });
          return { reactions, userReactions };
        });
      },
      onRollback: (reconcile) => {
        // Only roll the visible state back if we're still on this photo.
        if (currentPhotoIdRef.current !== photoId) return;
        setReactionState((prev) => reconcile(prev));
      },
      onResync: (authoritative) => {
        // Absolute, not a delta: the feed and the lightbox may have drifted
        // apart (the feed only ever saw confirmed successes), so both are
        // overwritten with the server's answer rather than nudged.
        onPhotoUpdate(photoId, {
          reactions: authoritative.reactions,
          userReactions: authoritative.userReactions,
        });
        if (currentPhotoIdRef.current === photoId) {
          setReactionState(authoritative);
        }
      },
      onDetailsRefreshed: (refreshed) => {
        if (currentPhotoIdRef.current === photoId) {
          setReactionState((prev) => ({ ...prev, details: refreshed }));
        }
      },
    });
  };

  return {
    userReactions: reactionState.userReactions,
    reactions: reactionState.reactions,
    reactionDetails: reactionState.details,
    loadReactionDetails,
    handleReactionClick,
  };
}
