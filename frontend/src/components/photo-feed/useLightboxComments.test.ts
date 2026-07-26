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
import type { Photo } from './types';
import type { User } from '../../lib/api';

const user: User = { id: 'me', name: 'Me', email: 'me@example.com', profileColor: 'teal' };
const noopEvent = { preventDefault() {} } as FormEvent;

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

describe('useLightboxComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getComments.mockResolvedValue({ comments: [] });
    addComment.mockResolvedValue({ id: 'c-new' });
    deleteComment.mockResolvedValue({});
  });

  it('optimistically adds a posted comment and bumps the count', async () => {
    const onPhotoUpdate = vi.fn();
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
    expect(onPhotoUpdate).toHaveBeenCalledWith({ id: 'p1', commentCount: 1 });
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.postedCommentId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tombstones a deleted comment and drops the count', async () => {
    getComments.mockResolvedValue({
      comments: [
        {
          id: 'c1',
          userId: 'me',
          authorName: 'Me',
          authorProfileColor: 'teal',
          content: 'hi',
          createdAt: 1,
          isDeleted: false,
        },
      ],
    });
    const onPhotoUpdate = vi.fn();
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
    expect(onPhotoUpdate).toHaveBeenCalledWith({ id: 'p1', commentCount: 0 });
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
    const onPhotoUpdate = vi.fn();
    const photoA = makePhoto({ id: 'A', commentCount: 0 });
    const photoB = makePhoto({ id: 'B', commentCount: 0 });

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
    expect(onPhotoUpdate).toHaveBeenCalledWith({ id: 'A', commentCount: 1 });
  });
});
