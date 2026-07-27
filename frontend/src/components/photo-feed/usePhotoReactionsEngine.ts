import { useCallback, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import type { ReactionSummary, ReactionWithUser } from './types';
import { toggleReaction, invertReaction, applyReaction, type ReactionActor } from './reactions';

export interface ReactionKeyState {
  reactions: ReactionSummary[];
  userReactions: string[];
  details?: ReactionWithUser[];
}

interface ToggleReactionCallbacks {
  /** Apply the optimistic reactions/userReactions/details immediately. */
  onOptimisticUpdate: (next: ReactionKeyState) => void;
  /**
   * Called once the API call confirms the mutation, before the optional
   * details refetch. Distinct from onOptimisticUpdate because some callers
   * (the lightbox, syncing the feed's photo list) must not propagate a
   * mutation that might still be rolled back.
   *
   * Receives a reconciler for the same reason onRollback does: it applies
   * this toggle's own delta to whatever the target's LIVE state is when this
   * fires, so a concurrent toggle of a *different* emoji that settled first
   * survives instead of being clobbered by the snapshot this toggle captured
   * when it began. The target is the state being synced *from* this toggle
   * (e.g. the feed's copy of the photo) — one that has NOT already had this
   * toggle's optimistic update applied, since re-applying it there would
   * double-count. As with onRollback, each field of ReactionKeyState is
   * derived independently of the others (see reactions.ts), so the reconciler
   * can be applied per field. Skipped if a newer toggle of the same
   * photo+emoji has since started — see the "last toggle wins" note on
   * toggleReactionForPhoto.
   */
  onSuccess?: (reconcile: (live: ReactionKeyState) => ReactionKeyState) => void;
  /**
   * Called after the API call fails, undoing only this toggle's own effect.
   * Receives a reconciler rather than a value: apply it to whatever the
   * caller's LIVE state is at the time this fires (e.g. via a functional
   * state update), not the state captured when the toggle began, so a
   * concurrent toggle of a different emoji on the same photo survives. Each
   * field of ReactionKeyState is derived independently of the others (see
   * reactions.ts), so it's safe to call the reconciler separately per field
   * when a caller's reactions/userReactions/details live in different state
   * containers. Skipped if a newer toggle of the same photo+emoji has since
   * started — see the "last toggle wins" note on toggleReactionForPhoto.
   */
  onRollback: (reconcile: (live: ReactionKeyState) => ReactionKeyState) => void;
  /**
   * Called with a fresh detail list once it's fetched after a mutation that
   * had no details loaded yet. The caller decides whether it still cares
   * (e.g. the lightbox only applies this if the user hasn't navigated away).
   */
  onDetailsRefreshed?: (details: ReactionWithUser[]) => void;
}

/**
 * The optimistic-reaction engine shared by the feed and the lightbox: a
 * per-photo cache of the detailed (per-user) reaction list, guarded against
 * a fetch resolving after — and clobbering — a newer optimistic mutation,
 * plus the toggle-reaction mutation flow itself (optimistic apply, API call,
 * rollback, and a follow-up detail refresh).
 *
 * Summary state (`reactions`/`userReactions`) is NOT owned here — the feed
 * keeps it on its `photos` array, the lightbox keeps local state synced back
 * via `onPhotoUpdate` — this only owns the bookkeeping that's identical
 * either way. Each call site gets its own cache; the feed and the lightbox do
 * not share one (each already refetches independently).
 */
export function usePhotoReactionsEngine() {
  const cache = useRef<Map<string, ReactionWithUser[]>>(new Map());
  const cacheVersions = useRef<Map<string, number>>(new Map());
  const pendingMutationCounts = useRef<Map<string, number>>(new Map());
  const inFlightLoads = useRef<Set<string>>(new Set());
  // One counter per photo+emoji, bumped each time a toggle of that emoji
  // starts. Settle-time callbacks (onSuccess/onRollback) only fire for the
  // toggle that was most recently started for its key — see
  // toggleReactionForPhoto for why.
  const emojiMutationVersions = useRef<Map<string, number>>(new Map());

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

  const getCachedDetails = useCallback((photoId: string) => cache.current.get(photoId), []);

  // Drop all cached details (but not the version/pending bookkeeping, which
  // stays valid across a reload). Used when the underlying data may have
  // changed server-side outside of this engine's own mutations — e.g. a full
  // feed refresh — so a stale cached entry doesn't serve outdated names.
  const resetCache = useCallback(() => {
    cache.current.clear();
  }, []);

  // Single fetch path shared by load, refresh, and prefetch. A request is
  // only allowed to write if no optimistic mutation started while it was in
  // flight — checked both before the request (a mutation already pending)
  // and after (a mutation began and bumped the version while we awaited).
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

  // Load details for a photo unless already cached or already in flight.
  // Deliberately checks the ref cache rather than accepting an
  // "alreadyLoaded" flag from the caller's React state: callers that must
  // exclude their state from this function's dependencies (to avoid
  // reload loops — see useLightboxReactions) would otherwise risk reading a
  // stale value through a memoized closure. The ref is always current.
  // Also deduplicates concurrent calls (e.g. two rapid hover events) so only
  // one fetch happens per photo at a time.
  const loadDetails = useCallback(
    async (photoId: string, onLoaded: (details: ReactionWithUser[]) => void) => {
      if (inFlightLoads.current.has(photoId)) return;

      const cached = cache.current.get(photoId);
      if (cached !== undefined) {
        onLoaded(cached);
        return;
      }

      inFlightLoads.current.add(photoId);
      try {
        const fetched = await fetchDetails(photoId);
        if (fetched !== undefined) onLoaded(fetched);
      } catch (err) {
        console.error('Failed to load reaction details:', err);
      } finally {
        inFlightLoads.current.delete(photoId);
      }
    },
    [fetchDetails]
  );

  const toggleReactionForPhoto = useCallback(
    async (
      photoId: string,
      current: ReactionKeyState,
      emoji: string,
      actor: ReactionActor,
      { onOptimisticUpdate, onSuccess, onRollback, onDetailsRefreshed }: ToggleReactionCallbacks
    ) => {
      // Two toggles of the *same* emoji on the same photo can overlap (a
      // rapid double-tap, or a retry before the first settles). Which one
      // should win isn't reconstructible in general once both have failed or
      // raced each other server-side, so rather than guess we pick a
      // documented, deterministic rule: only the most recently *started*
      // toggle for a given photo+emoji is allowed to report its outcome
      // (onSuccess/onRollback). An earlier one that settles after being
      // superseded is a no-op — the newer toggle already reflects the latest
      // user intent and owns reconciling that emoji's state going forward.
      // Toggles of a *different* emoji (or a different photo) are unaffected
      // and always report their own outcome.
      const emojiKey = `${photoId} ${emoji}`;
      const version = (emojiMutationVersions.current.get(emojiKey) ?? 0) + 1;
      emojiMutationVersions.current.set(emojiKey, version);
      const isLatestForEmoji = () => emojiMutationVersions.current.get(emojiKey) === version;

      bumpCacheVersion(photoId);
      beginPendingMutation(photoId);

      const { reactions, userReactions, details, isRemoving } = toggleReaction(
        current,
        emoji,
        actor
      );

      onOptimisticUpdate({ reactions, userReactions, details });
      if (details !== undefined) {
        cache.current.set(photoId, details);
      }

      try {
        if (isRemoving) {
          await api.photos.removeReaction(photoId, emoji);
        } else {
          await api.photos.addReaction(photoId, emoji);
        }
      } catch (err) {
        console.error('Failed to update reaction:', err);
        endPendingMutation(photoId);
        bumpCacheVersion(photoId);
        if (isLatestForEmoji()) {
          const reconcile = (live: ReactionKeyState) =>
            invertReaction(live, emoji, actor, isRemoving);
          const invertedCache = reconcile({
            reactions: [],
            userReactions: [],
            details: cache.current.get(photoId),
          }).details;
          if (invertedCache !== undefined) {
            cache.current.set(photoId, invertedCache);
          } else {
            cache.current.delete(photoId);
          }
          onRollback(reconcile);
        }
        return;
      }

      if (isLatestForEmoji()) {
        onSuccess?.((live) => applyReaction(live, emoji, actor, isRemoving));
      }

      endPendingMutation(photoId);
      if (current.details === undefined && !hasPendingMutation(photoId)) {
        try {
          const refreshed = await fetchDetails(photoId);
          if (refreshed !== undefined) {
            onDetailsRefreshed?.(refreshed);
          }
        } catch (err) {
          console.error('Failed to refresh reaction details:', err);
        }
      }
    },
    [bumpCacheVersion, beginPendingMutation, endPendingMutation, hasPendingMutation, fetchDetails]
  );

  // Every member is individually memoized, so memoize the container too:
  // consumers depend on the engine's identity being stable (see the effect
  // dependency arrays in useLightboxReactions and PhotoFeed), and returning a
  // fresh object literal each render would silently invalidate them.
  return useMemo(
    () => ({
      fetchDetails,
      getCachedDetails,
      resetCache,
      loadDetails,
      toggleReactionForPhoto,
    }),
    [fetchDetails, getCachedDetails, resetCache, loadDetails, toggleReactionForPhoto]
  );
}

export type PhotoReactionsEngine = ReturnType<typeof usePhotoReactionsEngine>;
