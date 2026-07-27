-- Migration 0014: Per-group display name override on memberships
--
-- users.name stays the person's canonical name, which only they can change.
-- display_name is an optional override scoped to a single group, settable by
-- the member themselves or an admin of that group. NULL means "no override",
-- so every existing membership keeps showing the canonical name and no
-- backfill is needed.
ALTER TABLE memberships ADD COLUMN display_name TEXT;
