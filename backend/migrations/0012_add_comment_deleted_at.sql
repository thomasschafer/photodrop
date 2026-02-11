ALTER TABLE comments ADD COLUMN deleted_at INTEGER;

UPDATE comments
SET deleted_at = created_at
WHERE content = '[deleted]' AND deleted_at IS NULL;
