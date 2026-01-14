-- Migration 003: Add comments table and update reactions schema
-- Adds support for photo comments and user preference for viewing social features

-- Comments table: stores comments on photos
-- author_name is denormalized to preserve display name after user deletion
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  user_id TEXT,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_photo_id ON comments(photo_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);

-- Add comments_enabled preference to users table
-- Default 0 (false) means comments/social features are hidden
ALTER TABLE users ADD COLUMN comments_enabled INTEGER DEFAULT 0;

-- Recreate photo_reactions table with one reaction per user per photo
-- (Previous schema allowed multiple emojis per user)
DROP TABLE IF EXISTS photo_reactions;

CREATE TABLE photo_reactions (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_photo_reactions_photo ON photo_reactions(photo_id);
