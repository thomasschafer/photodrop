/**
 * Zod request validation schemas
 */
import { z } from 'zod';

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
export const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'] as const;

export const addReactionSchema = z.object({
  emoji: z.enum(ALLOWED_EMOJIS),
});

export const addCommentSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

// Push schemas
export const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const registerDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  token: z.string().min(1),
});

// User schemas
export const updateProfileSchema = z.object({
  profileColor: z.string().min(1),
});

export const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  name: z.string().trim().min(1).max(100).optional(),
});

export const imageProtectionSchema = z.object({
  enabled: z.boolean(),
});
