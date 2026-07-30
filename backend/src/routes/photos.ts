import { Hono } from 'hono';
import type { Context } from 'hono';
import type { PhotoCursor } from '../lib/db';
import {
  createPhoto,
  getPhoto,
  listPhotosWithCounts,
  deletePhoto as dbDeletePhoto,
  recordPhotoView,
  getPhotoViewers,
  addPhotoReaction,
  removePhotoReaction,
  getPhotoReactionsWithUsers,
  getGroupPushSubscriptions,
  getGroupDeviceTokens,
  getResolvedMemberName,
  createComment,
  getCommentsByPhotoId,
  getComment,
  deleteComment as dbDeleteComment,
  getMembership,
  type Photo,
} from '../lib/db';
import { generateId } from '../lib/crypto';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { configureVapid, sendPushNotifications } from '../lib/push';
import { configureFcm, isFcmConfigured, sendFcmNotifications } from '../lib/fcm';
import {
  validateImageMagicBytes,
  MAX_PHOTO_SIZE,
  MAX_THUMBNAIL_SIZE,
  ALLOWED_MIME_TYPES,
} from '../lib/fileValidation';
import { createRateLimitMiddleware, rateLimitKeys } from '../middleware/rateLimit';
import { addReactionSchema, addCommentSchema } from '../lib/schemas';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  HttpError,
  requireParam,
  parseJsonBody,
} from '../lib/http';
import { CAPTION_MAX_LENGTH } from '@photodrop/common/limits';
import type {
  PhotoListResponse,
  PhotoUploadResponse,
  PhotoDetailResponse,
  PhotoViewersResponse,
  ReactionMutationResponse,
  ReactionsResponse,
  CommentsResponse,
  CommentCreatedResponse,
} from '@photodrop/common/apiTypes';
import type { Bindings, AppEnv } from '../types';

// Rate limit for comments: 100 per user per 15 minutes
const commentRateLimit = createRateLimitMiddleware({
  maxRequests: 100,
  windowSeconds: 15 * 60,
  keyFn: rateLimitKeys.byUserId('comment'),
});

// Rate limit for photo uploads: 20 per user per hour
const uploadRateLimit = createRateLimitMiddleware({
  maxRequests: 20,
  windowSeconds: 60 * 60, // 1 hour
  keyFn: rateLimitKeys.byUserId('upload'),
});

const photos = new Hono<AppEnv>();

// Load the photo from the `:id` route param, scoped to the requesting user's
// group (which also enforces group isolation), or fail with a 404.
async function requirePhoto(c: Context<AppEnv>): Promise<Photo> {
  const photoId = requireParam(c.req.param('id'), 'id');
  const photo = await getPhoto(c.env.DB, photoId, c.get('user').groupId);

  if (!photo) {
    throw new NotFoundError('Photo not found');
  }

  return photo;
}

// Send push notifications in background (non-blocking)
async function sendPhotoUploadNotifications(
  env: Bindings,
  groupId: string,
  uploaderId: string,
  photoId: string,
  caption: string | null
): Promise<void> {
  // The notification is about this group, so the uploader's name in this group
  // is the one to use — not their canonical name. Guarded like the two send
  // blocks below: this runs in waitUntil, where an unguarded rejection would
  // take down both notification channels (and surface as an unhandled
  // rejection) over nothing more than a missing name.
  let uploaderName: string | null = null;
  try {
    uploaderName = await getResolvedMemberName(env.DB, uploaderId, groupId);
  } catch (nameError) {
    console.error('Failed to resolve the uploader name for notifications:', nameError);
  }

  // Use just the first name to keep the notification short and friendly.
  const uploaderFirstName = uploaderName?.trim().split(/\s+/)[0] || 'Someone';
  const title = `New photo`;
  // Sanitize caption to prevent injection in push notifications
  // Push payloads are plain text (not rendered as HTML), so just truncate
  const sanitizedCaption = caption ? `"${Array.from(caption).slice(0, 200).join('')}"` : null;
  const body = `${uploaderFirstName} added ${sanitizedCaption || 'a new photo'}`;

  // Send web push notifications
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
      configureVapid(
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
        `mailto:noreply@${new URL(env.FRONTEND_URL || 'http://localhost').hostname}`
      );

      const subscriptions = await getGroupPushSubscriptions(env.DB, groupId, uploaderId);

      if (subscriptions.length > 0) {
        await sendPushNotifications(
          subscriptions,
          {
            title,
            body,
            data: {
              url: `${env.FRONTEND_URL || ''}/photo/${photoId}`,
              groupId,
              photoId,
            },
          },
          env.DB
        );
      }
    } catch (pushError) {
      console.error('Failed to send web push notifications:', pushError);
    }
  }

  // Send FCM notifications to native apps
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      if (!isFcmConfigured()) {
        configureFcm(env.FIREBASE_SERVICE_ACCOUNT);
      }

      const deviceTokens = await getGroupDeviceTokens(env.DB, groupId, uploaderId);

      if (deviceTokens.length > 0) {
        await sendFcmNotifications(
          deviceTokens,
          {
            title,
            body,
            data: {
              url: `${env.FRONTEND_URL || ''}/photo/${photoId}`,
              groupId,
              photoId,
            },
          },
          env.DB
        );
      }
    } catch (fcmError) {
      console.error('Failed to send FCM notifications:', fcmError);
    }
  }
}

