import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getReactions: vi.fn(),
  getComments: vi.fn(),
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
import type { Photo } from './photo-feed';

function makePhoto(id: string): Photo {
  return {
    id,
    caption: `photo ${id}`,
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
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true })
      .mockResolvedValueOnce({ photos: [makePhoto('b')], hasMore: false });

    renderFeed();
    await act(async () => {});

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, 1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('loads the next page when the user scrolls the sentinel into view', async () => {
    // The sentinel starts out of view, so nothing loads until the scroll.
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a'), makePhoto('b')], hasMore: true })
      .mockResolvedValueOnce({ photos: [makePhoto('c')], hasMore: false });

    renderFeed();
    await act(async () => {});
    expect(mocks.list).toHaveBeenCalledTimes(1);

    putSentinelInView();
    await scrollToSentinel();

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, 2);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps paging past a page of rows it already holds', async () => {
    // Uploads between two fetches shift a newest-first list down, so a page
    // can be entirely rows we hold. Those must not reach the list — duplicate
    // React keys — but they must still advance the offset, or the feed both
    // re-requests them forever and silently truncates mid-history.
    putSentinelInView();
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a'), makePhoto('b')], hasMore: true })
      .mockResolvedValueOnce({ photos: [makePhoto('a'), makePhoto('b')], hasMore: true })
      .mockResolvedValueOnce({ photos: [makePhoto('c')], hasMore: false });

    renderFeed();
    await act(async () => {});

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, 2);
    expect(mocks.list).toHaveBeenNthCalledWith(3, 20, 4);
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
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true })
      .mockResolvedValueOnce({ photos: [makePhoto('b')], hasMore: false });

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

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, 1);
  });

  it('offers a retry after a failed page, and resumes paging when it is used', async () => {
    putSentinelInView();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The retry succeeds with more still to come, so the sentinel stays
    // mounted: the retry control can only disappear because the failure was
    // actually cleared, not because the whole sentinel unmounted.
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ photos: [makePhoto('b')], hasMore: true })
      .mockResolvedValue({ photos: [], hasMore: true });

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

  it('stops retrying after a failed page instead of spinning on it', async () => {
    // Nothing was appended, so the sentinel is still on screen and every
    // trigger would fire again immediately.
    putSentinelInView();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a')], hasMore: true })
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
    mocks.list.mockResolvedValue({ photos: [makePhoto('a')], hasMore: false });

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
    mocks.list.mockResolvedValue({ photos: [makePhoto('a')], hasMore: false });
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
});
