import type { ActivityEvent } from '@photodrop/common/apiTypes';

/**
 * One rendered inbox row, coalesced from one or more raw events so a burst of
 * activity reads as a sentence rather than a wall of near-duplicates.
 */
export interface ActivityRow {
  key: string;
  /** Newest constituent event's timestamp. */
  at: number;
  /** True when any constituent event is newer than the given seenAt. */
  unread: boolean;
  label: string;
  /** Deep-link target photo, when the row is about one. */
  photoId?: string;
  /** Deep-link should open the comment panel. */
  openComments?: boolean;
}

// Photos by the same uploader closer together than this read as one batch.
const PHOTO_BURST_GAP_SECONDS = 30 * 60;

const roleLabel = (role: string) => (role === 'admin' ? 'an admin' : 'a member');

/**
 * Collapses raw activity events (newest first) into display rows:
 * consecutive photo uploads by the same person become one "added N photos"
 * row, reactions coalesce per photo, comments and membership events stand
 * alone. Rows come back newest first.
 */
export function coalesceActivity(events: ActivityEvent[], seenAt: number): ActivityRow[] {
  const rows: ActivityRow[] = [];

  // Reactions grouped per photo across the whole window.
  const reactionsByPhoto = new Map<string, Extract<ActivityEvent, { type: 'reaction' }>[]>();

  // Photo bursts: consecutive uploads per actor. Events arrive newest first,
  // so a burst is built up while successive photo events from the same actor
  // stay within the gap.
  let openBurst: { events: Extract<ActivityEvent, { type: 'photo' }>[] } | null = null;

  const flushBurst = () => {
    if (!openBurst) return;
    const burst = openBurst.events;
    const newest = burst[0];
    rows.push({
      key: `photo:${newest.photoId}`,
      at: newest.at,
      unread: burst.some((e) => e.at > seenAt),
      label:
        burst.length === 1
          ? `${newest.actorName} added a photo`
          : `${newest.actorName} added ${burst.length} photos`,
      photoId: newest.photoId,
    });
    openBurst = null;
  };

  for (const event of events) {
    if (event.type !== 'photo') {
      // A non-photo event does not break a photo burst — bursts are about
      // upload cadence, and someone else reacting mid-batch is unrelated.
      if (event.type === 'reaction') {
        const list = reactionsByPhoto.get(event.photoId) ?? [];
        list.push(event);
        reactionsByPhoto.set(event.photoId, list);
        continue;
      }

      if (event.type === 'comment' || event.type === 'reply') {
        rows.push({
          key: `comment:${event.commentId}`,
          at: event.at,
          unread: event.at > seenAt,
          label:
            event.type === 'comment'
              ? `${event.actorName} commented: “${event.preview}”`
              : `${event.actorName} replied: “${event.preview}”`,
          photoId: event.photoId,
          openComments: true,
        });
        continue;
      }

      if (event.type === 'join') {
        rows.push({
          key: `join:${event.actorId}:${event.at}`,
          at: event.at,
          unread: event.at > seenAt,
          label: `${event.actorName} joined the group`,
        });
        continue;
      }

      rows.push({
        key: `role:${event.actorId}:${event.at}`,
        at: event.at,
        unread: event.at > seenAt,
        label: event.self
          ? `You're now ${roleLabel(event.role)}`
          : `${event.actorName} is now ${roleLabel(event.role)}`,
      });
      continue;
    }

    if (
      openBurst &&
      openBurst.events[0].actorId === event.actorId &&
      openBurst.events[openBurst.events.length - 1].at - event.at <= PHOTO_BURST_GAP_SECONDS
    ) {
      openBurst.events.push(event);
    } else {
      flushBurst();
      openBurst = { events: [event] };
    }
  }
  flushBurst();

  for (const [photoId, reactions] of reactionsByPhoto) {
    const newest = reactions[0];
    const distinctActors = [...new Set(reactions.map((r) => r.actorName))];
    const distinctEmoji = [...new Set(reactions.map((r) => r.emoji))].join('');
    rows.push({
      key: `reactions:${photoId}`,
      at: newest.at,
      unread: reactions.some((r) => r.at > seenAt),
      label:
        distinctActors.length === 1
          ? `${distinctActors[0]} reacted ${distinctEmoji} to your photo`
          : `${distinctActors[0]} and ${distinctActors.length - 1} other${
              distinctActors.length > 2 ? 's' : ''
            } reacted ${distinctEmoji} to your photo`,
      photoId,
    });
  }

  return rows.sort((a, b) => b.at - a.at);
}
