import { describe, it, expect } from 'vitest';
import { toggleReaction, toggleReactionDetails } from './reactions';
import type { ReactionWithUser } from './types';

const user = { id: 'me', name: 'Me', profileColor: 'teal' };

describe('toggleReaction', () => {
  it('adds a new reaction when the user had none', () => {
    const result = toggleReaction(null, [{ emoji: '❤️', count: 1 }], '❤️');
    expect(result).toEqual({
      userReaction: '❤️',
      reactions: [{ emoji: '❤️', count: 2 }],
      isRemoving: false,
    });
  });

  it('creates a pill for an emoji nobody has reacted with yet', () => {
    const result = toggleReaction(null, [], '🔥');
    expect(result).toEqual({
      userReaction: '🔥',
      reactions: [{ emoji: '🔥', count: 1 }],
      isRemoving: false,
    });
  });

  it('removes the reaction when tapping the one already selected', () => {
    const result = toggleReaction('❤️', [{ emoji: '❤️', count: 1 }], '❤️');
    expect(result).toEqual({ userReaction: null, reactions: [], isRemoving: true });
  });

  it('keeps a pill that still has other reactors after removal', () => {
    const result = toggleReaction('❤️', [{ emoji: '❤️', count: 3 }], '❤️');
    expect(result).toEqual({
      userReaction: null,
      reactions: [{ emoji: '❤️', count: 2 }],
      isRemoving: true,
    });
  });

  it('switches reaction: decrements the old emoji and increments the new', () => {
    const result = toggleReaction(
      '😂',
      [
        { emoji: '😂', count: 1 },
        { emoji: '🔥', count: 2 },
      ],
      '🔥'
    );
    expect(result.userReaction).toBe('🔥');
    expect(result.isRemoving).toBe(false);
    // 😂 dropped to 0 and removed; 🔥 bumped to 3.
    expect(result.reactions).toEqual([{ emoji: '🔥', count: 3 }]);
  });

  it('switches to a brand-new emoji, dropping the previous solo reaction', () => {
    const result = toggleReaction('😂', [{ emoji: '😂', count: 1 }], '👏');
    expect(result.userReaction).toBe('👏');
    expect(result.reactions).toEqual([{ emoji: '👏', count: 1 }]);
  });

  it('does not mutate the input arrays', () => {
    const input = [{ emoji: '❤️', count: 1 }];
    toggleReaction(null, input, '❤️');
    expect(input).toEqual([{ emoji: '❤️', count: 1 }]);
  });
});

describe('toggleReactionDetails', () => {
  const others: ReactionWithUser[] = [
    { emoji: '❤️', userId: 'bob', userName: 'Bob', profileColor: 'rose' },
  ];

  it('adds the acting user when not removing', () => {
    const result = toggleReactionDetails(others, user, '❤️', false);
    expect(result).toEqual([
      ...others,
      { emoji: '❤️', userId: 'me', userName: 'Me', profileColor: 'teal' },
    ]);
  });

  it('removes the acting user when removing', () => {
    const withMe: ReactionWithUser[] = [
      ...others,
      { emoji: '❤️', userId: 'me', userName: 'Me', profileColor: 'teal' },
    ];
    expect(toggleReactionDetails(withMe, user, '❤️', true)).toEqual(others);
  });

  it('replaces the user’s prior entry when switching emoji', () => {
    const withMyOldReaction: ReactionWithUser[] = [
      ...others,
      { emoji: '😂', userId: 'me', userName: 'Me', profileColor: 'teal' },
    ];
    const result = toggleReactionDetails(withMyOldReaction, user, '🔥', false);
    expect(result).toEqual([
      ...others,
      { emoji: '🔥', userId: 'me', userName: 'Me', profileColor: 'teal' },
    ]);
  });
});
