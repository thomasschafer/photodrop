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

  return { isRemoving, reactions, userReactions, details };
}
