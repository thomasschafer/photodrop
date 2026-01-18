-- Migration 005: Fix push subscriptions for multi-group support and add deletion token
--
-- Changes:
-- 1. Add deletion_token column for secure unauthenticated unsubscribe
-- 2. Change UNIQUE constraint from (endpoint) to (endpoint, group_id) to allow
--    the same browser to be subscribed to multiple groups

-- Add deletion_token column
ALTER TABLE push_subscriptions ADD COLUMN deletion_token TEXT;

-- SQLite doesn't support dropping constraints directly, so we need to recreate the table
-- Create new table with correct constraints
CREATE TABLE push_subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  deletion_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  UNIQUE (endpoint, group_id)
);

-- Copy existing data, generating deletion tokens for existing rows
INSERT INTO push_subscriptions_new (id, user_id, group_id, endpoint, p256dh, auth, deletion_token, created_at)
SELECT id, user_id, group_id, endpoint, p256dh, auth,
       lower(hex(randomblob(16))),
       created_at
FROM push_subscriptions;

-- Drop old table
DROP TABLE push_subscriptions;

-- Rename new table
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- Recreate indexes
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX idx_push_subscriptions_group ON push_subscriptions(group_id);
CREATE INDEX idx_push_subscriptions_user_group ON push_subscriptions(user_id, group_id);
CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
