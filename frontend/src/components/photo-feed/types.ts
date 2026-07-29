import { ALLOWED_EMOJIS } from '@photodrop/common/reactions';
import type { PhotoSummary, ReactionWithUserJson } from '@photodrop/common/apiTypes';

export type {
  PhotoSummary as Photo,
  ReactionSummary,
  CommentJson as Comment,
} from '@photodrop/common/apiTypes';

/**
 * How the lightbox pushes a change to one photo back into the feed's list.
 * The functional form is given the feed's *live* copy of that photo, so a
 * caller holding only a snapshot taken when its request started can apply its
 * delta to current state instead of overwriting it — see the onSuccess
 * contract on ToggleReactionCallbacks.
 */
export type PhotoUpdate = Partial<PhotoSummary> | ((live: PhotoSummary) => Partial<PhotoSummary>);

export type OnPhotoUpdate = (photoId: string, update: PhotoUpdate) => void;

// The optimistic-update path creates these entries client-side, before the
// server has assigned a timestamp, so createdAt is omitted from the client
// type. Server responses (which include it) remain assignable.
export type ReactionWithUser = Omit<ReactionWithUserJson, 'createdAt'>;

// Widened from the const tuple so callers can pass arbitrary user-provided
// strings to indexOf/includes.
export const EMOJI_OPTIONS: readonly string[] = ALLOWED_EMOJIS;
export const LONG_PRESS_TIMEOUT_MS = 500;
