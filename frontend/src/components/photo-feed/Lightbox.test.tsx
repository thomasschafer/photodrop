import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  getComments: vi.fn(),
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  getReactions: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: { photos: mocks },
}));

vi.mock('../../lib/useAuthenticatedImage', () => ({
  useAuthenticatedImage: () => ({ src: null, loading: false }),
  preloadImage: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', name: 'Me', email: 'me@example.com', profileColor: 'teal' },
    imageProtection: false,
  }),
}));

import { Lightbox } from './Lightbox';
import type { Comment, Photo } from './types';

function makePhoto(over: Partial<Photo> = {}): Photo {
  return {
    id: 'p1',
    caption: null,
    uploadedBy: 'me',
    uploaderName: 'Me',
    uploaderProfileColor: 'teal',
    uploadedAt: 1,
    commentCount: 0,
    reactions: [],
    userReactions: [],
    ...over,
  };
}

const myComment: Comment = {
  id: 'c1',
  userId: 'me',
  authorName: 'Me',
  authorProfileColor: 'teal',
  content: 'hello',
  createdAt: 1,
  isDeleted: false,
};

const photos = [makePhoto({ id: 'A', commentCount: 1 }), makePhoto({ id: 'B', commentCount: 0 })];

function renderLightbox(overrides: Partial<Parameters<typeof Lightbox>[0]> = {}) {
  const props = {
    photos,
    initialIndex: 0,
    onClose: vi.fn(),
    onIndexChange: vi.fn(),
    isAdmin: false,
    onPhotoUpdate: vi.fn(),
    ...overrides,
  };
  // The comment panel only renders comments (and their Delete buttons) once
  // expanded, which the lightbox reads from the URL.
  render(
    <MemoryRouter initialEntries={['/photo/A?comments=open']}>
      <Lightbox {...props} />
    </MemoryRouter>
  );
  return props;
}

async function openDeleteDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  expect(screen.getByRole('heading', { name: 'Delete comment' })).toBeInTheDocument();
}

describe('Lightbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComments.mockResolvedValue({ comments: [myComment] });
    mocks.getReactions.mockResolvedValue({ reactions: [] });
    mocks.deleteComment.mockResolvedValue({});
  });

  it('marks itself as a modal dialog', () => {
    renderLightbox();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('keeps Tab inside the lightbox instead of walking into the feed behind it', () => {
    render(
      <MemoryRouter initialEntries={['/photo/A']}>
        <>
          <article tabIndex={0} aria-label="feed photo behind" />
          <Lightbox
            photos={photos}
            initialIndex={0}
            onClose={vi.fn()}
            onIndexChange={vi.fn()}
            isAdmin={false}
            onPhotoUpdate={vi.fn()}
          />
        </>
      </MemoryRouter>
    );

    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    expect(focusable.length).toBeGreaterThan(1);

    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(focusable[0]).toHaveFocus();

    focusable[0].focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(focusable[focusable.length - 1]).toHaveFocus();
  });

  it('does not close the whole lightbox when Escape dismisses the delete dialog', async () => {
    const { onClose } = renderLightbox();
    await openDeleteDialog();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Delete comment' })).not.toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not navigate photos behind the open delete dialog', async () => {
    const { onIndexChange } = renderLightbox();
    await openDeleteDialog();

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(onIndexChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Delete comment' })).toBeInTheDocument();
  });

  it('drops the delete dialog when the photo changes under it', async () => {
    // The real index lives in the URL, so mirror that here: the lightbox only
    // moves when the parent feeds a new initialIndex back in.
    function Harness() {
      const [index, setIndex] = useState(0);
      return (
        <Lightbox
          photos={photos}
          initialIndex={index}
          onClose={vi.fn()}
          onIndexChange={setIndex}
          isAdmin={false}
          onPhotoUpdate={vi.fn()}
        />
      );
    }
    render(
      <MemoryRouter initialEntries={['/photo/A?comments=open']}>
        <Harness />
      </MemoryRouter>
    );
    await openDeleteDialog();

    // Navigating (here via the on-screen next button) must not leave a dialog
    // pointing at a comment that belongs to the previous photo.
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Delete comment' })).not.toBeInTheDocument()
    );
  });
});
