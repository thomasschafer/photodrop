import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import {
  createMagicLinkToken,
  getUserByEmail,
  getUserById,
  createUser,
  getGroup,
  createMembership,
  getMembership,
  getUserMemberships,
  markMagicLinkTokenUsed,
  markMagicLinkTokenPending,
  type User,
  type MembershipWithGroup,
} from '../lib/db';
import {
  generateAccessToken,
  generateRefreshToken,
  generateGroupSelectionToken,
  verifyJWT,
  verifyGroupSelectionToken,
} from '../lib/jwt';
import { verifyMagicLink } from '../lib/magic-links';
import { sendInviteEmail, sendLoginLinkEmail } from '../lib/email';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { createRateLimitMiddleware, rateLimitKeys, getClientIP } from '../middleware/rateLimit';
import {
  sendInviteSchema,
  sendLoginLinkSchema,
  verifyMagicLinkSchema,
  switchGroupSchema,
  selectGroupSchema,
} from '../lib/schemas';
import {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  InternalServerError,
  parseJsonBody,
} from '../lib/http';
import type {
  AuthResponse,
  NeedsNameResponse,
  InviteSentResponse,
  UserJson,
  GroupJson,
} from '@photodrop/common/apiTypes';
import type { AppEnv } from '../types';

const auth = new Hono<AppEnv>();

// Rate limit configurations
const sendInviteRateLimit = createRateLimitMiddleware({
  maxRequests: 10,
  windowSeconds: 60 * 60, // 1 hour
  keyFn: rateLimitKeys.byUserId('invite'),
});

const sendLoginLinkRateLimit = createRateLimitMiddleware({
  maxRequests: 5,
  windowSeconds: 15 * 60, // 15 minutes
  keyFn: rateLimitKeys.byEmailFromBody('login'),
});

const verifyMagicLinkRateLimit = createRateLimitMiddleware({
  maxRequests: 10,
  windowSeconds: 15 * 60, // 15 minutes
  keyFn: (c) => `verify:${getClientIP(c)}`,
});

// Response-shape helpers: every auth endpoint returns the same user and group
// JSON, so build it in one place, typed against the shared wire types.
function userJson(user: User): UserJson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    profileColor: user.profile_color,
  };
}

function membershipGroupJson(m: MembershipWithGroup): GroupJson {
  return {
    id: m.group_id,
    name: m.group_name,
    role: m.role,
    ownerId: m.group_owner_id,
    imageProtection: m.image_protection === 1,
  };
}

function groupsJson(memberships: MembershipWithGroup[]): GroupJson[] {
  return memberships.map(membershipGroupJson);
}

const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Attributes for the refresh cookie. Setting and clearing must agree on all of
 * them — a browser only replaces a cookie when the attributes match.
 *
 * `secure` follows the request scheme rather than being hardcoded: WebKit
 * refuses to store a `Secure` cookie delivered over plain HTTP, where Chromium
 * special-cases http://localhost. Hardcoding it meant Safari and the WebKit e2e
 * run never stored a refresh cookie locally, so every /auth/refresh failed with
 * "No refresh token provided" and any 401 logged the user out. Production is
 * served over HTTPS, so it still gets `Secure`.
 */
function refreshCookieOptions(c: Context, maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    maxAge,
    path: '/',
  };
}

function setRefreshCookie(c: Context, refreshToken: string): void {
  setCookie(c, 'refreshToken', refreshToken, refreshCookieOptions(c, REFRESH_COOKIE_MAX_AGE));
}

// Issue an access token for the given group, rotate the refresh cookie, and
// build the standard auth response body.
async function issueSessionForGroup(
  c: Context<AppEnv>,
  user: User,
  membership: MembershipWithGroup,
  memberships: MembershipWithGroup[],
  extra: Partial<AuthResponse> = {}
) {
  const accessToken = await generateAccessToken(
    user.id,
    membership.group_id,
    membership.role,
    c.env.JWT_SECRET
  );
  const refreshToken = await generateRefreshToken(
    user.id,
    membership.group_id,
    membership.role,
    c.env.JWT_SECRET
  );

  setRefreshCookie(c, refreshToken);

  return c.json({
    accessToken,
    user: userJson(user),
    currentGroup: membershipGroupJson(membership),
    groups: groupsJson(memberships),
    ...extra,
  } satisfies AuthResponse);
}

// markMagicLinkTokenUsed consumes the token atomically, so a false return means
// a concurrent request got there first and this one must not continue.
function requireTokenConsumed(consumed: boolean): void {
  if (!consumed) {
    throw new BadRequestError('Token has already been used');
  }
}

