-- When a photo's caption was last edited after upload; null for never-edited.
ALTER TABLE photos ADD COLUMN caption_edited_at INTEGER;
