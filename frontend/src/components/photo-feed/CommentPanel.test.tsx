import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentPanel, type CommentPanelProps } from './CommentPanel';
import type { Comment } from './types';

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    userId: 'me',
    authorName: 'Me',
    authorProfileColor: 'teal',
    content: 'hello',
    createdAt: 1000,
    isDeleted: false,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<CommentPanelProps> = {}) {
  const props: CommentPanelProps = {
    reactions: [],
    userReactions: [],
    comments: [],
    commentCount: 0,
    commentsExpanded: true,
    currentUserId: 'me',
    isAdmin: false,
    reactionPillsProps: { onReactionClick: vi.fn() },
    commentSortOrder: 'newest',
    onSortOrderChange: vi.fn(),
    onToggleExpanded: vi.fn(),
    onDeleteComment: vi.fn(),
    deletingCommentId: null,
    loadingComments: false,
    commentInputRef: { current: null },
    newComment: '',
    onNewCommentChange: vi.fn(),
    onSubmitComment: vi.fn(),
    submittingComment: false,
    ...overrides,
  };
  return render(<CommentPanel {...props} />);
}

describe('CommentPanel', () => {
  it('shows the authoritative commentCount, not the rendered list length', () => {
    // List has 3 entries (one a deleted tombstone), but only 2 real comments.
    const comments = [
      makeComment({ id: 'a', content: 'one' }),
      makeComment({ id: 'b', content: 'two' }),
      makeComment({ id: 'c', isDeleted: true, userId: null }),
    ];
    renderPanel({ comments, commentCount: 2, commentsExpanded: false });

    // The collapsed badge / aria-label reflects the non-deleted count.
    expect(screen.getByLabelText('Expand comments (2 comments)')).toBeInTheDocument();
  });

  it('renders a deleted comment as an unattributed tombstone', () => {
    const comments = [
      makeComment({ id: 'a', authorName: 'Bob', content: 'real comment', userId: 'bob' }),
      makeComment({ id: 'b', isDeleted: true, userId: null, authorName: '[deleted]' }),
    ];
    renderPanel({ comments, commentCount: 1 });

    expect(screen.getByText('This comment has been deleted.')).toBeInTheDocument();
    // No awkward author label, and the live comment is unaffected.
    expect(screen.queryByText('[deleted]')).not.toBeInTheDocument();
    expect(screen.queryByText(/\(deleted\)/)).not.toBeInTheDocument();
    expect(screen.getByText('real comment')).toBeInTheDocument();
  });

  it('offers delete on your own live comment but never on a tombstone', () => {
    const onDeleteComment = vi.fn();
    const comments = [
      makeComment({ id: 'mine', userId: 'me', content: 'mine' }),
      makeComment({ id: 'gone', isDeleted: true, userId: null }),
    ];
    renderPanel({ comments, commentCount: 1, onDeleteComment });

    // Exactly one Delete control — for the live comment, not the tombstone.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    expect(deleteButtons).toHaveLength(1);
  });
});
