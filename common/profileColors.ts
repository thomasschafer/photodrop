export const PROFILE_COLORS = [
  'terracotta',
  'coral',
  'amber',
  'rust',
  'clay',
  'copper',
  'sienna',
  'sage',
  'olive',
  'forest',
  'moss',
  'jade',
  'slate',
  'ocean',
  'teal',
  'indigo',
  'plum',
  'wine',
  'mauve',
  'rose',
] as const;

export type ProfileColor = (typeof PROFILE_COLORS)[number];

export function getRandomProfileColor(): ProfileColor {
  return PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
}
