import { ALLOWED_EMOJIS } from '@photodrop/common/reactions';
import type { ReactionWithUserJson } from '@photodrop/common/apiTypes';

export type {
  PhotoSummary as Photo,
  ReactionSummary,
  CommentJson as Comment,
} from '@photodrop/common/apiTypes';

// The optimistic-update path creates these entries client-side, before the
// server has assigned a timestamp, so createdAt is omitted from the client
// type. Server responses (which include it) remain assignable.
export type ReactionWithUser = Omit<ReactionWithUserJson, 'createdAt'>;

// Widened from the const tuple so callers can pass arbitrary user-provided
// strings to indexOf/includes.
export const EMOJI_OPTIONS: readonly string[] = ALLOWED_EMOJIS;
export const LONG_PRESS_TIMEOUT_MS = 500;
