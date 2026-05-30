import { useMemo } from 'react';
import { formatRelativeTime } from '../../lib/dateFormat';
import { Avatar } from '../Avatar';
import { SelectDropdown } from '../SelectDropdown';
import { ReactionPills, type ReactionPillsProps } from './ReactionPills';
import type { ReactionSummary, Comment } from './types';

const SORT_OPTIONS: Array<{ value: 'newest' | 'oldest'; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export interface CommentPanelProps {
  reactions: ReactionSummary[];
  userReaction: string | null;
  comments: Comment[];
  /**
   * Authoritative count of non-deleted comments (from `photo.commentCount`).
   * Used for the badge so it matches the feed and stays correct through
   * optimistic add/delete; deleted-comment tombstones in `comments` are shown
   * but not counted.
   */
  commentCount: number;
  commentsExpanded: boolean;
  currentUserId?: string;
  isAdmin: boolean;
  reactionPillsProps: Omit<ReactionPillsProps, 'reactions' | 'userReaction'>;
  commentSortOrder: 'newest' | 'oldest';
  onSortOrderChange: (order: 'newest' | 'oldest') => void;
  onToggleExpanded: () => void;
  onDeleteComment: (commentId: string) => void;
  deletingCommentId: string | null;
  loadingComments: boolean;
  commentsLoadError?: boolean;
  onRetryLoadComments?: () => void;
  commentInputRef: React.RefObject<HTMLInputElement | null>;
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onSubmitComment: (e: React.FormEvent) => void;
  submittingComment: boolean;
  commentError?: string | null;
}

export function CommentPanel({
  reactions,
  userReaction,
  comments,
  commentCount,
  commentsExpanded,
  currentUserId,
  isAdmin,
  reactionPillsProps,
  commentSortOrder,
  onSortOrderChange,
  onToggleExpanded,
  onDeleteComment,
  deletingCommentId,
  loadingComments,
  commentsLoadError,
  onRetryLoadComments,
  commentInputRef,
  newComment,
  onNewCommentChange,
  onSubmitComment,
  submittingComment,
  commentError,
}: CommentPanelProps) {
  const sortedComments = useMemo(
    () =>
      [...comments].sort((a, b) =>
        commentSortOrder === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
      ),
    [comments, commentSortOrder]
  );

  const reactionPillsElement = (
    <ReactionPills reactions={reactions} userReaction={userReaction} {...reactionPillsProps} />
  );

  const arrowIcon = (
    <>
      <svg
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        className="landscape:hidden"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={commentsExpanded ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'}
        />
      </svg>
      <svg
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        className="hidden landscape:block"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={commentsExpanded ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'}
        />
      </svg>
    </>
  );

  const expandCollapseButton = (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpanded();
      }}
      className="p-2 rounded-lg transition-colors text-text-muted flex-shrink-0 hover:bg-bg-tertiary hover:text-text-secondary cursor-pointer flex items-center gap-2 landscape:flex-col landscape:gap-2.5"
      aria-label={
        commentsExpanded
          ? `Collapse comments (${commentCount} ${commentCount === 1 ? 'comment' : 'comments'})`
          : `Expand comments (${commentCount} ${commentCount === 1 ? 'comment' : 'comments'})`
      }
    >
      <span aria-hidden="true">{arrowIcon}</span>
      {!commentsExpanded && (
        <span className="relative text-xl" aria-hidden="true">
          💬
          <span className="absolute -top-2 -right-2.5 min-w-[1.25rem] h-[1.25rem] px-1 flex items-center justify-center text-xs font-semibold bg-accent-solid text-white rounded-full shadow-sm">
            {commentCount}
          </span>
        </span>
      )}
    </button>
  );

  return (
    <div
      className={`bg-surface/95 backdrop-blur rounded-lg h-full flex flex-col ${
        !commentsExpanded ? 'max-w-[900px] landscape:max-w-none mx-auto landscape:mx-0' : ''
      }`}
    >
      {!commentsExpanded ? (
        <div className="flex items-center justify-between p-2 px-3 landscape:flex-col landscape:items-stretch landscape:justify-between landscape:flex-1 landscape:p-3">
          <div className="landscape:[&>div]:flex-col landscape:[&>div]:items-start">
            {reactionPillsElement}
          </div>
          <div className="landscape:self-start">{expandCollapseButton}</div>
        </div>
      ) : (
        <>
          <div className="flex-shrink-0 p-3 border-b border-border">
            <div className="flex items-center gap-3 flex-wrap">
              {reactionPillsElement}
              <div className="ml-auto flex items-center gap-2">
                {!loadingComments && (
                  <SelectDropdown
                    value={commentSortOrder}
                    onChange={onSortOrderChange}
                    options={SORT_OPTIONS}
                    ariaLabel="Sort order"
                  />
                )}
                {expandCollapseButton}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {loadingComments ? (
              <div className="flex justify-center py-4">
                <div className="spinner-sm" />
              </div>
            ) : commentsLoadError ? (
              <div className="text-center py-4">
                <p className="text-sm text-text-muted mb-2">Couldn't load comments.</p>
                {onRetryLoadComments && (
                  <button
                    onClick={onRetryLoadComments}
                    className="text-sm text-accent hover:underline cursor-pointer"
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : sortedComments.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-4">No comments yet</p>
            ) : (
              <div className="divide-y divide-border">
                {sortedComments.map((comment) => {
                  // Deleted comments keep their place in the thread as an
                  // unattributed tombstone so the surrounding replies still
                  // make sense, but carry no author, avatar, or delete action.
                  if (comment.isDeleted) {
                    return (
                      <div key={comment.id} className="text-sm py-3 first:pt-0 last:pb-0">
                        <p className="break-words italic text-text-muted">
                          This comment has been deleted.
                        </p>
                        <p className="text-xs text-text-muted mt-1">
                          {formatRelativeTime(comment.createdAt)}
                        </p>
                      </div>
                    );
                  }

                  // A null userId on a live comment means the author's account
                  // was removed (distinct from the comment being deleted).
                  const isAuthorDeleted = !comment.userId;
                  const canDelete = comment.userId === currentUserId || isAdmin;

                  return (
                    <div key={comment.id} className="text-sm py-3 first:pt-0 last:pb-0">
                      <div className="flex justify-between items-center gap-2">
                        <span className="flex items-center gap-1.5">
                          {comment.authorProfileColor && !isAuthorDeleted && (
                            <Avatar
                              name={comment.authorName}
                              color={comment.authorProfileColor}
                              size="sm"
                            />
                          )}
                          <span
                            className={
                              isAuthorDeleted
                                ? 'font-medium text-text-muted'
                                : 'font-medium text-text-primary'
                            }
                          >
                            {isAuthorDeleted ? 'Deleted user' : comment.authorName}
                          </span>
                        </span>
                        {canDelete && (
                          <button
                            onClick={() => onDeleteComment(comment.id)}
                            disabled={deletingCommentId === comment.id}
                            className="text-xs text-text-muted hover:text-error transition-colors cursor-pointer flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center -my-2"
                          >
                            {deletingCommentId === comment.id ? '...' : 'Delete'}
                          </button>
                        )}
                      </div>
                      <p className="mt-0.5 break-words text-text-secondary">{comment.content}</p>
                      <p className="text-xs text-text-muted mt-1">
                        {formatRelativeTime(comment.createdAt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <form onSubmit={onSubmitComment} className="flex-shrink-0 p-3 border-t border-border">
            {commentError && <p className="text-xs text-error mb-2">{commentError}</p>}
            <div className="flex gap-2">
              <input
                ref={commentInputRef}
                type="text"
                value={newComment}
                onChange={(e) => onNewCommentChange(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={submittingComment}
              />
              <button
                type="submit"
                disabled={!newComment.trim() || submittingComment}
                className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors cursor-pointer flex-shrink-0"
              >
                {submittingComment ? '...' : 'Post'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
