import type { ReactionSummary, ReactionWithUser } from './types';

/**
 * Pure optimistic-update logic for photo reactions, shared by the feed and the
 * lightbox so the two can't drift apart (an earlier divergence is what let a
 * bug live in one and not the other).
 *
 * A user has at most one reaction per photo. Tapping the emoji you already
 * picked removes it; tapping a different one switches to it.
 */

export interface ReactionState {
  userReaction: string | null;
  reactions: ReactionSummary[];
}

export interface ReactionToggleResult extends ReactionState {
  isRemoving: boolean;
}

/** Apply a tap on `emoji` to the reaction summary, returning the next state. */
export function toggleReaction(
  userReaction: string | null,
  reactions: ReactionSummary[],
  emoji: string
): ReactionToggleResult {
  const isRemoving = userReaction === emoji;

  const decrement = (list: ReactionSummary[], target: string) =>
    list
      .map((r) => (r.emoji === target ? { ...r, count: r.count - 1 } : r))
      .filter((r) => r.count > 0);

  if (isRemoving) {
    return { userReaction: null, reactions: decrement(reactions, emoji), isRemoving };
  }

  // Switching reactions: drop the previous one before adding the new.
  const base = userReaction ? decrement(reactions, userReaction) : [...reactions];
  const next = base.some((r) => r.emoji === emoji)
    ? base.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r))
    : [...base, { emoji, count: 1 }];

  return { userReaction: emoji, reactions: next, isRemoving };
}

/**
 * Apply the same tap to the detailed per-user list (used for the names
 * tooltip). The acting user can only have one entry, so we always drop theirs
 * first and re-add it unless this was a removal.
 */
export function toggleReactionDetails(
  details: ReactionWithUser[],
  user: { id: string; name: string; profileColor: string },
  emoji: string,
  isRemoving: boolean
): ReactionWithUser[] {
  const withoutUser = details.filter((r) => r.userId !== user.id);
  if (isRemoving) {
    return withoutUser;
  }
  return [
    ...withoutUser,
    { emoji, userId: user.id, userName: user.name, profileColor: user.profileColor },
  ];
}
