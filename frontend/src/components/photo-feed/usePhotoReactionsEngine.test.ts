import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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

import { usePhotoReactionsEngine, type ReactionKeyState } from './usePhotoReactionsEngine';
import type { ReactionActor } from './reactions';
import type { ReactionWithUser } from './types';

const actor: ReactionActor = { id: 'me', name: 'Me', profileColor: 'teal' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function callbacks() {
  return {
    onOptimisticUpdate: vi.fn(),
    onSuccess: vi.fn(),
    onRollback: vi.fn(),
    onDetailsRefreshed: vi.fn(),
  };
}

const emptyState: ReactionKeyState = { reactions: [], userReactions: [] };

describe('usePhotoReactionsEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getReactions.mockResolvedValue({ reactions: [] });
    addReaction.mockResolvedValue({});
    removeReaction.mockResolvedValue({});
  });

  it('applies optimistically, then confirms via onSuccess once the API resolves', async () => {
    const { result } = renderHook(() => usePhotoReactionsEngine());
    const cb = callbacks();

    await act(async () => {
      await result.current.toggleReactionForPhoto('p1', emptyState, '❤️', actor, cb);
    });

    expect(addReaction).toHaveBeenCalledWith('p1', '❤️');
    expect(cb.onOptimisticUpdate).toHaveBeenCalledWith({
      reactions: [{ emoji: '❤️', count: 1 }],
      userReactions: ['❤️'],
      details: undefined,
    });
    expect(cb.onSuccess).toHaveBeenCalledWith({
      reactions: [{ emoji: '❤️', count: 1 }],
      userReactions: ['❤️'],
      details: undefined,
    });
    expect(cb.onRollback).not.toHaveBeenCalled();
  });

  it('rolls back to the pre-toggle state and never signals success when the API fails', async () => {
    addReaction.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => usePhotoReactionsEngine());
    const cb = callbacks();
    const before: ReactionKeyState = { reactions: [{ emoji: '❤️', count: 1 }], userReactions: [] };

    await act(async () => {
      await result.current.toggleReactionForPhoto('p1', before, '❤️', actor, cb);
    });

    expect(cb.onOptimisticUpdate).toHaveBeenCalled();
    expect(cb.onRollback).toHaveBeenCalledWith(before);
    // A failed mutation must not propagate to the caller's shared state.
    expect(cb.onSuccess).not.toHaveBeenCalled();
  });

  it('discards a detail fetch that resolves after a newer optimistic mutation', async () => {
    // The iOS bug this guards: a tap fires both the mutation and (via
    // synthesized mouseenter) a details load. If the older load is allowed to
    // write, it clobbers the optimistic update with pre-reaction data.
    const staleDetails: ReactionWithUser[] = [
      { emoji: '❤️', userId: 'other', userName: 'Other', profileColor: 'coral' },
    ];
    const staleLoad = deferred<{ reactions: ReactionWithUser[] }>();
    getReactions.mockReset().mockReturnValueOnce(staleLoad.promise);

    const { result } = renderHook(() => usePhotoReactionsEngine());
    const onLoaded = vi.fn();

    // Load starts first...
    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = result.current.loadDetails('p1', onLoaded);
    });

    // ...then a mutation begins and completes while it's still in flight.
    await act(async () => {
      await result.current.toggleReactionForPhoto('p1', emptyState, '❤️', actor, callbacks());
    });

    await act(async () => {
      staleLoad.resolve({ reactions: staleDetails });
      await loadPromise;
    });

    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('serves cached details without refetching, until the cache is reset', async () => {
    const details: ReactionWithUser[] = [
      { emoji: '🔥', userId: 'u1', userName: 'Ada', profileColor: 'jade' },
    ];
    getReactions.mockResolvedValue({ reactions: details });

    const { result } = renderHook(() => usePhotoReactionsEngine());
    const onLoaded = vi.fn();

    await act(async () => {
      await result.current.loadDetails('p1', onLoaded);
    });
    expect(getReactions).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith(details);

    // Second load is served from cache.
    await act(async () => {
      await result.current.loadDetails('p1', onLoaded);
    });
    expect(getReactions).toHaveBeenCalledTimes(1);

    // A feed refresh invalidates it, so the next load refetches.
    act(() => result.current.resetCache());
    await act(async () => {
      await result.current.loadDetails('p1', onLoaded);
    });
    expect(getReactions).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent loads for the same photo', async () => {
    const load = deferred<{ reactions: ReactionWithUser[] }>();
    getReactions.mockReset().mockReturnValueOnce(load.promise);

    const { result } = renderHook(() => usePhotoReactionsEngine());
    const onLoaded = vi.fn();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.loadDetails('p1', onLoaded);
      second = result.current.loadDetails('p1', onLoaded);
    });

    await act(async () => {
      load.resolve({ reactions: [] });
      await Promise.all([first, second]);
    });

    expect(getReactions).toHaveBeenCalledTimes(1);
  });
});
