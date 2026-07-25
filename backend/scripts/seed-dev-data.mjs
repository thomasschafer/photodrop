#!/usr/bin/env node
/**
 * Seeds local development data: test users and a group, generated photos, and
 * a spread of reactions and comments on those photos.
 *
 * Run from the backend directory (or via `nix run .#db-seed`). Photos are
 * synthesised at run time, so no image files are stored in the repository.
 *
 * Usage: node scripts/seed-dev-data.mjs [--photos 10] [--group <id>] [--seed <n>]
 */

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

import { getPlatformProxy } from 'wrangler';

import { generatePhoto } from './lib/generate-photo.mjs';
import { createRandom, pick, randomBetween } from './lib/random.mjs';

const DEFAULT_PHOTO_COUNT = 10;
const MEAN_SECONDS_BETWEEN_PHOTOS = 5 * 60 * 60;

const TEST_GROUP = { id: 'test-group-1', name: 'Test Family' };

/** Profile colours come from PROFILE_COLORS in src/lib/db.ts. */
const TEST_USERS = [
  {
    id: 'test-owner-1',
    name: 'Test Owner',
    email: 'owner@test.com',
    role: 'admin',
    profileColor: 'ocean',
  },
  {
    id: 'test-member-1',
    name: 'Test Member',
    email: 'member@test.com',
    role: 'member',
    profileColor: 'sage',
  },
  {
    id: 'test-member-2',
    name: 'Ravi',
    email: 'ravi@test.com',
    role: 'admin',
    profileColor: 'terracotta',
  },
  { id: 'test-member-3', name: 'Jo', email: 'jo@test.com', role: 'member', profileColor: 'plum' },
  {
    id: 'test-member-4',
    name: 'Mika',
    email: 'mika@test.com',
    role: 'member',
    profileColor: 'jade',
  },
];

/** Mirrors ALLOWED_EMOJIS in src/lib/schemas.ts; anything else is rejected by the API. */
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

const CAPTIONS = [
  'Golden hour over the ridge',
  'Last light on the water',
  'Morning walk, nobody else around',
  'Storm clearing up',
  'Same spot, different sky',
  'Camp two, just before dark',
  'The long way home',
  'Worth the early start',
  'Fog burning off',
  'Clear night, no filter',
  'Halfway up',
  'Low tide',
  'Second attempt at this shot',
  'Blue hour',
];

const COMMENTS = [
  'Wow',
  'This is gorgeous',
  'Where is this?',
  'Frame it!',
  'The colours 😍',
  'Was it as cold as it looks?',
  'Best one yet',
  'I was there last summer, brings it all back',
  'Okay this is my new wallpaper',
  'How early did you have to get up for this??',
  'Perfect timing on the light',
  'Send me the full res one?',
  'Miss it there',
  'That sky is unreal',
  'Ha, I remember this day',
  'Did you edit this at all or is that straight out of the camera? The sky looks almost too good to be true, but I believe you',
  'Next time take me with you',
  'Beautiful 🔥',
  'Not bad for a phone camera',
  'Adding this to the list of places to go',
  'The reflection though',
  'So peaceful',
  'This one deserves a print',
  'Looks freezing',
  'My favourite of the set',
];

const USAGE = `Seed local development data: test users, photos, reactions and comments.

Re-running replaces previously seeded photos rather than adding to them; photos
uploaded through the app are left alone.

Usage: node scripts/seed-dev-data.mjs [options]

Options:
  --photos <n>  Number of photos to seed (default: ${DEFAULT_PHOTO_COUNT})
  --group <id>  Group to seed photos into (default: the test group)
  --seed <n>    PRNG seed, for reproducible output (default: random)
  -h, --help    Show this message
`;

/** A problem with how the command was invoked, reported without a stack trace. */
class UsageError extends Error {}

/** Marks rows and R2 keys this script owns, so a re-run can replace exactly those. */
const SEEDED_PREFIX = 'seed-';

/** Mirrors generateId in src/lib/crypto.ts so seeded ids match generated ones. */
function generateId() {
  return randomBytes(16).toString('hex');
}

function generateSeededId() {
  return `${SEEDED_PREFIX}${generateId()}`;
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parseOptions() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        photos: { type: 'string' },
        group: { type: 'string' },
        seed: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (error) {
    throw new UsageError(`${error.message}\n\n${USAGE}`);
  }

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const photoCount = values.photos === undefined ? DEFAULT_PHOTO_COUNT : Number(values.photos);
  if (!Number.isInteger(photoCount) || photoCount < 0) {
    throw new UsageError(`--photos must be a non-negative integer, got "${values.photos}"`);
  }

  const seed = values.seed === undefined ? randomBytes(4).readUInt32BE(0) : Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0) {
    throw new UsageError(`--seed must be a non-negative integer, got "${values.seed}"`);
  }

  return { photoCount, groupId: values.group, seed };
}

