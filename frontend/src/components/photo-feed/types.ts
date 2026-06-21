import type { ProfileColor } from '../../lib/profileColors';

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface Photo {
  id: string;
  caption: string | null;
  uploadedBy: string;
  uploadedAt: number;
  commentCount: number;
  reactions: ReactionSummary[];
  userReaction: string | null;
}

export interface Comment {
  id: string;
  userId: string | null;
  authorName: string;
  authorProfileColor: ProfileColor | null;
  content: string;
  createdAt: number;
  isDeleted: boolean;
}

export interface ReactionWithUser {
  emoji: string;
  userId: string;
  userName: string;
  profileColor: string;
}

export const EMOJI_OPTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
export const LONG_PRESS_TIMEOUT_MS = 500;
