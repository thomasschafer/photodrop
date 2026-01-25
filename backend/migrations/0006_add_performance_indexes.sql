-- Migration 0006: Add performance indexes for common queries
--
-- 1. Index on comments.created_at for ordering queries
-- 2. Index on photo_reactions.user_id for user reaction lookups

CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);

CREATE INDEX IF NOT EXISTS idx_photo_reactions_user ON photo_reactions(user_id);
