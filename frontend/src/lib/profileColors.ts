// Keep in sync with backend/src/lib/db.ts
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

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