/**
 * Wire format for the keyset cursor: "<uploadedAt>_<photoId>", split at the
 * first underscore (photo ids can contain underscores in principle; the
 * timestamp cannot). Opaque to clients — they pass `nextCursor` back verbatim.
 */
function encodePhotoCursor(photo: { uploaded_at: number; id: string }): string {
  return `${photo.uploaded_at}_${photo.id}`;
}

function parsePhotoCursor(raw: string): PhotoCursor {
  const sep = raw.indexOf('_');
  const uploadedAt = sep > 0 ? Number(raw.slice(0, sep)) : NaN;
  const id = sep > 0 ? raw.slice(sep + 1) : '';
  if (!Number.isInteger(uploadedAt) || id.length === 0) {
    throw new BadRequestError('Invalid cursor');
  }
  return { uploadedAt, id };
}

photos.get('/', requireAuth, async (c) => {
  // Clamp limit to 1-100, offset to >= 0
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const cursorParam = c.req.query('cursor');
  const cursor = cursorParam !== undefined ? parsePhotoCursor(cursorParam) : null;
  const user = c.get('user');

  // Fetch one extra to determine if there are more photos
  const photoList = await listPhotosWithCounts(
    c.env.DB,
    user.groupId,
    user.id,
    limit + 1,
    cursor,
    offset
  );
  const hasMore = photoList.length > limit;
  const photosToReturn = hasMore ? photoList.slice(0, limit) : photoList;
  const lastPhoto = photosToReturn[photosToReturn.length - 1];

  return c.json({
    photos: photosToReturn.map((photo) => ({
      id: photo.id,
      caption: photo.caption,
      uploadedBy: photo.uploaded_by,
      uploaderName: photo.uploader_name,
      uploaderProfileColor: photo.uploader_profile_color,
      uploadedAt: photo.uploaded_at,
      commentCount: photo.comment_count,
      reactions: photo.reactions,
      userReactions: photo.user_reactions,
    })),
    limit,
    offset,
    hasMore,
    nextCursor: hasMore && lastPhoto ? encodePhotoCursor(lastPhoto) : null,
  } satisfies PhotoListResponse);
});

function photoUploadedResponse(c: Context<AppEnv>, photoId: string) {
  return c.json(
    {
      id: photoId,
      message: 'Photo uploaded successfully',
    } satisfies PhotoUploadResponse,
    201
  );
}

