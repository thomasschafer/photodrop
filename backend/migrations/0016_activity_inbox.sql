-- Activity inbox support: when each member last opened their inbox (unread
-- state), and when a membership's role last changed (role-change events).
ALTER TABLE memberships ADD COLUMN activity_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memberships ADD COLUMN role_changed_at INTEGER;
