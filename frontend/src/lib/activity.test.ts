import { describe, it, expect } from 'vitest';
import { coalesceActivity } from './activity';
import type { ActivityEvent } from '@photodrop/common/apiTypes';

const photo = (at: number, actor: string, photoId: string): ActivityEvent => ({
  type: 'photo',
  at,
  actorId: actor.toLowerCase(),
  actorName: actor,
  photoId,
  caption: null,
});

const reaction = (at: number, actor: string, photoId: string, emoji: string): ActivityEvent => ({
  type: 'reaction',
  at,
  actorId: actor.toLowerCase(),
  actorName: actor,
  photoId,
  emoji,
});

describe('coalesceActivity', () => {
  it('collapses a same-actor upload burst into one row', () => {
    const rows = coalesceActivity(
      [photo(1000, 'Ravi', 'p3'), photo(900, 'Ravi', 'p2'), photo(800, 'Ravi', 'p1')],
      0
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Ravi added 3 photos');
    expect(rows[0].photoId).toBe('p3');
    expect(rows[0].at).toBe(1000);
  });

  it('splits bursts on a long gap or a different uploader', () => {
    const rows = coalesceActivity(
      [
        photo(10_000, 'Ravi', 'p3'),
        photo(9_500, 'Jo', 'p2'),
        // Same actor as p3 but far earlier: its own row.
        photo(1_000, 'Ravi', 'p1'),
      ],
      0
    );

    expect(rows.map((r) => r.label)).toEqual([
      'Ravi added a photo',
      'Jo added a photo',
      'Ravi added a photo',
    ]);
  });

  it('coalesces reactions per photo with distinct actors and emoji', () => {
    const rows = coalesceActivity(
      [
        reaction(300, 'Jo', 'p1', '🔥'),
        reaction(200, 'Mika', 'p1', '❤️'),
        reaction(100, 'Jo', 'p1', '❤️'),
      ],
      0
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Jo and 1 other reacted 🔥❤️ to your photo');
    expect(rows[0].at).toBe(300);
  });

  it('marks a coalesced row unread when any constituent is unseen', () => {
    const rows = coalesceActivity([photo(1000, 'Ravi', 'p2'), photo(900, 'Ravi', 'p1')], 950);
    expect(rows[0].unread).toBe(true);

    const allSeen = coalesceActivity([photo(1000, 'Ravi', 'p2'), photo(900, 'Ravi', 'p1')], 1000);
    expect(allSeen[0].unread).toBe(false);
  });

  it('renders comments, replies, joins and role changes as standalone rows', () => {
    const rows = coalesceActivity(
      [
        {
          type: 'comment',
          at: 400,
          actorId: 'jo',
          actorName: 'Jo',
          photoId: 'p1',
          commentId: 'c1',
          preview: 'Lovely!',
        },
        {
          type: 'reply',
          at: 300,
          actorId: 'mika',
          actorName: 'Mika',
          photoId: 'p2',
          commentId: 'c2',
          preview: 'Same spot?',
        },
        { type: 'join', at: 200, actorId: 'nina', actorName: 'Nina' },
        { type: 'role', at: 100, actorId: 'me', actorName: 'Me', role: 'admin', self: true },
      ],
      0
    );

    expect(rows.map((r) => r.label)).toEqual([
      'Jo commented: “Lovely!”',
      'Mika replied: “Same spot?”',
      'Nina joined the group',
      "You're now an admin",
    ]);
    expect(rows[0].openComments).toBe(true);
  });
});