/** Idempotent: an existing user, group or membership is left untouched. */
async function seedUsersAndGroup(db) {
  const createdAt = nowInSeconds();

  for (const user of TEST_USERS) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO users (id, name, email, profile_color, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(user.id, user.name, user.email, user.profileColor, createdAt)
      .run();
  }

  const owner = TEST_USERS[0];
  await db
    .prepare('INSERT OR IGNORE INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(TEST_GROUP.id, TEST_GROUP.name, owner.id, createdAt)
    .run();

  for (const user of TEST_USERS) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO memberships (user_id, group_id, role, joined_at) VALUES (?, ?, ?, ?)'
      )
      .bind(user.id, TEST_GROUP.id, user.role, createdAt)
      .run();
  }
}

async function resolveGroup(db, requestedGroupId) {
  const groupId = requestedGroupId ?? TEST_GROUP.id;
  const group = await db.prepare('SELECT id, name FROM groups WHERE id = ?').bind(groupId).first();

  if (!group) {
    const { results: groups } = await db.prepare('SELECT id, name FROM groups ORDER BY name').all();
    const options = groups.map((candidate) => `  ${candidate.id}  (${candidate.name})`).join('\n');
    throw new UsageError(`No group with id "${groupId}". Known groups:\n${options}`);
  }

  return group;
}

async function getMembers(db, groupId) {
  const { results: members } = await db
    .prepare(
      `SELECT users.id, users.name, memberships.role
       FROM memberships
       JOIN users ON users.id = memberships.user_id
       WHERE memberships.group_id = ?
       ORDER BY users.name`
    )
    .bind(groupId)
    .all();

  if (members.length === 0) {
    throw new UsageError(`Group "${groupId}" has no members to attribute photos to.`);
  }

  return members;
}

/**
 * Removes everything a previous run of this script created in the group, so
 * seeding is idempotent. Photos uploaded through the app have plain ids and are
 * left untouched.
 */
async function clearSeededPhotos(env, groupId) {
  const { results: seeded } = await env.DB.prepare(
    'SELECT id, r2_key, thumbnail_r2_key FROM photos WHERE group_id = ? AND id LIKE ?'
  )
    .bind(groupId, `${SEEDED_PREFIX}%`)
    .all();

  for (const photo of seeded) {
    await env.PHOTOS.delete(photo.r2_key);
    if (photo.thumbnail_r2_key) {
      await env.PHOTOS.delete(photo.thumbnail_r2_key);
    }

    // Explicit child deletes: local D1 does not enforce foreign keys by default.
    await env.DB.prepare('DELETE FROM comments WHERE photo_id = ?').bind(photo.id).run();
    await env.DB.prepare('DELETE FROM photo_reactions WHERE photo_id = ?').bind(photo.id).run();
    await env.DB.prepare('DELETE FROM photo_views WHERE photo_id = ?').bind(photo.id).run();
    await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(photo.id).run();
  }

  return seeded.length;
}

