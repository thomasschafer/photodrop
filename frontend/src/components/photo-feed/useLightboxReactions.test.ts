import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getReactions = vi.fn();
const addReaction = vi.fn();
const removeReaction = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    photos: {
      getReactions: (...a: unknown[]) => getReactions(...a),
      addReaction: (...a: unknown[]) => addReaction(...a),
      removeReaction: (...a: unknown[]) => removeReaction(...a),
    },
  },
}));

import { useLightboxReactions } from './useLightboxReactions';
import type { Photo, ReactionWithUser } from './types';
import type { ReactionActor } from './reactions';

const user: ReactionActor = { id: 'me', name: 'Me', profileColor: 'teal' };

function makePhoto(over: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    caption: null,
    uploadedBy: 'u',
    uploadedAt: 1,
    commentCount: 0,
    reactions: [],
    userReactions: [],
    ...over,
  };
}

function setup(photo: Photo, onPhotoUpdate = vi.fn()) {
  return renderHook(() =>
    useLightboxReactions({ photo, prevPhoto: undefined, nextPhoto: undefined, user, onPhotoUpdate })
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useLightboxReactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReactions.mockResolvedValue({ reactions: [] });
    addReaction.mockResolvedValue({});
    removeReaction.mockResolvedValue({});
  });

  it('optimistically applies a reaction and syncs the feed via onPhotoUpdate', async () => {
    const onPhotoUpdate = vi.fn();
    const { result } = setup(makePhoto(), onPhotoUpdate);

    await act(async () => {
      await result.current.handleReactionClick('❤️');
    });

    expect(addReaction).toHaveBeenCalledWith('p1', '❤️');
    expect(result.current.userReactions).toEqual(['❤️']);
    expect(result.current.reactions).toEqual([{ emoji: '❤️', count: 1 }]);
    expect(onPhotoUpdate).toHaveBeenCalledWith({
      id: 'p1',
      userReactions: ['❤️'],
      reactions: [{ emoji: '❤️', count: 1 }],
    });
  });

  it('rolls back and does not sync the feed when the request fails', async () => {
    addReaction.mockRejectedValue(new Error('network'));
    const onPhotoUpdate = vi.fn();
    const photo = makePhoto({ reactions: [{ emoji: '❤️', count: 1 }], userReactions: [] });
    const { result } = setup(photo, onPhotoUpdate);

    await waitFor(() => expect(getReactions).toHaveBeenCalledWith('p1'));

    await act(async () => {
      await result.current.handleReactionClick('❤️');
    });

    // Reverted to the pre-tap summary; the feed was never told about it.
    expect(result.current.userReactions).toEqual([]);
    expect(result.current.reactions).toEqual([{ emoji: '❤️', count: 1 }]);
    expect(onPhotoUpdate).not.toHaveBeenCalled();
  });

  it('ignores stale reaction details that resolve after an optimistic mutation', async () => {
    const staleDetails: ReactionWithUser[] = [
      { emoji: '❤️', userId: 'other', userName: 'Other', profileColor: 'coral' },
    ];
    const refreshedDetails: ReactionWithUser[] = [
      ...staleDetails,
      { emoji: '❤️', userId: 'me', userName: 'Me', profileColor: 'teal' },
    ];
    const staleLoad = deferred<{ reactions: ReactionWithUser[] }>();

    getReactions
      .mockReset()
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce({ reactions: refreshedDetails });

    const photo = makePhoto({ reactions: [{ emoji: '❤️', count: 1 }], userReactions: [] });
    const { result } = setup(photo);

    await waitFor(() => expect(getReactions).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.handleReactionClick('❤️');
    });

    expect(getReactions).toHaveBeenCalledTimes(2);
    expect(result.current.reactionDetails).toEqual(refreshedDetails);

    await act(async () => {
      staleLoad.resolve({ reactions: staleDetails });
      await staleLoad.promise;
    });

    expect(result.current.reactionDetails).toEqual(refreshedDetails);
  });
});
