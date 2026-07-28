import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { COMMENT_MAX_LENGTH } from '@photodrop/common/limits';
import type { User } from '../../lib/api';
import type { OnPhotoUpdate, Photo, Comment } from './types';

/** How long a freshly posted comment stays highlighted. Must be at least as
 *  long as the `.comment-flash` animation in index.css. */
const COMMENT_HIGHLIGHT_MS = 1600;

interface UseLightboxCommentsArgs {
  photo: Photo;
  prevPhoto: Photo | undefined;
  nextPhoto: Photo | undefined;
  user: User | null;
  onPhotoUpdate: OnPhotoUpdate;
}

/**
 * Owns the lightbox's comment state for the active photo: loading, posting and
 * deleting, plus a shared cache used to prefetch neighbours. Deleted comments
 * are kept as tombstones (so threads still read correctly); the authoritative
 * count lives on `photo.commentCount`, not here. All async work is guarded
 * against the user navigating away mid-flight.
 */
export function useLightboxComments({
  photo,
  prevPhoto,
  nextPhoto,
  user,
  onPhotoUpdate,
}: UseLightboxCommentsArgs) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [postedCommentId, setPostedCommentId] = useState<string | null>(null);

  const cache = useRef<Map<string, Comment[]>>(new Map());
  const currentPhotoIdRef = useRef(photo.id);

  // Reset to the active photo when it changes (using cached comments if present).
  useLayoutEffect(() => {
    currentPhotoIdRef.current = photo.id;
    setComments(cache.current.get(photo.id) ?? []);
    setNewComment('');
    setSubmitError(null);
    setLoadError(false);
    setDeleteError(null);
    setPostedCommentId(null);
    // In-flight requests for the photo we just left can never clear these:
    // every settle path is guarded on currentPhotoIdRef. Left set they stay
    // set for the rest of the lightbox session — a permanent spinner, a
    // comment box disabled on every photo, or a Delete button stuck on "...".
    setLoading(false);
    setSubmitting(false);
    setDeletingId(null);
    // The confirm dialog belongs to a comment on the photo we just left, so
    // it must not survive the swipe (its Delete would run against the new
    // photo's id with the old comment id).
    setConfirmDeleteId(null);
  }, [photo.id]);

  // Highlight the new comment briefly, then let it settle in with the rest.
  useEffect(() => {
    if (!postedCommentId) return;
    const timer = setTimeout(() => setPostedCommentId(null), COMMENT_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [postedCommentId]);

  // Single fetch path shared by load and prefetch: fetch, cache, return.
  const fetchComments = useCallback(async (photoId: string): Promise<Comment[]> => {
    const data = await api.photos.getComments(photoId);
    cache.current.set(photoId, data.comments);
    return data.comments;
  }, []);

  const loadComments = useCallback(
    async (photoId: string) => {
      setLoading(true);
      setLoadError(false);
      try {
        const fetched = await fetchComments(photoId);
        if (currentPhotoIdRef.current !== photoId) return;
        setComments(fetched);
      } catch (err) {
        if (currentPhotoIdRef.current !== photoId) return;
        console.error('Failed to load comments:', err);
        setLoadError(true);
      } finally {
        if (currentPhotoIdRef.current === photoId) setLoading(false);
      }
    },
    [fetchComments]
  );

  useEffect(() => {
    if (cache.current.has(photo.id)) return;
    loadComments(photo.id);
  }, [photo.id, loadComments]);

  const retryLoadComments = useCallback(() => {
    loadComments(photo.id);
  }, [loadComments, photo.id]);

  // Prefetch neighbours so swiping shows comments instantly.
  const prevId = prevPhoto?.id;
  const nextId = nextPhoto?.id;
  useEffect(() => {
    const prefetch = (photoId: string | undefined) => {
      if (!photoId || cache.current.has(photoId)) return;
      fetchComments(photoId).catch(() => {
        /* prefetch is best-effort */
      });
    };
    prefetch(prevId);
    prefetch(nextId);
  }, [prevId, nextId, fetchComments]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newComment.trim();
    if (!trimmed || submitting) return;

    if (trimmed.length > COMMENT_MAX_LENGTH) {
      setSubmitError(`Comment must be ${COMMENT_MAX_LENGTH} characters or less.`);
      return;
    }

    const photoId = photo.id;
    const base = comments;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.photos.addComment(photoId, trimmed);
      const created: Comment = {
        id: result.id,
        userId: user?.id ?? null,
        authorName: user?.name ?? 'You',
        authorProfileColor: user?.profileColor ?? null,
        content: trimmed,
        createdAt: Math.floor(Date.now() / 1000),
        isDeleted: false,
      };
      const updated = [created, ...base];
      cache.current.set(photoId, updated);
      // A delta against the feed's live copy, not against the count this
      // submit captured when it started: a delete for the same photo is
      // guarded separately (deletingId, not submitting) and can settle in
      // between, and pushing a plain value would overwrite its result.
      onPhotoUpdate(photoId, (live) => ({ commentCount: live.commentCount + 1 }));
      if (currentPhotoIdRef.current === photoId) {
        setComments(updated);
        setNewComment('');
        setPostedCommentId(created.id);
      }
    } catch (err) {
      console.error('Failed to add comment:', err);
      const message =
        err instanceof ApiError && err.message
          ? err.message
          : 'Failed to post comment. Please try again.';
      if (currentPhotoIdRef.current === photoId) setSubmitError(message);
    } finally {
      if (currentPhotoIdRef.current === photoId) setSubmitting(false);
    }
  };

  const requestDeleteComment = (commentId: string) => {
    setConfirmDeleteId(commentId);
    setDeleteError(null);
  };

  const cancelDeleteComment = () => {
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const confirmDeleteComment = async () => {
    if (!confirmDeleteId) return;

    const photoId = photo.id;
    const commentId = confirmDeleteId;
    const base = comments;
    setDeletingId(commentId);
    setDeleteError(null);
    try {
      await api.photos.deleteComment(photoId, commentId);
      // Keep the row as a tombstone so the thread still reads correctly.
      const updated = base.map((c) =>
        c.id === commentId ? { ...c, isDeleted: true, content: '[deleted]', userId: null } : c
      );
      cache.current.set(photoId, updated);
      // Tombstones aren't counted — drop the authoritative non-deleted count.
      // As a delta against the feed's live copy, for the same reason as the
      // increment in submitComment: a post can be in flight alongside this.
      onPhotoUpdate(photoId, (live) => ({ commentCount: live.commentCount - 1 }));
      if (currentPhotoIdRef.current === photoId) {
        setComments(updated);
        setConfirmDeleteId(null);
      }
    } catch (err) {
      console.error('Failed to delete comment:', err);
      if (currentPhotoIdRef.current === photoId) setDeleteError('Failed to delete comment');
    } finally {
      if (currentPhotoIdRef.current === photoId) setDeletingId(null);
    }
  };

  return {
    comments,
    loadingComments: loading,
    commentsLoadError: loadError,
    retryLoadComments,
    newComment,
    setNewComment,
    submittingComment: submitting,
    commentError: submitError,
    submitComment,
    postedCommentId,
    deletingCommentId: deletingId,
    confirmDeleteCommentId: confirmDeleteId,
    deleteCommentError: deleteError,
    requestDeleteComment,
    confirmDeleteComment,
    cancelDeleteComment,
  };
}
