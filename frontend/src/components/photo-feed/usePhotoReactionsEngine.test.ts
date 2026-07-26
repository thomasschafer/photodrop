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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    expect(cb.onRollback).toHaveBeenCalledTimes(1);
    // Applying the reconciler to the live (post-optimistic-update) state
    // must undo this toggle's own effect, landing back on the pre-toggle
    // state — the same outcome the old "restore a snapshot" contract gave
    // for a single, non-concurrent toggle.
    const reconcile = cb.onRollback.mock.calls[0][0];
    const optimistic = cb.onOptimisticUpdate.mock.calls[0][0];
    expect(reconcile(optimistic)).toEqual(before);
    // A failed mutation must not propagate to the caller's shared state.
    expect(cb.onSuccess).not.toHaveBeenCalled();
  });

  it('reconciles only its own change when a different-emoji toggle overlaps and this one fails', async () => {
    const heartCall = deferred<unknown>();
    addReaction.mockImplementation((_photoId: string, emoji: string) =>
      emoji === '❤️' ? heartCall.promise : Promise.resolve({})
    );

    const { result } = renderHook(() => usePhotoReactionsEngine());
    const heartCb = callbacks();
    const fireCb = callbacks();

    let heartPromise!: Promise<void>;
    act(() => {
      heartPromise = result.current.toggleReactionForPhoto('p1', emptyState, '❤️', actor, heartCb);
    });
    const heartOptimistic = heartCb.onOptimisticUpdate.mock.calls[0][0] as ReactionKeyState;

    // A different emoji is toggled on the same photo before the heart toggle
    // has resolved, starting from the state the heart toggle just applied.
    let firePromise!: Promise<void>;
    act(() => {
      firePromise = result.current.toggleReactionForPhoto(
        'p1',
        heartOptimistic,
        '🔥',
        actor,
        fireCb
      );
    });

    await act(async () => {
      await firePromise;
    });
    expect(fireCb.onSuccess).toHaveBeenCalled();
    const fireOptimistic = fireCb.onOptimisticUpdate.mock.calls[0][0] as ReactionKeyState;

    await act(async () => {
      heartCall.reject(new Error('network'));
      await heartPromise;
    });

    expect(heartCb.onRollback).toHaveBeenCalledTimes(1);
    const reconcile = heartCb.onRollback.mock.calls[0][0] as (
      live: ReactionKeyState
    ) => ReactionKeyState;

    // Applied to the live state (which includes fire's still-standing
    // change), only heart's own effect is undone.
    expect(reconcile(fireOptimistic)).toEqual({
      reactions: [{ emoji: '🔥', count: 1 }],
      userReactions: ['🔥'],
      details: undefined,
    });
  });

  it('only the most recently started toggle of a given emoji settles, when two overlap', async () => {
    // Documents the deterministic tie-break for same-emoji concurrency: the
    // first toggle here is superseded by the second before it fails, so its
    // failure is dropped rather than reconciled -- the second toggle already
    // owns this emoji's state.
    const firstCall = deferred<unknown>();
    addReaction.mockImplementationOnce(() => firstCall.promise);
    removeReaction.mockResolvedValue({});

    const { result } = renderHook(() => usePhotoReactionsEngine());
    const cb1 = callbacks();
    const cb2 = callbacks();

    let p1!: Promise<void>;
    act(() => {
      p1 = result.current.toggleReactionForPhoto('p1', emptyState, '❤️', actor, cb1);
    });
    const afterFirst = cb1.onOptimisticUpdate.mock.calls[0][0] as ReactionKeyState;

    let p2!: Promise<void>;
    act(() => {
      p2 = result.current.toggleReactionForPhoto('p1', afterFirst, '❤️', actor, cb2);
    });

    await act(async () => {
      await p2;
    });
    expect(cb2.onSuccess).toHaveBeenCalled();

    await act(async () => {
      firstCall.reject(new Error('network'));
      await p1;
    });

    expect(cb1.onRollback).not.toHaveBeenCalled();
    expect(cb1.onSuccess).not.toHaveBeenCalled();
  });

  it('discards a detail fetch that resolves after a newer optimistic mutation', async () => {
    // The iOS bug this guards: a tap fires both the mutation and (via
    // synthesized mouseenter) a details load. If the older load is allowed to
    // write, it clobbers the optimistic update with pre-reaction data.
    const staleDetails: ReactionWithUser[] = [
      { emoji: '❤️', userId: 'other', userName: 'Other', profileColor: 'coral' },
    ];
    const staleLoad = deferred<{ reactions: ReactionWithUser[] }>();
    // The trailing default matters: the mutation below triggers a post-success
    // detail refresh, and without it that call would resolve undefined and
    // throw inside the engine's swallowing catch, masking what's under test.
    getReactions
      .mockReset()
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValue({ reactions: [] });

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
    getReactions.mockReset().mockReturnValueOnce(load.promise).mockResolvedValue({ reactions: [] });

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