async function seedPhoto(env, { groupId, uploader, caption, uploadedAt, seed }) {
  const image = generatePhoto(seed);

  const photoId = generateSeededId();
  const photoKey = `photos/${photoId}-${Date.now()}.png`;
  const thumbnailKey = `thumbnails/${photoId}-${Date.now()}.png`;

  await env.PHOTOS.put(photoKey, image.fullSize, {
    httpMetadata: { contentType: 'image/png' },
  });
  await env.PHOTOS.put(thumbnailKey, image.thumbnail, {
    httpMetadata: { contentType: 'image/png' },
  });

  await env.DB.prepare(
    `INSERT INTO photos (id, group_id, r2_key, thumbnail_r2_key, caption, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(photoId, groupId, photoKey, thumbnailKey, caption, uploader.id, uploadedAt)
    .run();

  return { id: photoId, uploadedAt, image };
}

/** Rough distribution: plenty of quiet photos, a few busy ones. */
function countFromDistribution(random, buckets) {
  let roll = random();
  for (const bucket of buckets) {
    roll -= bucket.weight;
    if (roll < 0) {
      return Math.floor(randomBetween(random, bucket.min, bucket.max + 1));
    }
  }
  return 0;
}

/** A timestamp somewhere between the photo being uploaded and now. */
function timeSinceUpload(random, uploadedAt) {
  return Math.round(randomBetween(random, uploadedAt, nowInSeconds()));
}

async function seedReactions(db, photo, members, random) {
  const target = countFromDistribution(random, [
    { weight: 0.15, min: 0, max: 0 },
    { weight: 0.4, min: 1, max: 2 },
    { weight: 0.3, min: 3, max: 5 },
    { weight: 0.15, min: 6, max: 11 },
  ]);

  // Users may react with several emoji, but not the same emoji twice.
  const seen = new Set();
  let inserted = 0;

  for (let index = 0; index < target; index += 1) {
    const member = pick(random, members);
    const emoji = pick(random, REACTION_EMOJIS);
    const key = `${member.id}|${emoji}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    await db
      .prepare(
        'INSERT INTO photo_reactions (photo_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(photo.id, member.id, emoji, timeSinceUpload(random, photo.uploadedAt))
      .run();
    inserted += 1;
  }

  return inserted;
}

async function seedComments(db, photo, members, random) {
  const target = countFromDistribution(random, [
    { weight: 0.3, min: 0, max: 0 },
    { weight: 0.35, min: 1, max: 2 },
    { weight: 0.25, min: 3, max: 5 },
    { weight: 0.1, min: 6, max: 9 },
  ]);

  const times = Array.from({ length: target }, () =>
    timeSinceUpload(random, photo.uploadedAt)
  ).sort((first, second) => first - second);

  for (const createdAt of times) {
    const member = pick(random, members);
    // Occasionally seed a soft-deleted comment, matching deleteComment in src/lib/db.ts.
    const isDeleted = random() < 0.08;

    await db
      .prepare(
        `INSERT INTO comments (id, photo_id, user_id, author_name, content, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateId(),
        photo.id,
        isDeleted ? null : member.id,
        isDeleted ? '[deleted]' : member.name,
        isDeleted ? '[deleted]' : pick(random, COMMENTS),
        createdAt,
        isDeleted ? createdAt : null
      )
      .run();
  }

  return times.length;
}

async function main() {
  const { photoCount, groupId: requestedGroupId, seed } = parseOptions();
  const { env, dispose } = await getPlatformProxy();

  try {
    await seedUsersAndGroup(env.DB);

    const group = await resolveGroup(env.DB, requestedGroupId);
    const members = await getMembers(env.DB, group.id);
    const uploaders = members.filter((member) => member.role === 'admin');
    if (uploaders.length === 0) {
      throw new UsageError(`Group "${group.id}" has no admin members to attribute photos to.`);
    }

    const random = createRandom(seed);

    console.log(`Seeding ${photoCount} photo(s) into "${group.name}" (${group.id}), seed ${seed}`);

    const removed = await clearSeededPhotos(env, group.id);
    if (removed > 0) {
      console.log(`  removed ${removed} previously seeded photo(s)`);
    }

    // Spread backwards from now, so seeded photos are always in the past.
    const timestamps = [];
    let uploadedAt = nowInSeconds();
    for (let index = 0; index < photoCount; index += 1) {
      uploadedAt -= Math.round(randomBetween(random, 0.4, 1.6) * MEAN_SECONDS_BETWEEN_PHOTOS);
      timestamps.push(uploadedAt);
    }

    let reactionCount = 0;
    let commentCount = 0;

    for (let index = 0; index < photoCount; index += 1) {
      const uploader = pick(random, uploaders);
      const caption = random() < 0.25 ? null : pick(random, CAPTIONS);

      const photo = await seedPhoto(env, {
        groupId: group.id,
        uploader,
        caption,
        uploadedAt: timestamps[index],
        seed: seed + index,
      });

      const reactions = await seedReactions(env.DB, photo, members, random);
      const comments = await seedComments(env.DB, photo, members, random);
      reactionCount += reactions;
      commentCount += comments;

      const sizeKb = Math.round(photo.image.fullSize.length / 1024);
      console.log(
        `  [${index + 1}/${photoCount}] ${photo.image.palette} ${photo.image.width}x${photo.image.height}` +
          ` ${sizeKb}KB by ${uploader.name}, ${reactions} reaction(s), ${comments} comment(s)`
      );
    }

    console.log(
      `\nSeeded ${photoCount} photo(s), ${reactionCount} reaction(s), ${commentCount} comment(s).`
    );
    console.log(`\nTest users (group "${TEST_GROUP.name}"):`);
    for (const user of TEST_USERS) {
      console.log(`  ${user.email} (${user.role})`);
    }
  } finally {
    await dispose();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