photos.post('/', requireAdmin, uploadRateLimit, async (c) => {
  let photoR2Key: string | null = null;
  let thumbnailR2Key: string | null = null;
  // Set once the photo row exists; from that point the R2 objects it points at
  // must be kept, whatever else fails.
  let committedPhotoId: string | null = null;

  try {
    const formData = await c.req.formData();
    const photo = formData.get('photo') as File | null;
    const thumbnail = formData.get('thumbnail') as File | null;
    const caption = formData.get('caption') as string | null;

    // Validate caption length
    if (caption && Array.from(caption).length > CAPTION_MAX_LENGTH) {
      throw new BadRequestError(`Caption must be ${CAPTION_MAX_LENGTH} characters or less`);
    }

    if (!photo) {
      return c.json({ error: 'Photo file is required' }, 400);
    }

    if (!thumbnail) {
      return c.json({ error: 'Thumbnail file is required' }, 400);
    }

    // Validate file sizes before reading into memory
    if (photo.size > MAX_PHOTO_SIZE) {
      return c.json({ error: 'Photo exceeds maximum size of 20MB' }, 400);
    }

    if (thumbnail.size > MAX_THUMBNAIL_SIZE) {
      return c.json({ error: 'Thumbnail exceeds maximum size of 1MB' }, 400);
    }

    // Validate MIME types
    if (!ALLOWED_MIME_TYPES.includes(photo.type)) {
      return c.json({ error: 'Invalid photo file type. Allowed: JPEG, PNG, WebP, HEIC' }, 400);
    }

    if (!ALLOWED_MIME_TYPES.includes(thumbnail.type)) {
      return c.json({ error: 'Invalid thumbnail file type. Allowed: JPEG, PNG, WebP, HEIC' }, 400);
    }

    // Read files into memory
    const photoBuffer = await photo.arrayBuffer();
    const thumbnailBuffer = await thumbnail.arrayBuffer();

    // Validate magic bytes to ensure file content matches claimed type
    const photoMagicType = validateImageMagicBytes(photoBuffer);
    if (!photoMagicType) {
      return c.json({ error: 'Photo file content is not a valid image' }, 400);
    }

    const thumbnailMagicType = validateImageMagicBytes(thumbnailBuffer);
    if (!thumbnailMagicType) {
      return c.json({ error: 'Thumbnail file content is not a valid image' }, 400);
    }

    const currentUser = c.get('user');

    // Determine file extension from validated magic type
    const getExtension = (mimeType: string): string => {
      switch (mimeType) {
        case 'image/png':
          return 'png';
        case 'image/webp':
          return 'webp';
        case 'image/heic':
          return 'heic';
        default:
          return 'jpg';
      }
    };
    const photoExt = getExtension(photoMagicType);
    const thumbExt = getExtension(thumbnailMagicType);

    photoR2Key = `photos/${generateId()}-${Date.now()}.${photoExt}`;
    thumbnailR2Key = `thumbnails/${generateId()}-${Date.now()}.${thumbExt}`;

    // Upload photo and thumbnail to R2 in parallel. Use allSettled rather than
    // Promise.all so both writes are guaranteed to have finished before we act
    // on a failure: with Promise.all, a rejection would enter the catch block
    // and delete both keys while the other put is still in flight, and that
    // write could then land after the delete and orphan an object.
    const [photoUpload, thumbnailUpload] = await Promise.allSettled([
      c.env.PHOTOS.put(photoR2Key, photoBuffer, {
        httpMetadata: {
          contentType: photoMagicType,
        },
      }),
      c.env.PHOTOS.put(thumbnailR2Key, thumbnailBuffer, {
        httpMetadata: {
          contentType: thumbnailMagicType,
        },
      }),
    ]);

    if (photoUpload.status === 'rejected') throw photoUpload.reason;
    if (thumbnailUpload.status === 'rejected') throw thumbnailUpload.reason;

    // Create DB entry - if this fails, we'll clean up R2 in catch block
    const photoId = await createPhoto(
      c.env.DB,
      currentUser.groupId,
      photoR2Key,
      thumbnailR2Key,
      currentUser.id,
      caption || undefined
    );
    committedPhotoId = photoId;

    // Send push notifications in background (non-blocking)
    c.executionCtx.waitUntil(
      sendPhotoUploadNotifications(c.env, currentUser.groupId, currentUser.id, photoId, caption)
    );

    return photoUploadedResponse(c, photoId);
  } catch (error) {
    // Validation is expressed as thrown HttpErrors, which carry their own
    // status; nothing has been written to R2 by the time they are raised.
    if (error instanceof HttpError) {
      throw error;
    }

    if (committedPhotoId) {
      // The row is committed, so the upload itself succeeded — only the
      // best-effort work after it (scheduling notifications, which needs an
      // execution context) failed. Deleting the R2 objects here would leave a
      // photo whose download and thumbnail 404 forever, so keep them and report
      // the upload for what it is.
      console.error('Photo upload succeeded but post-commit work failed:', error);
      return photoUploadedResponse(c, committedPhotoId);
    }

    console.error('Error uploading photo:', error);

    // Clean up any R2 files that were uploaded before the failure
    try {
      if (photoR2Key) {
        await c.env.PHOTOS.delete(photoR2Key);
      }
      if (thumbnailR2Key) {
        await c.env.PHOTOS.delete(thumbnailR2Key);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up R2 files:', cleanupError);
    }

    return c.json({ error: 'Failed to upload photo' }, 500);
  }
});

photos.get('/:id', requireAuth, async (c) => {
  const photo = await requirePhoto(c);

  return c.json({
    id: photo.id,
    caption: photo.caption,
    uploadedBy: photo.uploaded_by,
    uploadedAt: photo.uploaded_at,
  } satisfies PhotoDetailResponse);
});

photos.get('/:id/download', requireAuth, async (c) => {
  const photo = await requirePhoto(c);

  const object = await c.env.PHOTOS.get(photo.r2_key);
  if (!object) {
    throw new NotFoundError('Photo file not found in storage');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      // Private image: no-store keeps it out of all shared/browser/CDN HTTP
      // caches, and we vary by the auth header. Deliberate per-browser caching
      // is left to the service worker (CacheFirst + ignoreVary, purged on
      // logout/group switch) — but only when the request is same-origin with
      // the controlled page (dev via the Vite /api proxy, or a same-origin
      // deploy). The default production build points at a separate API
      // subdomain, so those cross-origin requests bypass the SW caches and are
      // refetched on cold loads. See frontend/src/sw.ts.
      'Cache-Control': 'no-store',
      Vary: 'Authorization',
    },
  });
});

