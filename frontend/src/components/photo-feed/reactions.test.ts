import { describe, it, expect } from 'vitest';
import { toggleReaction, type ReactionActor, type ReactionState } from './reactions';
import type { ReactionWithUser } from './types';

const actor: ReactionActor = { id: 'user-1', name: 'Alice', profileColor: 'coral' };

function detail(emoji: string, userId: string, userName: string): ReactionWithUser {
  return { emoji, userId, userName, profileColor: 'coral' };
}

describe('toggleReaction', () => {
  describe('adding a reaction', () => {
    it('adds a brand-new emoji nobody has reacted with', () => {
      const state: ReactionState = { reactions: [], userReactions: [], details: [] };

      const result = toggleReaction(state, '❤️', actor);

      expect(result.isRemoving).toBe(false);
      expect(result.reactions).toEqual([{ emoji: '❤️', count: 1 }]);
      expect(result.userReactions).toEqual(['❤️']);
      expect(result.details).toEqual([detail('❤️', 'user-1', 'Alice')]);
    });

    it('adds a second distinct emoji while keeping the first', () => {
      const state: ReactionState = {
        reactions: [{ emoji: '❤️', count: 1 }],
        userReactions: ['❤️'],
        details: [detail('❤️', 'user-1', 'Alice')],
      };

      const result = toggleReaction(state, '🔥', actor);

      expect(result.isRemoving).toBe(false);
      expect(result.userReactions).toEqual(['❤️', '🔥']);
      expect(result.reactions).toContainEqual({ emoji: '❤️', count: 1 });
      expect(result.reactions).toContainEqual({ emoji: '🔥', count: 1 });
      expect(result.details).toHaveLength(2);
    });

    it('increments an emoji others have already reacted with', () => {
      const state: ReactionState = {
        reactions: [{ emoji: '❤️', count: 2 }],
        userReactions: [],
        details: [detail('❤️', 'user-2', 'Bob'), detail('❤️', 'user-3', 'Carol')],
      };

      const result = toggleReaction(state, '❤️', actor);

      expect(result.isRemoving).toBe(false);
      expect(result.reactions).toEqual([{ emoji: '❤️', count: 3 }]);
      expect(result.userReactions).toEqual(['❤️']);
      expect(result.details).toHaveLength(3);
      expect(result.details).toContainEqual(detail('❤️', 'user-1', 'Alice'));
    });
  });

  describe('removing a reaction', () => {
    it('removes the pill entirely when the user was the only reactor', () => {
      const state: ReactionState = {
        reactions: [{ emoji: '❤️', count: 1 }],
        userReactions: ['❤️'],
        details: [detail('❤️', 'user-1', 'Alice')],
      };

      const result = toggleReaction(state, '❤️', actor);

      expect(result.isRemoving).toBe(true);
      expect(result.reactions).toEqual([]);
      expect(result.userReactions).toEqual([]);
      expect(result.details).toEqual([]);
    });

    it('keeps the pill but decrements when others also reacted', () => {
      const state: ReactionState = {
        reactions: [{ emoji: '❤️', count: 3 }],
        userReactions: ['❤️'],
        details: [
          detail('❤️', 'user-1', 'Alice'),
          detail('❤️', 'user-2', 'Bob'),
          detail('❤️', 'user-3', 'Carol'),
        ],
      };

      const result = toggleReaction(state, '❤️', actor);

      expect(result.isRemoving).toBe(true);
      expect(result.reactions).toEqual([{ emoji: '❤️', count: 2 }]);
      expect(result.userReactions).toEqual([]);
      expect(result.details).toEqual([
        detail('❤️', 'user-2', 'Bob'),
        detail('❤️', 'user-3', 'Carol'),
      ]);
    });

    it('removes only the targeted emoji from the user, leaving their other reactions', () => {
      const state: ReactionState = {
        reactions: [
          { emoji: '❤️', count: 1 },
          { emoji: '🔥', count: 1 },
        ],
        userReactions: ['❤️', '🔥'],
        details: [detail('❤️', 'user-1', 'Alice'), detail('🔥', 'user-1', 'Alice')],
      };

      const result = toggleReaction(state, '❤️', actor);

      expect(result.isRemoving).toBe(true);
      expect(result.userReactions).toEqual(['🔥']);
      expect(result.reactions).toEqual([{ emoji: '🔥', count: 1 }]);
      expect(result.details).toEqual([detail('🔥', 'user-1', 'Alice')]);
    });
  });

  describe('details handling', () => {
    it('leaves details undefined when they have not been loaded', () => {
      const state: ReactionState = {
        reactions: [{ emoji: '❤️', count: 1 }],
        userReactions: [],
        details: undefined,
      };

      const result = toggleReaction(state, '❤️', actor);

      expect(result.details).toBeUndefined();
      expect(result.userReactions).toEqual(['❤️']);
      expect(result.reactions).toEqual([{ emoji: '❤️', count: 2 }]);
    });

    it('does not mutate the input state', () => {
      const reactions = [{ emoji: '❤️', count: 1 }];
      const userReactions = ['❤️'];
      const details = [detail('❤️', 'user-1', 'Alice')];
      const state: ReactionState = { reactions, userReactions, details };

      toggleReaction(state, '❤️', actor);

      expect(reactions).toEqual([{ emoji: '❤️', count: 1 }]);
      expect(userReactions).toEqual(['❤️']);
      expect(details).toEqual([detail('❤️', 'user-1', 'Alice')]);
    });
  });
});
