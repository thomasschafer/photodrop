/**
 * Zod request validation schemas
 */
import { z } from 'zod';
import { COMMENT_MAX_LENGTH, NAME_MAX_LENGTH } from '@photodrop/common/limits';
import { ALLOWED_EMOJIS, canonicalizeEmoji } from '@photodrop/common/reactions';
import { PROFILE_COLORS } from '@photodrop/common/profileColors';

// Email schema with proper validation
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());

// Auth schemas
export const sendInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['admin', 'member']).default('member'),
});

export const sendLoginLinkSchema = z.object({
  email: emailSchema,
  returnTo: z
    .string()
    .max(500)
    .refine((path) => path.startsWith('/photo/'), 'Invalid return path')
    .optional(),
});

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name cannot be empty')
  .max(NAME_MAX_LENGTH, `Name must be ${NAME_MAX_LENGTH} characters or less`);

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
  name: nameSchema.optional(),
});

export const switchGroupSchema = z.object({
  groupId: z.string().min(1),
});

export const selectGroupSchema = z.object({
  selectionToken: z.string().min(1),
  groupId: z.string().min(1),
});

// Photo schemas
const emojiSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return canonicalizeEmoji(value) ?? value;
}, z.enum(ALLOWED_EMOJIS));

export const addReactionSchema = z.object({
  emoji: emojiSchema,
});

export const addCommentSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(COMMENT_MAX_LENGTH, `Comment must be ${COMMENT_MAX_LENGTH} characters or less`),
});

// Push schemas
// Real push service endpoints are a few hundred characters at most; the bound
// stops a caller from stuffing arbitrarily large URLs into rows the upload path
// later turns into outbound requests.
const PUSH_ENDPOINT_MAX_LENGTH = 2048;

export const subscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(
      PUSH_ENDPOINT_MAX_LENGTH,
      `Endpoint must be ${PUSH_ENDPOINT_MAX_LENGTH} characters or less`
    ),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const unsubscribeSchema = z.object({
  endpoint: z.string().min(1, 'Endpoint is required'),
  deletionToken: z.string().min(1, 'Deletion token is required'),
});

export const unsubscribeFromGroupSchema = z.object({
  endpoint: z.string().min(1, 'Endpoint is required'),
});

export const registerDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  token: z.string().min(1),
});

export const deviceTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

// User schemas
export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    profileColor: z.enum(PROFILE_COLORS, { error: 'Invalid profile color' }).optional(),
  })
  // Both fields are optional individually, but a body with neither changes
  // nothing — reporting that as a successful update would be a lie.
  .refine((body) => body.name !== undefined || body.profileColor !== undefined, {
    error: 'Provide at least one of name or profileColor to update',
  });

// A member's role is the only thing an admin may change about them here: their
// name belongs to the user, and a per-group override goes through the
// display-name route instead.
export const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member'], {
    error: (issue) =>
      issue.input === 'owner'
        ? 'Cannot promote to owner — owner is set at group creation only'
        : issue.input === undefined
          ? 'Provide a role to update'
          : undefined,
  }),
});

export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().trim().min(1, 'New owner is required'),
});

export const accountDeletionTokenSchema = z.object({
  token: z.string().trim().min(1, 'Confirmation token is required'),
});

export const displayNameSchema = z.object({
  // Required, and explicitly nullable: null is the only way to clear an
  // override, so an absent key must not be read as "clear it".
  displayName: z.union([nameSchema, z.null()], {
    error: 'displayName must be a non-empty string, or null to clear the override',
  }),
});

export const imageProtectionSchema = z.object({
  enabled: z.boolean({ error: 'enabled must be a boolean' }),
});