photos.get('/:id/thumbnail', requireAuth, async (c) => {
  const photo = await requirePhoto(c);
  if (!photo.thumbnail_r2_key) {
    throw new NotFoundError('Photo or thumbnail not found');
  }

  const object = await c.env.PHOTOS.get(photo.thumbnail_r2_key);
  if (!object) {
    throw new NotFoundError('Thumbnail file not found in storage');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
      // Private image, no shared/browser/CDN HTTP caching; same-origin-only
      // service-worker caching. See the download route above for the full
      // rationale and the cross-origin production caveat.
      'Cache-Control': 'no-store',
      Vary: 'Authorization',
    },
  });
});

photos.delete('/:id', requireAdmin, async (c) => {
  const photo = await requirePhoto(c);

  // Delete DB record first, then R2 files. If R2 cleanup fails,
  // we have orphaned files (harmless) rather than DB rows pointing to missing files.
  await dbDeletePhoto(c.env.DB, photo.id, c.get('user').groupId);

  try {
    await c.env.PHOTOS.delete(photo.r2_key);
    if (photo.thumbnail_r2_key) {
      await c.env.PHOTOS.delete(photo.thumbnail_r2_key);
    }
  } catch (r2Error) {
    console.error('Failed to clean up R2 files after photo deletion:', r2Error);
    // DB record already deleted, R2 orphans are harmless
  }

  return c.json({ message: 'Photo deleted successfully' });
});

photos.post('/:id/view', requireAuth, async (c) => {
  const photo = await requirePhoto(c);

  await recordPhotoView(c.env.DB, photo.id, c.get('user').id);

  return c.json({ message: 'View recorded' });
});

photos.get('/:id/viewers', requireAdmin, async (c) => {
  const photo = await requirePhoto(c);

  const viewers = await getPhotoViewers(c.env.DB, photo.id);

  return c.json({ viewers } satisfies PhotoViewersResponse);
});