// Send invite email (admin only)
auth.post('/send-invite', requireAdmin, sendInviteRateLimit, async (c) => {
  const { email, role } = await parseJsonBody(c, sendInviteSchema);
  const user = c.get('user');

  // Check if user already exists in this group
  const existingUser = await getUserByEmail(c.env.DB, email);
  if (existingUser) {
    const existingMembership = await getMembership(c.env.DB, existingUser.id, user.groupId);
    if (existingMembership) {
      throw new BadRequestError('User is already a member of this group');
    }
  }

  // Get group info for email
  const group = await getGroup(c.env.DB, user.groupId);
  if (!group) {
    throw new NotFoundError('Group not found');
  }

  // Create magic link token
  const token = await createMagicLinkToken(c.env.DB, user.groupId, email, 'invite', role);

  // Generate magic link URL
  const magicLink = `${c.env.FRONTEND_URL}/auth/${token}`;

  await sendInviteEmail(c.env, email, existingUser?.name ?? null, group.name, magicLink);

  // Membership is created when the invite is redeemed in /verify-magic-link,
  // not here — so this reports the invite being sent, never that the user has
  // joined, even when an account already exists for the address.
  return c.json({
    message: 'Invite sent successfully',
    email,
    role,
    existingUser: !!existingUser,
  } satisfies InviteSentResponse);
});

// Send login link (public)
auth.post('/send-login-link', sendLoginLinkRateLimit, async (c) => {
  const { email } = await parseJsonBody(c, sendLoginLinkSchema);

  // Get user by email
  const user = await getUserByEmail(c.env.DB, email);
  if (!user) {
    // Don't reveal if user exists or not (security)
    return c.json({ message: 'If that email exists, a login link has been sent' });
  }

  // Get user's memberships to find a group for the magic link
  const memberships = await getUserMemberships(c.env.DB, user.id);

  // Login tokens do not need to be group-scoped when the user has no groups.
  const groupId = memberships.length > 0 ? memberships[0].group_id : null;

  // Create magic link token
  const token = await createMagicLinkToken(c.env.DB, groupId, email, 'login');

  // Generate magic link URL
  const magicLink = `${c.env.FRONTEND_URL}/auth/${token}`;

  // Send login email
  await sendLoginLinkEmail(c.env, email, user.name, magicLink);

  return c.json({ message: 'If that email exists, a login link has been sent' });
});

