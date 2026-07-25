export const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'] as const;

export type AllowedEmoji = (typeof ALLOWED_EMOJIS)[number];

const EMOJI_VARIATION_SELECTOR = /\uFE0F/g;

export function normalizeEmoji(emoji: string): string {
  return emoji.replace(EMOJI_VARIATION_SELECTOR, '');
}

const ALLOWED_EMOJI_MAP = new Map(ALLOWED_EMOJIS.map((emoji) => [normalizeEmoji(emoji), emoji]));

/**
 * Map an emoji to its canonical allowed form, tolerating presentation
 * differences (variation selectors) between platforms. Returns null when the
 * emoji is not in the allowed set.
 */
export function canonicalizeEmoji(emoji: string): AllowedEmoji | null {
  const normalized = normalizeEmoji(emoji);
  return ALLOWED_EMOJI_MAP.get(normalized) ?? null;
}
