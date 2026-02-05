-- Migration 010: Add device tokens table for native push notifications
-- Stores FCM device tokens for iOS and Android apps

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, group_id, token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Index for efficient notification queries (get all tokens for a group)
CREATE INDEX IF NOT EXISTS idx_device_tokens_group ON device_tokens(group_id);

-- Index for cleanup queries (get all tokens for a user)
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
