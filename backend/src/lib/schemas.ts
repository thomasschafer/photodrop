/**
 * Zod request validation schemas
 */
import { z } from 'zod';
import { COMMENT_MAX_LENGTH } from '@photodrop/common/limits';
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
});

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
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
export const subscribeSchema = z.object({
  endpoint: z.string().url(),
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
export const updateProfileSchema = z.object({
  profileColor: z.enum(PROFILE_COLORS, { error: 'Invalid profile color' }),
});

export const updateMemberSchema = z.object({
  role: z
    .enum(['admin', 'member'], {
      error: (issue) =>
        issue.input === 'owner'
          ? 'Cannot promote to owner — owner is set at group creation only'
          : undefined,
    })
    .optional(),
  name: z.string().trim().min(1).max(100).optional(),
});

export const imageProtectionSchema = z.object({
  enabled: z.boolean({ error: 'enabled must be a boolean' }),
});