photos.post('/:id/react', requireAuth, async (c) => {
  const { emoji } = await parseJsonBody(c, addReactionSchema);
  const photo = await requirePhoto(c);

  await addPhotoReaction(c.env.DB, photo.id, c.get('user').id, emoji);

  return c.json({ message: 'Reaction added', emoji } satisfies ReactionMutationResponse);
});

photos.delete('/:id/react', requireAuth, async (c) => {
  const { emoji } = await parseJsonBody(c, addReactionSchema);
  const photo = await requirePhoto(c);

  await removePhotoReaction(c.env.DB, photo.id, c.get('user').id, emoji);

  return c.json({ message: 'Reaction removed', emoji } satisfies ReactionMutationResponse);
});

photos.get('/:id/reactions', requireAuth, async (c) => {
  const photo = await requirePhoto(c);

  const reactions = await getPhotoReactionsWithUsers(c.env.DB, photo.id);

  return c.json({
    reactions: reactions.map((r) => ({
      emoji: r.emoji,
      userId: r.user_id,
      userName: r.user_name,
      profileColor: r.user_profile_color,
      createdAt: r.created_at,
    })),
  } satisfies ReactionsResponse);
});

// Comment endpoints
photos.get('/:id/comments', requireAuth, async (c) => {
  const photo = await requirePhoto(c);

  const comments = await getCommentsByPhotoId(c.env.DB, photo.id);

  return c.json({
    comments: comments.map((comment) => {
      const isDeleted = comment.deleted_at !== null;
      // Soft-deleting a comment nulls its user_id too, so a null user_id only
      // means "the author's account is gone" for a comment that is still live.
      // Checking deleted_at first keeps the two states distinguishable.
      //
      // For a live author, user_name is the name their membership resolves to
      // now, and null once that membership is gone — at which point the stored
      // author_name takes over. That snapshot is the name this group saw when
      // the comment was written, so it is what a removed member's display-name
      // override keeps standing behind after they leave.
      const authorName = isDeleted
        ? comment.author_name
        : comment.user_id === null
          ? 'Deleted user'
          : (comment.user_name ?? comment.author_name);

      return {
        id: comment.id,
        userId: comment.user_id,
        authorName,
        authorProfileColor: comment.author_profile_color,
        content: comment.content,
        createdAt: comment.created_at,
        isDeleted,
      };
    }),
  } satisfies CommentsResponse);
});

photos.post('/:id/comments', requireAuth, commentRateLimit, async (c) => {
  const { content } = await parseJsonBody(c, addCommentSchema);
  const photo = await requirePhoto(c);
  const currentUser = c.get('user');

  // The stored author_name is the fallback shown once the account is gone, so
  // it has to be the name this group sees — snapshotting the canonical name
  // would make old comments disagree with the member list.
  const authorName = await getResolvedMemberName(c.env.DB, currentUser.id, currentUser.groupId);
  if (authorName === null) {
    throw new NotFoundError('User not found');
  }

  const commentId = await createComment(c.env.DB, photo.id, currentUser.id, authorName, content);

  return c.json(
    {
      id: commentId,
      message: 'Comment added',
    } satisfies CommentCreatedResponse,
    201
  );
});

photos.delete('/:id/comments/:commentId', requireAuth, async (c) => {
  const photo = await requirePhoto(c);
  const commentId = requireParam(c.req.param('commentId'), 'commentId');
  const currentUser = c.get('user');

  const comment = await getComment(c.env.DB, commentId);
  if (!comment || comment.deleted_at !== null) {
    throw new NotFoundError('Comment not found');
  }

  if (comment.photo_id !== photo.id) {
    throw new BadRequestError('Comment does not belong to this photo');
  }

  // Allow deletion if user is the author
  const isAuthor = comment.user_id === currentUser.id;

  if (!isAuthor) {
    // Check actual admin role from database (not JWT) to prevent stale role exploitation
    const membership = await getMembership(c.env.DB, currentUser.id, currentUser.groupId);
    const isAdmin = membership?.role === 'admin';
    if (!isAdmin) {
      throw new ForbiddenError('Not authorized to delete this comment');
    }
  }

  await dbDeleteComment(c.env.DB, commentId);

  return c.json({ message: 'Comment deleted' });
});

export default photos;
