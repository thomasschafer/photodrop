import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getReactions: vi.fn(),
  getComments: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  feedVersion: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { photos: mocks },
}));

vi.mock('../lib/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ src: null, loading: false }),
  preloadImage: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', name: 'Me', email: 'me@example.com', profileColor: 'teal' },
    imageProtection: false,
  }),
}));

// The feed's own upload flow is not under test here; stand in for the picker
// with a button that reports completion, the only thing the feed reacts to.
vi.mock('./PhotoUpload', () => ({
  PhotoUpload: ({ onUploadComplete }: { onUploadComplete?: () => void }) => (
    <button onClick={onUploadComplete}>complete upload</button>
  ),
}));

import { PhotoFeed } from './PhotoFeed';
import { notifyFeedRefresh } from '../lib/feedRefresh';
import type { Photo } from './photo-feed';

function makePhoto(id: string): Photo {
  return {
    id,
    caption: `photo ${id}`,
    captionEditedAt: null,
    uploadedBy: 'me',
    uploaderName: 'Me',
    uploaderProfileColor: 'teal',
    uploadedAt: 1,
    commentCount: 0,
    reactions: [],
    userReactions: [],
  };
}

// The feed reads the sentinel's position rather than waiting to be told it is
// visible, so these drive it the same way a real scroll does: place the
// sentinel, then dispatch the event.
async function scrollToSentinel() {
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
  });
}

// The feed watches the document for content growth, which is how it notices
// thumbnails resolving and pushing the sentinel back out of view. happy-dom
// has no ResizeObserver, so capture the callback and fire it on demand.
let triggerContentResize: (() => void) | null = null;
let resizeObserved: Element[] = [];

class TestResizeObserver {
  constructor(callback: () => void) {
    triggerContentResize = callback;
  }
  observe(target: Element) {
    resizeObserved.push(target);
  }
  unobserve() {}
  disconnect() {}
}

function renderFeed(isAdmin = false) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <PhotoFeed isAdmin={isAdmin} />
    </MemoryRouter>
  );
}

