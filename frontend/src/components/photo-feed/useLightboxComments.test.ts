import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { FormEvent } from 'react';

// Hoisted so the vi.mock factory (which runs before the module body) can
// reference the mock fns and the ApiError class without a TDZ error.
const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  }
  return { getComments: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(), ApiError };
});

const { getComments, addComment, deleteComment, ApiError } = mocks;

vi.mock('../../lib/api', () => ({
  ApiError: mocks.ApiError,
  api: {
    photos: {
      getComments: mocks.getComments,
      addComment: mocks.addComment,
      deleteComment: mocks.deleteComment,
    },
  },
}));

import { useLightboxComments } from './useLightboxComments';
import type { Comment, Photo, PhotoUpdate } from './types';
import type { User } from '../../lib/api';

const user: User = { id: 'me', name: 'Me', email: 'me@example.com', profileColor: 'teal' };
const noopEvent = { preventDefault() {} } as FormEvent;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    userId: 'me',
    authorName: 'Me',
    authorProfileColor: 'teal',
    content: 'hi',
    createdAt: 1,
    isDeleted: false,
    ...over,
  };
}

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

/**
 * Stands in for the feed's copy of a photo, applying updates the way PhotoFeed
 * does: a plain patch is merged, a functional one is handed the live copy. Only
 * this makes an assertion about the resulting count meaningful — a plain
 * `{ commentCount: n }` says nothing about what the feed ends up holding when
 * another mutation for the same photo settled in between.
 */
function trackFeedPhoto(initial: Photo) {
  const feed = { photo: initial };
  const onPhotoUpdate = vi.fn((photoId: string, update: PhotoUpdate) => {
    expect(photoId).toBe(feed.photo.id);
    feed.photo = { ...feed.photo, ...(typeof update === 'function' ? update(feed.photo) : update) };
  });
  return { feed, onPhotoUpdate };
}

