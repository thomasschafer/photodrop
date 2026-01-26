import { Hono } from 'hono';
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
  getGroup,
  getUserById,
  createComment,
  getCommentsByPhotoId,
  getComment,
  deleteComment as dbDeleteComment,
  type MembershipRole,
} from '../lib/db';
import { generateId } from '../lib/crypto';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { configureVapid, sendPushNotifications } from '../lib/push';

type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  FRONTEND_URL: string;
};

type Variables = {
  user: {
    id: string;
    groupId: string;
    role: MembershipRole;
  };
};

const photos = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Send push notifications in background (non-blocking)
async function sendPhotoUploadNotifications(
  env: Bindings,
  groupId: string,
  uploaderId: string,
  photoId: string,
  caption: string | null
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('VAPID keys not configured, skipping notifications');
    return;
  }

  try {
    configureVapid(
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
      `mailto:noreply@${new URL(env.FRONTEND_URL || 'http://localhost').hostname}`
    );

    const subscriptions = await getGroupPushSubscriptions(env.DB, groupId, uploaderId);

    if (subscriptions.length === 0) return;

    const [group, uploader] = await Promise.all([
      getGroup(env.DB, groupId),
      getUserById(env.DB, uploaderId),
    ]);

    const groupName = group?.name || 'your group';
    const uploaderName = uploader?.name || 'Someone';

    await sendPushNotifications(
      subscriptions,
      {
        title: `New photo in ${groupName}`,
        body: caption || `${uploaderName} shared a new photo`,
        data: {
          url: `${env.FRONTEND_URL || ''}/photo/${photoId}`,
          groupId,
          photoId,
        },
      },
      env.DB
    );
  } catch (pushError) {
    console.error('Failed to send push notifications:', pushError);
  }
}

photos.get('/', requireAuth, async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');
    const user = c.get('user');

    // Fetch one extra to determine if there are more photos
    const photoList = await listPhotosWithCounts(
      c.env.DB,
      user.groupId,
      user.id,
      limit + 1,
      offset
    );
    const hasMore = photoList.length > limit;
    const photosToReturn = hasMore ? photoList.slice(0, limit) : photoList;

    return c.json({
      photos: photosToReturn.map((photo) => ({
        id: photo.id,
        caption: photo.caption,
        uploadedBy: photo.uploaded_by,
        uploadedAt: photo.uploaded_at,
        reactionCount: photo.reaction_count,
        commentCount: photo.comment_count,
        reactions: photo.reactions,
        userReaction: photo.user_reaction,
      })),
      limit,
      offset,
      hasMore,
    });
  } catch (error) {
    console.error('Error listing photos:', error);
    return c.json({ error: 'Failed to list photos' }, 500);
  }
});

photos.post('/', requireAdmin, async (c) => {
  let photoR2Key: string | null = null;
  let thumbnailR2Key: string | null = null;

  try {
    const formData = await c.req.formData();
    const photo = formData.get('photo') as File | null;
    const thumbnail = formData.get('thumbnail') as File | null;
    const caption = formData.get('caption') as string | null;

    if (!photo) {
      return c.json({ error: 'Photo file is required' }, 400);
    }

    if (!thumbnail) {
      return c.json({ error: 'Thumbnail file is required' }, 400);
    }

    const currentUser = c.get('user');

    photoR2Key = `photos/${generateId()}-${Date.now()}.jpg`;
    thumbnailR2Key = `thumbnails/${generateId()}-${Date.now()}.jpg`;

    // Upload photo to R2
    const photoBuffer = await photo.arrayBuffer();
    await c.env.PHOTOS.put(photoR2Key, photoBuffer, {
      httpMetadata: {
        contentType: photo.type || 'image/jpeg',
      },
    });

    // Upload thumbnail to R2
    const thumbnailBuffer = await thumbnail.arrayBuffer();
    await c.env.PHOTOS.put(thumbnailR2Key, thumbnailBuffer, {
      httpMetadata: {
        contentType: thumbnail.type || 'image/jpeg',
      },
    });

    // Create DB entry - if this fails, we'll clean up R2 in catch block
    const photoId = await createPhoto(
      c.env.DB,
      currentUser.groupId,
      photoR2Key,
      thumbnailR2Key,
      currentUser.id,
      caption || undefined
    );

    // Send push notifications in background (non-blocking)
    c.executionCtx.waitUntil(
      sendPhotoUploadNotifications(c.env, currentUser.groupId, currentUser.id, photoId, caption)
    );

    return c.json(
      {
        id: photoId,
        message: 'Photo uploaded successfully',
      },
      201
    );
  } catch (error) {
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
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');
    const photo = await getPhoto(c.env.DB, photoId, user.groupId);

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    return c.json({
      id: photo.id,
      caption: photo.caption,
      uploadedBy: photo.uploaded_by,
      uploadedAt: photo.uploaded_at,
    });
  } catch (error) {
    console.error('Error fetching photo:', error);
    return c.json({ error: 'Failed to fetch photo' }, 500);
  }
});

