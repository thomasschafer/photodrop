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

// happy-dom has no IntersectionObserver that fires, so capture the feed's
// callback and invoke it to simulate the load-more sentinel scrolling in.
let triggerLoadMore: (() => void) | null = null;

class TestIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    triggerLoadMore = () =>
      callback([{ isIntersecting: true }] as IntersectionObserverEntry[], this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
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
    triggerLoadMore = null;
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    mocks.getReactions.mockResolvedValue({ reactions: [] });
    mocks.getComments.mockResolvedValue({ comments: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not repeat a photo when the next page overlaps the previous one', async () => {
    // Offset paging over a newest-first list: an upload landing between the
    // two requests shifts the list down, so page 2 re-sends the tail of page
    // 1. Appending it blindly duplicates React keys and leaves the lightbox's
    // findIndex resolving to the first copy.
    mocks.list
      .mockResolvedValueOnce({ photos: [makePhoto('a'), makePhoto('b')], hasMore: true })
      .mockResolvedValueOnce({ photos: [makePhoto('b'), makePhoto('c')], hasMore: false });

    renderFeed();
    await act(async () => {});

    expect(triggerLoadMore).toBeTypeOf('function');
    await act(async () => {
      triggerLoadMore?.();
    });

    expect(mocks.list).toHaveBeenNthCalledWith(2, 20, 2);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('photo b')).toHaveLength(1);
    expect(screen.getByText('photo c')).toBeInTheDocument();
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