// Verify magic link and issue JWT
auth.post('/verify-magic-link', verifyMagicLinkRateLimit, async (c) => {
  const { token, name } = await parseJsonBody(c, verifyMagicLinkSchema);

  // The one request allowed to proceed on a pending token is the second leg of
  // the invite flow: the first request answered needsName and deliberately left
  // the token pending. Whether that is what is happening is decided from the
  // token's own state — an unconsumed invite whose email still has no account,
  // which is exactly what the needsName response leaves behind. Deriving it
  // from the request body instead (any body carrying a name) let any caller opt
  // out of the pending and single-use guards, including on login tokens.
  let result = await verifyMagicLink(c.env.DB, token);

  const isNameSubmission =
    name !== undefined &&
    result.error === 'pending' &&
    result.token?.type === 'invite' &&
    (await getUserByEmail(c.env.DB, result.token.email)) === null;

  if (isNameSubmission) {
    result = await verifyMagicLink(c.env.DB, token, true);
  }

  if (!result.valid || !result.token) {
    const errorMessages: Record<string, string> = {
      not_found: 'Invalid token',
      expired: 'Token has expired',
      already_used: 'Token has already been used',
      pending: 'This link is already being processed. Please wait a moment and try again.',
      invalid: 'Invalid token',
    };
    throw new BadRequestError(result.error ? errorMessages[result.error] : 'Invalid token');
  }

  const magicToken = result.token;

  // Mark token as pending to prevent concurrent use (race condition protection).
  // For name submissions, the token is already pending from the initial request.
  const canProceed = await markMagicLinkTokenPending(c.env.DB, token);
  if (!canProceed && !isNameSubmission) {
    throw new BadRequestError('This link is already being used. Please try again.');
  }

  if (magicToken.type === 'invite') {
    if (!magicToken.group_id) {
      throw new BadRequestError('Invalid invite token');
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(c.env.DB, magicToken.email);

    if (!existingUser) {
      // New user - name must be provided in request
      if (!name) {
        // Don't consume token yet - user needs to provide name
        // (Token is already marked pending at the start of this handler)
        return c.json({
          needsName: true,
          email: magicToken.email,
          groupId: magicToken.group_id,
        } satisfies NeedsNameResponse);
      }

      if (!magicToken.invite_role) {
        throw new BadRequestError('Invalid invite token');
      }
    }

    // Consume the token before any writes, so concurrent redemptions of the
    // same link cannot both create an account (a UNIQUE violation on the email)
    // or both mint a session.
    requireTokenConsumed(await markMagicLinkTokenUsed(c.env.DB, token));

    let user: User | null = existingUser;
    if (!existingUser && name) {
      const userId = await createUser(c.env.DB, name, magicToken.email);
      user = await getUserById(c.env.DB, userId);
    }

    if (!user) {
      throw new InternalServerError('Failed to create user');
    }

    // Create membership for the group
    const existingMembership = await getMembership(c.env.DB, user.id, magicToken.group_id);
    if (!existingMembership) {
      await createMembership(
        c.env.DB,
        user.id,
        magicToken.group_id,
        magicToken.invite_role || 'member'
      );
    }

    // Get updated memberships
    const memberships = await getUserMemberships(c.env.DB, user.id);

    // For invites, always go directly to the invited group
    const invitedGroupMembership = memberships.find((m) => m.group_id === magicToken.group_id);
    if (!invitedGroupMembership) {
      throw new InternalServerError('Membership not found');
    }

    return issueSessionForGroup(c, user, invitedGroupMembership, memberships, {
      needsGroupSelection: false,
    });
  }

  // Login existing user
  const user = await getUserByEmail(c.env.DB, magicToken.email);

  if (!user) {
    throw new BadRequestError('User not found');
  }

  const memberships = await getUserMemberships(c.env.DB, user.id);

  // Mark token as used now that we've successfully identified the user
  requireTokenConsumed(await markMagicLinkTokenUsed(c.env.DB, token));

  // No groups - user has no memberships, nothing to select
  if (memberships.length === 0) {
    return c.json({
      accessToken: null,
      user: userJson(user),
      groups: [],
      needsGroupSelection: false,
    } satisfies AuthResponse);
  }

  if (memberships.length === 1) {
    return issueSessionForGroup(c, user, memberships[0], memberships, {
      needsGroupSelection: false,
    });
  }

  // Multiple groups - return selection token and groups, frontend shows picker
  const selectionToken = await generateGroupSelectionToken(user.id, c.env.JWT_SECRET);
  return c.json({
    accessToken: null,
    selectionToken,
    user: userJson(user),
    groups: groupsJson(memberships),
    needsGroupSelection: true,
  } satisfies AuthResponse);
});

// Switch to a different group
auth.post('/switch-group', requireAuth, async (c) => {
  const { groupId } = await parseJsonBody(c, switchGroupSchema);
  const currentUser = c.get('user');

  const user = await getUserById(c.env.DB, currentUser.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // The full membership list is needed for the response anyway, so verify
  // access from it rather than paying for a separate getMembership lookup.
  const memberships = await getUserMemberships(c.env.DB, user.id);
  const targetMembership = memberships.find((m) => m.group_id === groupId);
  if (!targetMembership) {
    throw new ForbiddenError('You are not a member of this group');
  }

  return issueSessionForGroup(c, user, targetMembership, memberships);
});

// Select initial group (for users with multiple groups after login)
auth.post('/select-group', async (c) => {
  const { selectionToken, groupId } = await parseJsonBody(c, selectGroupSchema);

  // Verify the selection token and extract userId
  const tokenResult = await verifyGroupSelectionToken(selectionToken, c.env.JWT_SECRET);
  if (!tokenResult.valid) {
    throw new UnauthorizedError('Invalid or expired selection token');
  }

  const userId = tokenResult.userId;

  const user = await getUserById(c.env.DB, userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // As in /switch-group: one membership query serves both the access check and
  // the response body.
  const memberships = await getUserMemberships(c.env.DB, user.id);
  const targetMembership = memberships.find((m) => m.group_id === groupId);
  if (!targetMembership) {
    throw new ForbiddenError('You are not a member of this group');
  }

  return issueSessionForGroup(c, user, targetMembership, memberships);
});

// Refresh access token
auth.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, 'refreshToken');

  if (!refreshToken) {
    throw new UnauthorizedError('No refresh token provided');
  }

  const payload = await verifyJWT(refreshToken, c.env.JWT_SECRET);

  if (!payload || payload.type !== 'refresh') {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Get user data
  const user = await getUserById(c.env.DB, payload.sub);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // Get all memberships for the response
  const memberships = await getUserMemberships(c.env.DB, user.id);

  // Get membership for the group in the token
  const membership = memberships.find((m) => m.group_id === payload.groupId);

  if (!membership) {
    // User is no longer a member of this group (e.g., group was deleted)
    // Return user info with their remaining groups so they can pick a new one
    const selectionToken =
      memberships.length > 0 ? await generateGroupSelectionToken(user.id, c.env.JWT_SECRET) : null;
    return c.json({
      accessToken: null,
      selectionToken,
      user: userJson(user),
      currentGroup: null,
      groups: groupsJson(memberships),
      needsGroupSelection: memberships.length > 0,
    } satisfies AuthResponse);
  }

  return issueSessionForGroup(c, user, membership, memberships);
});

// Logout
auth.post('/logout', async (c) => {
  // Clear refresh token cookie
  setCookie(c, 'refreshToken', '', refreshCookieOptions(c, 0));

  return c.json({ message: 'Logged out successfully' });
});

export default auth;
