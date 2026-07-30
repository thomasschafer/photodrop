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
  /**
   * The caller's display-name override in `currentGroup`, or null when unset
   * (or no current group). Lets the client render the user's own identity
   * group-resolved, like it renders everyone else's.
   */
  currentGroupDisplayName?: string | null;
  groups: GroupJson[];
  needsGroupSelection?: boolean;
}

/** Returned instead of AuthResponse when a new invitee must supply a name. */
export interface NeedsNameResponse {
  needsName: true;
  email: string;
  groupId: string;
}

/**
 * `existingUser` means the address already belongs to an account, not that the
 * user has joined the group: membership is created when the invite is redeemed,
 * so an invite is always pending at this point.
 */
export interface InviteSentResponse extends MessageResponse {
  email: string;
  role: MembershipRole;
  existingUser: boolean;
}

/**
 * The caller's own account. `name` is the canonical name — the only name shown
 * outside a group context, and the only one the user themselves can change.
 */
export interface MeResponse extends UserJson {
  /**
   * The caller's display name override in `currentGroup`, or null when they
   * have no override there (or no current group). The name others see in that
   * group is this value when set, otherwise `name`.
   */
  currentGroupDisplayName: string | null;
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
  /** Set when the caption was edited after upload. */
  captionEditedAt: number | null;
  uploadedBy: string;
  /** Null when the uploader's account has since been deleted. */
  uploaderName: string | null;
  uploaderProfileColor: ProfileColor | null;
  uploadedAt: number;
  commentCount: number;
  reactions: ReactionSummary[];
  userReactions: string[];
}

export interface PhotoListResponse {
  photos: PhotoSummary[];
  limit: number;
  /** Deprecated: meaningful only for legacy offset-paging requests. */
  offset: number;
  hasMore: boolean;
  /**
   * Opaque keyset cursor for the next page; null when this is the last page.
   * Pass back verbatim via `?cursor=`.
   */
  nextCursor: string | null;
}

interface ActivityEventBase {
  at: number;
  actorId: string;
  /** Group-resolved display name; "Former member" once the actor has left. */
  actorName: string;
}

export type ActivityEvent =
  | (ActivityEventBase & { type: 'photo'; photoId: string; caption: string | null })
  | (ActivityEventBase & { type: 'reaction'; photoId: string; emoji: string })
  | (ActivityEventBase & {
      type: 'comment' | 'reply';
      photoId: string;
      commentId: string;
      preview: string;
    })
  | (ActivityEventBase & { type: 'join' })
  | (ActivityEventBase & { type: 'role'; role: MembershipRole; self: boolean });

export interface ActivityResponse {
  /** Newest first, bounded to the inbox window. */
  events: ActivityEvent[];
  /** When this member last opened their inbox; events after it are unread. */
  seenAt: number;
}

export interface ActivitySeenResponse {
  seenAt: number;
}

export interface FeedVersionResponse {
  /**
   * Opaque fingerprint of the group's feed content (photos, visible comments,
   * reactions). Any mutation changes it; clients compare successive values
   * and refetch when they differ.
   */
  version: string;
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

export interface PhotoCaptionUpdatedResponse extends MessageResponse {
  id: string;
  caption: string | null;
  captionEditedAt: number;
}

export interface PhotoViewersResponse {
  /** Group-resolved names; "Former member" once the viewer has left. */
  viewers: Array<{ userId: string; viewedAt: number; name: string }>;
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
  /**
   * The name to display for this member in this group: `displayName` when one
   * is set, otherwise the member's canonical name. Always safe to render.
   */
  name: string;
  /**
   * The group-scoped override, or null when the member is shown under their own
   * canonical name. Lets an admin UI tell "overridden" from "not set" and offer
   * a reset.
   */
  displayName: string | null;
  /**
   * The member's own name, the same in every group. Read-only here: only the
   * user themselves can change it, and no endpoint accepts it. Shown so an
   * admin can tell whose name an override stands in for — this shape is
   * returned by the admin-only members endpoint, so it must not be reused for
   * any response a non-admin can receive about another member.
   */
  canonicalName: string;
  email: string;
  profileColor: ProfileColor;
  role: MembershipRole;
  joinedAt: number;
  imageProtection: boolean;
}

/** Result of setting or clearing a member's per-group display name. */
export interface MemberDisplayNameUpdatedResponse extends MessageResponse {
  userId: string;
  /** The override now stored, or null if it was cleared. */
  displayName: string | null;
  /** The member's resolved name after the change, ready to render. */
  name: string;
  /**
   * The member's canonical name, re-read with the resolved one so a caller
   * holding a member row can refresh every name on it from this response alone,
   * even if the member renamed themselves meanwhile. Only ever the caller's own
   * name unless the caller is an admin of the group: the route rejects a
   * non-admin targeting anyone but themselves.
   */
  canonicalName: string;
}

export interface PendingInvitesResponse {
  invites: Array<{
    email: string;
    role: MembershipRole;
    /** When the latest invite email for this address was sent. */
    createdAt: number;
    expiresAt: number;
  }>;
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

/** The caller's profile after the update, whichever fields the request changed. */
export interface ProfileUpdatedResponse extends MessageResponse {
  /** The canonical name — group display names are unaffected by this endpoint. */
  name: string;
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
