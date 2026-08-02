import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { anonymizeUserAccount, deleteMembership, type User } from './db';

describe('privacy-critical account and membership guards with real D1', () => {
  let miniflare: Miniflare;
  let db: D1Database;

  const user: User = {
    id: 'user-1',
    name: 'Jane',
    email: 'jane@example.com',
    profile_color: 'teal',
    created_at: 1,
    last_seen_at: 1,
    deleted_at: null,
  };

  beforeEach(async () => {
    miniflare = new Miniflare({
      modules: true,
      script: `export default { fetch() { return new Response('ok') } }`,
      d1Databases: ['DB'],
    });
    db = await miniflare.getD1Database('DB');
    await db.batch([
      db.prepare(
        `CREATE TABLE users (
          id TEXT PRIMARY KEY, name TEXT, email TEXT, profile_color TEXT,
          created_at INTEGER, last_seen_at INTEGER, deleted_at INTEGER
        )`
      ),
      db.prepare('CREATE TABLE groups (id TEXT PRIMARY KEY, owner_id TEXT)'),
      db.prepare('CREATE TABLE memberships (user_id TEXT, group_id TEXT, role TEXT)'),
      db.prepare('CREATE TABLE photo_reactions (user_id TEXT)'),
      db.prepare('CREATE TABLE photo_views (user_id TEXT)'),
      db.prepare('CREATE TABLE push_subscriptions (user_id TEXT)'),
      db.prepare('CREATE TABLE device_tokens (user_id TEXT)'),
      db.prepare('CREATE TABLE sessions (user_id TEXT)'),
      db.prepare('CREATE TABLE comments (user_id TEXT, author_name TEXT)'),
      db.prepare('CREATE TABLE magic_link_tokens (email TEXT)'),
      db.prepare(
        `CREATE TABLE account_deletion_tokens (
          token TEXT PRIMARY KEY, user_id TEXT, used_at INTEGER
        )`
      ),
    ]);
  });

  afterEach(async () => {
    await miniflare.dispose();
  });

  async function seedAccount(ownsGroup: boolean): Promise<void> {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
           (id, name, email, profile_color, created_at, last_seen_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`
        )
        .bind(user.id, user.name, user.email, user.profile_color, 1, 1),
      db
        .prepare('INSERT INTO groups (id, owner_id) VALUES (?, ?)')
        .bind('group-1', ownsGroup ? user.id : 'someone-else'),
      db
        .prepare("INSERT INTO memberships (user_id, group_id, role) VALUES (?, ?, 'member')")
        .bind(user.id, 'group-1'),
      db.prepare('INSERT INTO photo_reactions (user_id) VALUES (?)').bind(user.id),
      db.prepare('INSERT INTO photo_views (user_id) VALUES (?)').bind(user.id),
      db.prepare('INSERT INTO push_subscriptions (user_id) VALUES (?)').bind(user.id),
      db.prepare('INSERT INTO device_tokens (user_id) VALUES (?)').bind(user.id),
      db.prepare('INSERT INTO sessions (user_id) VALUES (?)').bind(user.id),
      db
        .prepare('INSERT INTO comments (user_id, author_name) VALUES (?, ?)')
        .bind(user.id, user.name),
      db.prepare('INSERT INTO magic_link_tokens (email) VALUES (?)').bind(user.email),
      db
        .prepare(
          'INSERT INTO account_deletion_tokens (token, user_id, used_at) VALUES (?, ?, NULL)'
        )
        .bind('delete-token', user.id),
    ]);
  }

  it('cannot delete an owner membership but can delete an ordinary member', async () => {
    await seedAccount(true);

    await expect(deleteMembership(db, user.id, 'group-1')).resolves.toEqual({
      success: false,
      error: 'is_owner',
    });
    expect(
      await db
        .prepare('SELECT COUNT(*) count FROM memberships WHERE user_id = ?')
        .bind(user.id)
        .first<{ count: number }>('count')
    ).toBe(1);

    await db.prepare('UPDATE groups SET owner_id = ?').bind('someone-else').run();
    await expect(deleteMembership(db, user.id, 'group-1')).resolves.toEqual({ success: true });
  });

  it('anonymizes and clears private activity only after the ownership-safe tombstone succeeds', async () => {
    await seedAccount(false);

    await expect(anonymizeUserAccount(db, user, 'delete-token')).resolves.toBe(true);

    const deleted = await db
      .prepare('SELECT name, email, deleted_at FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ name: string; email: string; deleted_at: number | null }>();
    expect(deleted).toMatchObject({
      name: 'Deleted user',
      email: 'deleted-user-1@deleted.invalid',
    });
    expect(deleted?.deleted_at).not.toBeNull();
    expect(await db.prepare('SELECT COUNT(*) count FROM memberships').first<number>('count')).toBe(
      0
    );
    expect(
      await db.prepare('SELECT COUNT(*) count FROM photo_reactions').first<number>('count')
    ).toBe(0);
    expect(await db.prepare('SELECT user_id, author_name FROM comments').first()).toEqual({
      user_id: null,
      author_name: 'Deleted user',
    });
    expect(
      await db
        .prepare('SELECT used_at FROM account_deletion_tokens WHERE token = ?')
        .bind('delete-token')
        .first<number>('used_at')
    ).not.toBeNull();
  });

  it('leaves the entire account and confirmation token untouched when ownership blocks deletion', async () => {
    await seedAccount(true);

    await expect(anonymizeUserAccount(db, user, 'delete-token')).resolves.toBe(false);

    expect(await db.prepare('SELECT name, email, deleted_at FROM users').first()).toEqual({
      name: user.name,
      email: user.email,
      deleted_at: null,
    });
    for (const table of [
      'memberships',
      'photo_reactions',
      'photo_views',
      'push_subscriptions',
      'device_tokens',
      'sessions',
      'comments',
      'magic_link_tokens',
    ]) {
      expect(await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<number>('count')).toBe(
        1
      );
    }
    expect(
      await db
        .prepare('SELECT used_at FROM account_deletion_tokens WHERE token = ?')
        .bind('delete-token')
        .first<number | null>('used_at')
    ).toBeNull();
  });
});