photos.get('/:id/url', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');
    const photo = await getPhoto(c.env.DB, photoId, user.groupId);

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const object = await c.env.PHOTOS.get(photo.r2_key);
    if (!object) {
      return c.json({ error: 'Photo file not found in storage' }, 404);
    }

    const url = new URL(c.req.url);
    const signedUrl = `${url.origin}/photos/${photoId}/download`;

    return c.json({
      url: signedUrl,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Error generating photo URL:', error);
    return c.json({ error: 'Failed to generate photo URL' }, 500);
  }
});

photos.get('/:id/download', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');
    const photo = await getPhoto(c.env.DB, photoId, user.groupId);

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const object = await c.env.PHOTOS.get(photo.r2_key);
    if (!object) {
      return c.json({ error: 'Photo file not found in storage' }, 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error downloading photo:', error);
    return c.json({ error: 'Failed to download photo' }, 500);
  }
});

photos.get('/:id/thumbnail-url', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');
    const photo = await getPhoto(c.env.DB, photoId, user.groupId);

    if (!photo || !photo.thumbnail_r2_key) {
      return c.json({ error: 'Photo or thumbnail not found' }, 404);
    }

    const url = new URL(c.req.url);
    const signedUrl = `${url.origin}/photos/${photoId}/thumbnail`;

    return c.json({
      url: signedUrl,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Error generating thumbnail URL:', error);
    return c.json({ error: 'Failed to generate thumbnail URL' }, 500);
  }
});

photos.get('/:id/thumbnail', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');
    const photo = await getPhoto(c.env.DB, photoId, user.groupId);

    if (!photo || !photo.thumbnail_r2_key) {
      return c.json({ error: 'Photo or thumbnail not found' }, 404);
    }

    const object = await c.env.PHOTOS.get(photo.thumbnail_r2_key);
    if (!object) {
      return c.json({ error: 'Thumbnail file not found in storage' }, 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error downloading thumbnail:', error);
    return c.json({ error: 'Failed to download thumbnail' }, 500);
  }
});

photos.delete('/:id', requireAdmin, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');
    const photo = await getPhoto(c.env.DB, photoId, user.groupId);

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    await c.env.PHOTOS.delete(photo.r2_key);
    if (photo.thumbnail_r2_key) {
      await c.env.PHOTOS.delete(photo.thumbnail_r2_key);
    }

    await dbDeletePhoto(c.env.DB, photoId, user.groupId);

    return c.json({ message: 'Photo deleted successfully' });
  } catch (error) {
    console.error('Error deleting photo:', error);
    return c.json({ error: 'Failed to delete photo' }, 500);
  }
});

photos.post('/:id/view', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const currentUser = c.get('user');

    const photo = await getPhoto(c.env.DB, photoId, currentUser.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    await recordPhotoView(c.env.DB, photoId, currentUser.id);

    return c.json({ message: 'View recorded' });
  } catch (error) {
    console.error('Error recording view:', error);
    return c.json({ error: 'Failed to record view' }, 500);
  }
});

photos.get('/:id/viewers', requireAdmin, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');

    const photo = await getPhoto(c.env.DB, photoId, user.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const viewers = await getPhotoViewers(c.env.DB, photoId);

    return c.json({ viewers });
  } catch (error) {
    console.error('Error fetching viewers:', error);
    return c.json({ error: 'Failed to fetch viewers' }, 500);
  }
});