describe('PhotoFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerContentResize = null;
    resizeObserved = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    mocks.getReactions.mockResolvedValue({ reactions: [] });
    mocks.getComments.mockResolvedValue({ comments: [] });
    mocks.feedVersion.mockResolvedValue({ version: 'v-initial' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Places the load-more sentinel inside the viewport. happy-dom reports an
  // all-zero rect by default, which reads as out of view.
  function putSentinelInView() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 74,
      left: 0,
      right: 0,
      width: 0,
      height: 64,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    });
  }

  it('loads the next page when the sentinel is already in view, without a new notification', async () => {
    // Parked at the bottom of the feed there is no further scroll to
    // re-trigger the observer, so a notification it never delivers would
    // strand the feed. The sentinel is asked directly once a page settles.
    putSentinelInView();
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true, nextCursor: '1_a' })
      .mockResolvedValueOnce({ photos: [makePhoto('b')], hasMore: false, nextCursor: null });

    renderFeed();
    await act(async () => {});

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, '1_a');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('loads the next page when the user scrolls the sentinel into view', async () => {
    // The sentinel starts out of view, so nothing loads until the scroll.
    mocks.list
      .mockResolvedValueOnce({
        photos: [makePhoto('a'), makePhoto('b')],
        hasMore: true,
        nextCursor: '1_b',
      })
      .mockResolvedValueOnce({ photos: [makePhoto('c')], hasMore: false, nextCursor: null });

    renderFeed();
    await act(async () => {});
    expect(mocks.list).toHaveBeenCalledTimes(1);

    putSentinelInView();
    await scrollToSentinel();

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, '1_b');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps paging past a page of rows it already holds', async () => {
    // Keyset cursors make duplicate pages a server-side anomaly (a cache
    // replay, say) rather than routine — but if one does arrive, its rows
    // must not reach the list as duplicate React keys, and paging must follow
    // the server's cursor onwards rather than stall.
    putSentinelInView();
    mocks.list
      .mockResolvedValueOnce({
        photos: [makePhoto('a'), makePhoto('b')],
        hasMore: true,
        nextCursor: '1_b',
      })
      .mockResolvedValueOnce({
        photos: [makePhoto('a'), makePhoto('b')],
        hasMore: true,
        nextCursor: '1_b2',
      })
      .mockResolvedValueOnce({ photos: [makePhoto('c')], hasMore: false, nextCursor: null });

    renderFeed();
    await act(async () => {});

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, '1_b');
    expect(mocks.list).toHaveBeenNthCalledWith(3, 20, '1_b2');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('photo a')).toHaveLength(1);
    expect(screen.getByText('photo c')).toBeInTheDocument();
  });

  it('loads more when growing thumbnails push the sentinel back into view', async () => {
    // Scrolling to the bottom of a short document leaves the sentinel visible,
    // then each thumbnail resolving from its placeholder grows the page and
    // pushes it below the fold again — with no scroll and no viewport change
    // to announce it. Only content growth reports this.
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true, nextCursor: '1_a' })
      .mockResolvedValueOnce({ photos: [makePhoto('b')], hasMore: false, nextCursor: null });

    renderFeed();
    await act(async () => {});
    expect(mocks.list).toHaveBeenCalledTimes(1);

    putSentinelInView();
    expect(triggerContentResize).toBeTypeOf('function');
    // The document element is pinned to the viewport by height: 100%, so only
    // watching the list itself reports thumbnails growing.
    expect(resizeObserved).toContain(screen.getByRole('list', { name: 'Photo feed' }));
    await act(async () => {
      triggerContentResize?.();
    });

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, '1_a');
  });

  it('offers a retry after a failed page, and resumes paging when it is used', async () => {
    putSentinelInView();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The retry succeeds with more still to come, so the sentinel stays
    // mounted: the retry control can only disappear because the failure was
    // actually cleared, not because the whole sentinel unmounted.
    //
    // Paging fires once more after that, since the sentinel is still in view.
    // That request must never settle — a page of zero rows would end the feed
    // and unmount the sentinel, taking the retry control with it and making
    // the assertion below pass for the very reason this setup rules out.
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true, nextCursor: '1_a' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ photos: [makePhoto('b')], hasMore: true, nextCursor: '1_b' })
      .mockReturnValue(new Promise(() => {}));

    renderFeed();
    await act(async () => {});

    const retry = await screen.findByRole('button', { name: 'Try again' });
    await act(async () => {
      fireEvent.click(retry);
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('photo b')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('resyncs the feed from the server when a reaction toggle fails', async () => {
    // Two toggles of the same emoji can overlap, and only the newer may roll
    // back, so the pair cannot be composed back to the server's answer. The
    // feed is the copy the lightbox re-seeds from, so a wrong value here
    // spreads — it takes the refetched absolute state instead.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.list.mockResolvedValue({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });
    mocks.addReaction.mockRejectedValue(new Error('network'));
    mocks.getReactions.mockResolvedValue({
      reactions: [{ emoji: '❤️', userId: 'someone-else', userName: 'Ada', profileColor: 'teal' }],
    });

    renderFeed();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'React with ❤️' }));
    });

    // The server's answer: one ❤️, and not from this user.
    expect(await screen.findByRole('button', { name: 'Add ❤️ reaction' })).toHaveTextContent('1');
  });

  it('stops retrying after a failed page instead of spinning on it', async () => {
    // Nothing was appended, so the sentinel is still on screen and every
    // trigger would fire again immediately.
    putSentinelInView();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true, nextCursor: '1_a' })
      .mockRejectedValue(new Error('network'));

    renderFeed();
    await act(async () => {});
    const afterFailure = mocks.list.mock.calls.length;

    await scrollToSentinel();
    await scrollToSentinel();

    expect(mocks.list).toHaveBeenCalledTimes(afterFailure);
    expect(afterFailure).toBe(2);
  });

  it('lets a second upload show its message for the full duration', async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

    renderFeed(true);
    await act(async () => {});

    const upload = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      fireEvent.click(screen.getByText('complete upload'));
      await act(async () => {});
    };

    await upload();
    expect(screen.getByRole('status')).toHaveTextContent('Photo uploaded successfully');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    await upload();

    // The first upload's 3s timer is due now; left running it would wipe the
    // second upload's message after only a second.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('cancels a pending success-message timer when it unmounts', async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { unmount } = renderFeed(true);
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    fireEvent.click(screen.getByText('complete upload'));
    await act(async () => {});

    const messageTimer = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 3000);
    expect(messageTimer).toBeGreaterThanOrEqual(0);
    const timerId = setTimeoutSpy.mock.results[messageTimer].value;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
  });

  describe('feed freshness', () => {
    async function focusCheck() {
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
    }

    it('prepends photos uploaded elsewhere when the viewport is at the top', async () => {
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});
      expect(screen.getAllByRole('listitem')).toHaveLength(1);

      mocks.feedVersion.mockResolvedValue({ version: 'v-changed' });
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('b'), makePhoto('a')],
        hasMore: false,
        nextCursor: null,
      });
      await focusCheck();

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('photo b');
    });

    it('holds new photos behind a pill while scrolled, merging on click', async () => {
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});

      Object.defineProperty(window, 'scrollY', { value: 800, configurable: true });
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      try {
        mocks.feedVersion.mockResolvedValue({ version: 'v-changed' });
        mocks.list.mockResolvedValueOnce({
          photos: [makePhoto('b'), makePhoto('a')],
          hasMore: false,
          nextCursor: null,
        });
        await focusCheck();

        // Nothing shifted under the user; the arrival is announced instead.
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
        const pill = screen.getByRole('button', { name: '1 new photo' });

        await act(async () => {
          fireEvent.click(pill);
        });

        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('photo b');
        expect(screen.queryByRole('button', { name: '1 new photo' })).not.toBeInTheDocument();
        expect(scrollTo).toHaveBeenCalled();
      } finally {
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      }
    });

    it('updates comment and reaction counts of visible photos in place', async () => {
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});

      mocks.feedVersion.mockResolvedValue({ version: 'v-changed' });
      mocks.list.mockResolvedValueOnce({
        photos: [{ ...makePhoto('a'), commentCount: 2 }],
        hasMore: false,
        nextCursor: null,
      });
      await focusCheck();

      expect(screen.getByText('2 comments')).toBeInTheDocument();
    });

    it('does not refetch when the fingerprint is unchanged', async () => {
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});
      expect(mocks.list).toHaveBeenCalledTimes(1);

      await focusCheck();

      expect(mocks.list).toHaveBeenCalledTimes(1);
    });

    it('drops photos deleted elsewhere, even on a single-page feed', async () => {
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('a'), makePhoto('b')],
        hasMore: false,
        nextCursor: null,
      });

      renderFeed();
      await act(async () => {});
      expect(screen.getAllByRole('listitem')).toHaveLength(2);

      // Photo b is deleted in another session; the final page serves only a.
      mocks.feedVersion.mockResolvedValue({ version: 'v-deleted' });
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('a')],
        hasMore: false,
        nextCursor: null,
      });
      await focusCheck();

      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByText('photo b')).not.toBeInTheDocument();
    });

    it('retries the refresh on the next check when the re-sync fetch fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});

      // The fingerprint changes but the list fetch dies (flaky network).
      mocks.feedVersion.mockResolvedValue({ version: 'v-changed' });
      mocks.list.mockRejectedValueOnce(new Error('network'));
      await focusCheck();
      expect(screen.getAllByRole('listitem')).toHaveLength(1);

      // Same fingerprint on the next check: the version must not have been
      // committed by the failed attempt, so this check refreshes again.
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('b'), makePhoto('a')],
        hasMore: false,
        nextCursor: null,
      });
      await focusCheck();

      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByText('photo b')).toBeInTheDocument();
    });

    it('propagates caption edits made elsewhere, with the edited marker', async () => {
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});

      mocks.feedVersion.mockResolvedValue({ version: 'v-caption' });
      mocks.list.mockResolvedValueOnce({
        photos: [{ ...makePhoto('a'), caption: 'fixed typo', captionEditedAt: 99 }],
        hasMore: false,
        nextCursor: null,
      });
      await focusCheck();

      expect(screen.getByText(/fixed typo/)).toBeInTheDocument();
      expect(screen.getByText('(edited)')).toBeInTheDocument();
    });

    it('reloads from scratch when the whole first page is new', async () => {
      // More may have landed than one page can show; prepending would leave a
      // silent gap below, since paging continues from the old tail.
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('old1'), makePhoto('old2')],
        hasMore: false,
        nextCursor: null,
      });

      renderFeed();
      await act(async () => {});
      expect(mocks.list).toHaveBeenCalledTimes(1);

      mocks.feedVersion.mockResolvedValue({ version: 'v-flood' });
      // The refresh sees an entirely unknown page...
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('new1'), makePhoto('new2')],
        hasMore: true,
        nextCursor: '1_new2',
      });
      // ...so the feed restarts, and this is the fresh first page.
      mocks.list.mockResolvedValueOnce({
        photos: [makePhoto('new1'), makePhoto('new2')],
        hasMore: true,
        nextCursor: '1_new2',
      });
      await focusCheck();

      // Three list calls: initial, the refresh, and the restart.
      expect(mocks.list).toHaveBeenCalledTimes(3);
      expect(mocks.list).toHaveBeenNthCalledWith(3, 20);
      expect(screen.queryByText('photo old1')).not.toBeInTheDocument();
      expect(screen.getByText('photo new1')).toBeInTheDocument();
    });

    it('re-syncs bylines when notified of a profile change', async () => {
      mocks.list.mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: false, nextCursor: null });

      renderFeed();
      await act(async () => {});
      expect(screen.getByText('Me')).toBeInTheDocument();

      mocks.list.mockResolvedValueOnce({
        photos: [{ ...makePhoto('a'), uploaderName: 'Tom the Tester' }],
        hasMore: false,
        nextCursor: null,
      });
      await act(async () => {
        notifyFeedRefresh();
      });

      expect(screen.getByText('Tom the Tester')).toBeInTheDocument();
    });
  });
});
