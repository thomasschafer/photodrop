import { describe, it, expect } from 'vitest';
import { canonicalizeEmoji } from '@photodrop/common/reactions';
import { addReactionSchema } from './schemas';

describe('emoji normalization', () => {
  it('canonicalizes emoji without variation selector', () => {
    expect(canonicalizeEmoji('❤')).toBe('❤️');
  });

  it('accepts canonical emoji', () => {
    expect(canonicalizeEmoji('❤️')).toBe('❤️');
  });

  it('rejects unsupported emoji', () => {
    expect(canonicalizeEmoji('💥')).toBeNull();
  });

  it('parses addReaction payload with non-canonical emoji', () => {
    const result = addReactionSchema.parse({ emoji: '❤' });
    expect(result.emoji).toBe('❤️');
  });
});