const ALLOWED_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

photos.post('/:id/react', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const currentUser = c.get('user');
    const body = await c.req.json();
    const { emoji } = body;

    if (!emoji || typeof emoji !== 'string') {
      return c.json({ error: 'Emoji is required' }, 400);
    }

    if (!ALLOWED_EMOJIS.includes(emoji)) {
      return c.json({ error: 'Invalid emoji' }, 400);
    }

    const photo = await getPhoto(c.env.DB, photoId, currentUser.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    await addPhotoReaction(c.env.DB, photoId, currentUser.id, emoji);

    return c.json({ message: 'Reaction added' });
  } catch (error) {
    console.error('Error adding reaction:', error);
    return c.json({ error: 'Failed to add reaction' }, 500);
  }
});

photos.delete('/:id/react', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const currentUser = c.get('user');

    const photo = await getPhoto(c.env.DB, photoId, currentUser.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    await removePhotoReaction(c.env.DB, photoId, currentUser.id);

    return c.json({ message: 'Reaction removed' });
  } catch (error) {
    console.error('Error removing reaction:', error);
    return c.json({ error: 'Failed to remove reaction' }, 500);
  }
});

photos.get('/:id/reactions', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');

    const photo = await getPhoto(c.env.DB, photoId, user.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const reactions = await getPhotoReactionsWithUsers(c.env.DB, photoId);

    return c.json({
      reactions: reactions.map((r) => ({
        emoji: r.emoji,
        userId: r.user_id,
        userName: r.user_name,
        profileColor: r.user_profile_color,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching reactions:', error);
    return c.json({ error: 'Failed to fetch reactions' }, 500);
  }
});

// Comment endpoints
photos.get('/:id/comments', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const user = c.get('user');

    const photo = await getPhoto(c.env.DB, photoId, user.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const comments = await getCommentsByPhotoId(c.env.DB, photoId);

    return c.json({
      comments: comments.map((comment) => ({
        id: comment.id,
        userId: comment.user_id,
        authorName: comment.author_name,
        authorProfileColor: comment.author_profile_color,
        content: comment.content,
        createdAt: comment.created_at,
        isDeleted: comment.user_id === null,
      })),
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return c.json({ error: 'Failed to fetch comments' }, 500);
  }
});

photos.post('/:id/comments', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const currentUser = c.get('user');
    const body = await c.req.json();
    const { content } = body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return c.json({ error: 'Comment content is required' }, 400);
    }

    if (content.trim().length > 1000) {
      return c.json({ error: 'Comment is too long (max 1000 characters)' }, 400);
    }

    const photo = await getPhoto(c.env.DB, photoId, currentUser.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const user = await getUserById(c.env.DB, currentUser.id);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const commentId = await createComment(
      c.env.DB,
      photoId,
      currentUser.id,
      user.name,
      content.trim()
    );

    return c.json(
      {
        id: commentId,
        message: 'Comment added',
      },
      201
    );
  } catch (error) {
    console.error('Error adding comment:', error);
    return c.json({ error: 'Failed to add comment' }, 500);
  }
});

photos.delete('/:id/comments/:commentId', requireAuth, async (c) => {
  try {
    const photoId = c.req.param('id');
    const commentId = c.req.param('commentId');
    const currentUser = c.get('user');

    const photo = await getPhoto(c.env.DB, photoId, currentUser.groupId);
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const comment = await getComment(c.env.DB, commentId);
    if (!comment) {
      return c.json({ error: 'Comment not found' }, 404);
    }

    if (comment.photo_id !== photoId) {
      return c.json({ error: 'Comment does not belong to this photo' }, 400);
    }

    // Allow deletion if user is the author or an admin
    const isAuthor = comment.user_id === currentUser.id;
    const isAdmin = currentUser.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return c.json({ error: 'Not authorized to delete this comment' }, 403);
    }

    await dbDeleteComment(c.env.DB, commentId);

    return c.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    return c.json({ error: 'Failed to delete comment' }, 500);
  }
});

export default photos;
