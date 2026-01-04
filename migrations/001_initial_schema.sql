-- Migration 001: Initial schema
-- Creates all base tables for photodrop application

-- Schema migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

-- Insert this migration
INSERT INTO schema_migrations (version, applied_at, description)
VALUES (1, unixepoch(), 'Initial schema');

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  invite_token TEXT UNIQUE,
  invite_role TEXT CHECK (invite_role IN ('admin', 'viewer', NULL)),
  invite_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users(invite_token);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Push subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  thumbnail_r2_key TEXT,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_by ON photos(uploaded_by);

-- Photo views table (for read receipts)
CREATE TABLE IF NOT EXISTS photo_views (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_views_photo_id ON photo_views(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_views_user_id ON photo_views(user_id);

-- Photo reactions table
CREATE TABLE IF NOT EXISTS photo_reactions (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_reactions_photo_id ON photo_reactions(photo_id);

-- DOWN (for rollback, keep commented)
-- DROP TABLE IF EXISTS photo_reactions;
-- DROP TABLE IF EXISTS photo_views;
-- DROP TABLE IF EXISTS photos;
-- DROP TABLE IF EXISTS push_subscriptions;
-- DROP TABLE IF EXISTS users;
-- DROP TABLE IF EXISTS schema_migrations;
