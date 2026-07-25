/**
 * Wire types for the photodrop HTTP API, shared by the backend (which builds
 * these shapes, checked via `satisfies`) and the frontend API client (which
 * consumes them), so drift between the two is a compile error.
 */
import type { ProfileColor } from './profileColors';

export type MembershipRole = 'admin' | 'member';

export interface UserJson {
  id: string;
  name: string;
  email: string;
  profileColor: ProfileColor;
}

export interface GroupJson {
  id: string;
  name: string;
  role: MembershipRole;
  ownerId: string;
  imageProtection: boolean;
}

/**
 * Issued by login/refresh/group-selection endpoints. `accessToken` is null
 * when the session is alive but no group is active (e.g. the user must pick
 * one); `selectionToken` is what authorises that pick.
 */
export interface AuthResponse {
  accessToken: string | null;
  selectionToken?: string | null;
  user: UserJson;
  currentGroup?: GroupJson | null;
  groups: GroupJson[];
  needsGroupSelection?: boolean;
}

/** Returned instead of AuthResponse when a new invitee must supply a name. */
export interface NeedsNameResponse {
  needsName: true;
  email: string;
  groupId: string;
}

export interface MeResponse extends UserJson {
  createdAt: number;
  lastSeenAt: number | null;
  currentGroup: GroupJson | null;
  groups: GroupJson[];
}

export interface MessageResponse {
  message: string;
}

// Photos

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface PhotoSummary {
  id: string;
  caption: string | null;
  uploadedBy: string;
  uploadedAt: number;
  commentCount: number;
  reactions: ReactionSummary[];
  userReactions: string[];
}

export interface PhotoListResponse {
  photos: PhotoSummary[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PhotoDetailResponse {
  id: string;
  caption: string | null;
  uploadedBy: string;
  uploadedAt: number;
}

export interface PhotoUploadResponse extends MessageResponse {
  id: string;
}

export interface PhotoViewersResponse {
  viewers: Array<{ userId: string; viewedAt: number }>;
}

export interface ReactionMutationResponse extends MessageResponse {
  emoji: string;
}

export interface ReactionWithUserJson {
  emoji: string;
  userId: string;
  userName: string;
  profileColor: ProfileColor;
  createdAt: number;
}

export interface ReactionsResponse {
  reactions: ReactionWithUserJson[];
}

export interface CommentJson {
  id: string;
  userId: string | null;
  authorName: string;
  authorProfileColor: ProfileColor | null;
  content: string;
  createdAt: number;
  isDeleted: boolean;
}

export interface CommentsResponse {
  comments: CommentJson[];
}

export interface CommentCreatedResponse extends MessageResponse {
  id: string;
}

// Groups

export interface GroupsListResponse {
  groups: Array<{
    id: string;
    name: string;
    role: MembershipRole;
    ownerId: string;
    joinedAt: number;
  }>;
}

export interface MemberJson {
  userId: string;
  name: string;
  email: string;
  profileColor: ProfileColor;
  role: MembershipRole;
  joinedAt: number;
  imageProtection: boolean;
}

export interface MembersResponse {
  ownerId: string | null;
  members: MemberJson[];
}

export interface PhotoCountResponse {
  count: number;
}

export interface GroupDeletedResponse extends MessageResponse {
  deletedFiles: number;
}

// Users

export interface UsersListResponse {
  users: Array<{
    id: string;
    name: string;
    email: string;
    profileColor: ProfileColor;
    role: MembershipRole;
    joinedAt: number;
  }>;
}

export interface ProfileUpdatedResponse extends MessageResponse {
  profileColor: ProfileColor;
}

// Push

export interface VapidPublicKeyResponse {
  publicKey: string;
}

export interface PushSubscribedResponse extends MessageResponse {
  deletionToken: string;
}

export interface PushStatusResponse {
  subscribed: boolean;
}

export interface DeviceStatusResponse {
  registered: boolean;
}
