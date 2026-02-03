-- Add pending_at column to track when a token verification is in progress
-- This prevents race conditions where the same token is used concurrently
ALTER TABLE magic_link_tokens ADD COLUMN pending_at INTEGER DEFAULT NULL;
