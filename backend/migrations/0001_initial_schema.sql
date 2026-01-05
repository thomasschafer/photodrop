-- Initial schema for Photodrop
-- Created: 2026-01-05
-- Updated: Email-based passwordless authentication

-- Users table: stores all users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
  invite_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Magic link tokens table: temporary auth tokens for email-based login
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('invite', 'login')),
  invite_role TEXT CHECK(invite_role IN ('admin', 'viewer')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Photos table: stores photo metadata (actual files in R2)
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  caption TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  thumbnail_r2_key TEXT,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Photo views table: tracks which users have viewed which photos
CREATE TABLE IF NOT EXISTS photo_views (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Photo reactions table: stores emoji reactions to photos
CREATE TABLE IF NOT EXISTS photo_reactions (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id, emoji),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_invite_accepted ON users(invite_accepted_at);
CREATE INDEX IF NOT EXISTS idx_magic_link_email ON magic_link_tokens(email);
CREATE INDEX IF NOT EXISTS idx_magic_link_expires ON magic_link_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_views_user ON photo_views(user_id);
CREATE INDEX IF NOT EXISTS idx_photo_reactions_photo ON photo_reactions(photo_id);