describe('useLightboxComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getComments.mockResolvedValue({ comments: [] });
    addComment.mockResolvedValue({ id: 'c-new' });
    deleteComment.mockResolvedValue({});
  });

  it('optimistically adds a posted comment and bumps the count', async () => {
    const { feed, onPhotoUpdate } = trackFeedPhoto(makePhoto({ commentCount: 0 }));
    const { result } = renderHook(() =>
      useLightboxComments({
        photo: makePhoto({ commentCount: 0 }),
        prevPhoto: undefined,
        nextPhoto: undefined,
        user,
        onPhotoUpdate,
      })
    );
    await waitFor(() => expect(getComments).toHaveBeenCalledWith('p1'));

    act(() => result.current.setNewComment('hello'));
    await act(async () => {
      await result.current.submitComment(noopEvent);
    });

    expect(addComment).toHaveBeenCalledWith('p1', 'hello');
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0].content).toBe('hello');
    expect(result.current.newComment).toBe('');
    expect(onPhotoUpdate).toHaveBeenCalledTimes(1);
    expect(feed.photo.commentCount).toBe(1);
  });

  it('highlights a posted comment, then clears the highlight', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useLightboxComments({
          photo: makePhoto(),
          prevPhoto: undefined,
          nextPhoto: undefined,
          user,
          onPhotoUpdate: vi.fn(),
        })
      );
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(result.current.postedCommentId).toBeNull();

      act(() => result.current.setNewComment('hello'));
      await act(async () => {
        await result.current.submitComment(noopEvent);
      });

      expect(result.current.postedCommentId).toBe('c-new');

      // The highlight has to outlast the 1.4s `.comment-flash` animation in
      // index.css, or the row would go flat mid-flash.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
      });
      expect(result.current.postedCommentId).toBe('c-new');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(result.current.postedCommentId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tombstones a deleted comment and drops the count', async () => {
    getComments.mockResolvedValue({ comments: [makeComment()] });
    const { feed, onPhotoUpdate } = trackFeedPhoto(makePhoto({ commentCount: 1 }));
    const { result } = renderHook(() =>
      useLightboxComments({
        photo: makePhoto({ commentCount: 1 }),
        prevPhoto: undefined,
        nextPhoto: undefined,
        user,
        onPhotoUpdate,
      })
    );
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => result.current.requestDeleteComment('c1'));
    await act(async () => {
      await result.current.confirmDeleteComment();
    });

    expect(deleteComment).toHaveBeenCalledWith('p1', 'c1');
    expect(result.current.comments[0].isDeleted).toBe(true);
    expect(onPhotoUpdate).toHaveBeenCalledTimes(1);
    expect(feed.photo.commentCount).toBe(0);
  });

  it('keeps the feed count right when a post and a delete settle out of order', async () => {
    // The post is guarded by `submitting` and the delete by `deletingId`, so
    // both can be in flight for the same photo at once. Each has to apply its
    // delta to the feed's live copy: pushing the count captured when it started
    // lets whichever settles last erase the other's result.
    getComments.mockResolvedValue({ comments: [makeComment({ id: 'c1' })] });
    const post = deferred<{ id: string }>();
    addComment.mockReturnValue(post.promise);
    const deletion = deferred<unknown>();
    deleteComment.mockReturnValue(deletion.promise);

    const { feed, onPhotoUpdate } = trackFeedPhoto(makePhoto({ commentCount: 1 }));
    const { result } = renderHook(() =>
      useLightboxComments({
        photo: makePhoto({ commentCount: 1 }),
        prevPhoto: undefined,
        nextPhoto: undefined,
        user,
        onPhotoUpdate,
      })
    );
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => result.current.setNewComment('hello'));
    let submitPromise: Promise<void> = Promise.resolve();
    act(() => {
      submitPromise = result.current.submitComment(noopEvent);
    });
    act(() => result.current.requestDeleteComment('c1'));
    let deletePromise: Promise<void> = Promise.resolve();
    act(() => {
      deletePromise = result.current.confirmDeleteComment();
    });

    // The delete comes back first, the post second.
    await act(async () => {
      deletion.resolve({});
      await deletePromise;
    });
    await act(async () => {
      post.resolve({ id: 'c-new' });
      await submitPromise;
    });

    // Started at 1, one added and one removed: still 1.
    expect(onPhotoUpdate).toHaveBeenCalledTimes(2);
    expect(feed.photo.commentCount).toBe(1);
  });

  it('surfaces the server error message on a failed post', async () => {
    addComment.mockRejectedValue(new ApiError(429, 'Too many comments'));
    const { result } = renderHook(() =>
      useLightboxComments({
        photo: makePhoto(),
        prevPhoto: undefined,
        nextPhoto: undefined,
        user,
        onPhotoUpdate: vi.fn(),
      })
    );
    await waitFor(() => expect(getComments).toHaveBeenCalled());

    act(() => result.current.setNewComment('spam'));
    await act(async () => {
      await result.current.submitComment(noopEvent);
    });

    expect(result.current.commentError).toBe('Too many comments');
    expect(result.current.comments).toHaveLength(0);
  });

  it('does not clobber the new photo when a post resolves after navigating away', async () => {
    let resolveAdd: (v: { id: string }) => void = () => {};
    addComment.mockReturnValue(
      new Promise<{ id: string }>((res) => {
        resolveAdd = res;
      })
    );
    const photoA = makePhoto({ id: 'A', commentCount: 0 });
    const photoB = makePhoto({ id: 'B', commentCount: 0 });
    const { feed, onPhotoUpdate } = trackFeedPhoto(photoA);

    const { result, rerender } = renderHook(
      ({ photo }) =>
        useLightboxComments({
          photo,
          prevPhoto: undefined,
          nextPhoto: undefined,
          user,
          onPhotoUpdate,
        }),
      { initialProps: { photo: photoA } }
    );
    await waitFor(() => expect(getComments).toHaveBeenCalledWith('A'));

    act(() => result.current.setNewComment('on A'));
    let submitPromise: Promise<void> = Promise.resolve();
    act(() => {
      submitPromise = result.current.submitComment(noopEvent);
    });

    // Navigate to B before the post resolves.
    rerender({ photo: photoB });
    await waitFor(() => expect(getComments).toHaveBeenCalledWith('B'));

    await act(async () => {
      resolveAdd({ id: 'c-new' });
      await submitPromise;
    });

    // B's visible comments are untouched, but A's count was still updated.
    expect(result.current.comments).toEqual([]);
    expect(onPhotoUpdate).toHaveBeenCalledTimes(1);
    expect(feed.photo.commentCount).toBe(1);
    // A's post can no longer clear the flag (its finally is guarded on the
    // active photo), so the swipe had to. Left set, the comment box and Post
    // button stay disabled on every photo for the rest of the session.
    expect(result.current.submittingComment).toBe(false);
  });

  it('clears the loading spinner when navigating to an already-cached photo', async () => {
    const loadA = deferred<{ comments: Comment[] }>();
    getComments.mockImplementation((photoId: string) =>
      photoId === 'A' ? loadA.promise : Promise.resolve({ comments: [] })
    );
    const photoA = makePhoto({ id: 'A' });
    const photoB = makePhoto({ id: 'B' });

    const { result, rerender } = renderHook(
      ({ photo, nextPhoto }) =>
        useLightboxComments({
          photo,
          prevPhoto: undefined,
          nextPhoto,
          user,
          onPhotoUpdate: vi.fn(),
        }),
      { initialProps: { photo: photoA, nextPhoto: photoB as Photo | undefined } }
    );

    // B is prefetched and cached while A's own load is still in flight.
    await waitFor(() => expect(getComments).toHaveBeenCalledWith('B'));
    await act(async () => {});
    expect(result.current.loadingComments).toBe(true);

    rerender({ photo: photoB, nextPhoto: undefined });

    // B's comments come from the cache, so no new load runs — nothing else
    // will ever turn the spinner off, since A's load is guarded on the photo
    // being active.
    expect(result.current.loadingComments).toBe(false);
  });

  it('drops a pending delete and its confirm dialog when the user navigates away', async () => {
    const deletion = deferred<unknown>();
    deleteComment.mockReturnValue(deletion.promise);
    getComments.mockResolvedValue({ comments: [makeComment({ id: 'c1' })] });
    const photoA = makePhoto({ id: 'A', commentCount: 1 });
    const photoB = makePhoto({ id: 'B', commentCount: 0 });

    const { result, rerender } = renderHook(
      ({ photo }) =>
        useLightboxComments({
          photo,
          prevPhoto: undefined,
          nextPhoto: undefined,
          user,
          onPhotoUpdate: vi.fn(),
        }),
      { initialProps: { photo: photoA } }
    );
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    act(() => result.current.requestDeleteComment('c1'));
    let deletePromise: Promise<void> = Promise.resolve();
    act(() => {
      deletePromise = result.current.confirmDeleteComment();
    });
    expect(result.current.deletingCommentId).toBe('c1');

    rerender({ photo: photoB });

    // The dialog referred to a comment on A: left open on B, confirming it
    // would delete A's comment id against B, and the Delete button's "..."
    // would never clear.
    expect(result.current.confirmDeleteCommentId).toBeNull();
    expect(result.current.deletingCommentId).toBeNull();

    await act(async () => {
      deletion.resolve({});
      await deletePromise;
    });
    expect(result.current.deletingCommentId).toBeNull();
  });
});
