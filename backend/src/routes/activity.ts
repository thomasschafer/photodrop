import { Hono } from 'hono';
import type { ActivityEvent, ActivityResponse, ActivitySeenResponse } from '@photodrop/common/apiTypes';
import { requireAuth } from '../middleware/auth';
import {
  getGroupActivity,
  getActivitySeenAt,
  setActivitySeenAt,
  FORMER_MEMBER_NAME,
} from '../lib/db';
import type { AppEnv } from '../types';

// How far back the inbox reaches. Derivable history, not an event log — old
// activity ages out of relevance long before it ages out of the tables.
const ACTIVITY_WINDOW_SECONDS = 30 * 24 * 60 * 60;

// Longest comment excerpt the inbox shows.
const PREVIEW_MAX_LENGTH = 120;

// Code-point-aware so an emoji straddling the boundary is dropped whole
// rather than split into a broken surrogate half.
function truncatePreview(text: string): string {
  const points = Array.from(text);
  return points.length > PREVIEW_MAX_LENGTH
    ? `${points.slice(0, PREVIEW_MAX_LENGTH).join('')}…`
    : text;
}

const activity = new Hono<AppEnv>();

activity.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const cutoff = Math.floor(Date.now() / 1000) - ACTIVITY_WINDOW_SECONDS;

  const [dbEvents, seenAt] = await Promise.all([
    getGroupActivity(c.env.DB, user.groupId, user.id, cutoff, user.role === 'admin'),
    getActivitySeenAt(c.env.DB, user.id, user.groupId),
  ]);

  const events: ActivityEvent[] = dbEvents.map((event) => {
    const base = {
      at: event.at,
      actorId: event.actorId,
      actorName: event.actorName ?? FORMER_MEMBER_NAME,
    };
    switch (event.type) {
      case 'photo':
        return { ...base, type: 'photo', photoId: event.photoId, caption: event.caption };
      case 'reaction':
        return { ...base, type: 'reaction', photoId: event.photoId, emoji: event.emoji };
      case 'comment':
      case 'reply':
        return {
          ...base,
          type: event.type,
          photoId: event.photoId,
          commentId: event.commentId,
          preview: truncatePreview(event.preview),
        };
      case 'join':
        return { ...base, type: 'join' };
      case 'role':
        return { ...base, type: 'role', role: event.role, self: event.actorId === user.id };
    }
  });

  return c.json({ events, seenAt } satisfies ActivityResponse);
});

activity.post('/seen', requireAuth, async (c) => {
  const user = c.get('user');
  const seenAt = Math.floor(Date.now() / 1000);
  await setActivitySeenAt(c.env.DB, user.id, user.groupId, seenAt);
  return c.json({ seenAt } satisfies ActivitySeenResponse);
});

export default activity;
