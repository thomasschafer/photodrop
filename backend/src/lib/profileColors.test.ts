import { describe, it, expect } from 'vitest';
import { PROFILE_COLORS } from './db';

// Frontend profile colors (copied for verification)
const FRONTEND_PROFILE_COLORS = [
  'terracotta', 'coral', 'amber', 'rust', 'clay',
  'copper', 'sienna', 'sage', 'olive', 'forest',
  'moss', 'jade', 'slate', 'ocean', 'teal',
  'indigo', 'plum', 'wine', 'mauve', 'rose',
] as const;

describe('Profile colors FE↔BE sync', () => {
  it('backend and frontend profile colors match exactly', () => {
    expect([...PROFILE_COLORS]).toEqual([...FRONTEND_PROFILE_COLORS]);
  });

  it('both have exactly 20 colors', () => {
    expect(PROFILE_COLORS).toHaveLength(20);
    expect(FRONTEND_PROFILE_COLORS).toHaveLength(20);
  });
});
