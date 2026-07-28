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
