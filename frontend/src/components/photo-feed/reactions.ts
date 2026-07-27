import type { ProfileColor } from '../../lib/profileColors';
import type { ReactionSummary, ReactionWithUser } from './types';

export interface ReactionActor {
  id: string;
  name: string;
  profileColor: ProfileColor;
}

export interface ReactionState {
  reactions: ReactionSummary[];
  userReactions: string[];
  // Per-user reaction breakdown, when it has been loaded. Left undefined when
  // details haven't been fetched yet so callers can skip updating them.
  details?: ReactionWithUser[];
}

export interface ToggleReactionResult extends ReactionState {
  isRemoving: boolean;
}

/**
 * Applies an add-or-remove of `emoji` by `actor` to `state`, given which
 * direction to apply. Each of the three fields is derived solely from its own
 * counterpart in `state` plus `isRemoving` — none of them read the others —
 * so this is safe to call with only one field populated (and the rest left
 * empty/undefined) to update that field alone; see invertReaction.
 *
 * Exported so a settled toggle can be re-applied to a *different* holder of
 * the same photo's state (the feed's list, synced from the lightbox) at the
 * time it settles, rather than that holder being overwritten with a snapshot
 * captured when the toggle began.
 */
export function applyReaction(
  state: ReactionState,
  emoji: string,
  actor: ReactionActor,
  isRemoving: boolean
): ReactionState {
  let reactions: ReactionSummary[];
  if (isRemoving) {
    reactions = state.reactions
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1 } : r))
      .filter((r) => r.count > 0);
  } else {
    const existing = state.reactions.find((r) => r.emoji === emoji);
    reactions = existing
      ? state.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r))
      : [...state.reactions, { emoji, count: 1 }];
  }

  const userReactions = isRemoving
    ? state.userReactions.filter((e) => e !== emoji)
    : [...state.userReactions, emoji];

  let details = state.details;
  if (details) {
    details = details.filter((r) => !(r.userId === actor.id && r.emoji === emoji));
    if (!isRemoving) {
      details = [
        ...details,
        { emoji, userId: actor.id, userName: actor.name, profileColor: actor.profileColor },
      ];
    }
  }

  return { reactions, userReactions, details };
}

/**
 * Compute the next reaction state when the current user toggles an emoji on a
 * photo. Adding an emoji the user already reacted with is treated as a removal.
 * Pure and shared between the feed and lightbox optimistic-update paths.
 */
export function toggleReaction(
  state: ReactionState,
  emoji: string,
  actor: ReactionActor
): ToggleReactionResult {
  const isRemoving = state.userReactions.includes(emoji);
  return { isRemoving, ...applyReaction(state, emoji, actor, isRemoving) };
}

/**
 * Undo a specific toggle against whatever `live` is now, rather than
 * restoring a stale pre-toggle snapshot. `wasRemoving` is the `isRemoving`
 * of the original (now-failed) toggle, captured at the time it started; the
 * inverse of a remove is an add and vice versa, applied to the current live
 * state so any other change made to `live` in the meantime (e.g. a
 * concurrent toggle of a different emoji) survives untouched.
 */
export function invertReaction(
  live: ReactionState,
  emoji: string,
  actor: ReactionActor,
  wasRemoving: boolean
): ReactionState {
  return applyReaction(live, emoji, actor, !wasRemoving);
}
