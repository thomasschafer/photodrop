import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { PhotoUpdate } from './types';

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
    uploaderName: 'Uploader',
    uploaderProfileColor: 'teal',
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
    expect(onPhotoUpdate).toHaveBeenCalledTimes(1);
    const [updatedId, update] = onPhotoUpdate.mock.calls[0];
    expect(updatedId).toBe('p1');
    expect((update as (live: Photo) => Partial<Photo>)(makePhoto())).toEqual({
      userReactions: ['❤️'],
      reactions: [{ emoji: '❤️', count: 1 }],
    });
  });

  it('syncs both emojis to the feed when two toggles settle out of order', async () => {
    // Tap ❤️ then 👍 with the responses arriving in the other order. Each
    // success must be folded into the feed's live copy of the photo: pushing
    // the snapshot captured when a toggle started would let the one that
    // settles last erase the other, and swiping away and back would then
    // re-seed the lightbox from that clobbered state.
    const heartCall = deferred<unknown>();
    const thumbCall = deferred<unknown>();
    addReaction.mockImplementation((_photoId: unknown, emoji: unknown) =>
      emoji === '❤️' ? heartCall.promise : thumbCall.promise
    );

    let feedPhoto = makePhoto();
    const onPhotoUpdate = vi.fn((photoId: string, update: PhotoUpdate) => {
      expect(photoId).toBe(feedPhoto.id);
      feedPhoto = { ...feedPhoto, ...(typeof update === 'function' ? update(feedPhoto) : update) };
    });

    const { result } = setup(feedPhoto, onPhotoUpdate);

    let heartPromise!: Promise<void>;
    act(() => {
      heartPromise = result.current.handleReactionClick('❤️');
    });
    let thumbPromise!: Promise<void>;
    act(() => {
      thumbPromise = result.current.handleReactionClick('👍');
    });

    await act(async () => {
      thumbCall.resolve({});
      await thumbPromise;
    });
    await act(async () => {
      heartCall.resolve({});
      await heartPromise;
    });

    expect(feedPhoto.userReactions).toEqual(['👍', '❤️']);
    expect(feedPhoto.reactions).toEqual([
      { emoji: '👍', count: 1 },
      { emoji: '❤️', count: 1 },
    ]);
    // The lightbox's own view agrees with what the feed was told.
    expect(result.current.userReactions.slice().sort()).toEqual(
      feedPhoto.userReactions.slice().sort()
    );
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
