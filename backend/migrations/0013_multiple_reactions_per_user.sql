-- Migration 0013: Allow multiple emoji reactions per user per photo
--
-- Previously the primary key was (photo_id, user_id), limiting each user to a
-- single emoji per photo. Widen the key to (photo_id, user_id, emoji) so a user
-- can react with several distinct emoji. Existing data has at most one row per
-- (photo_id, user_id) and is preserved as-is.

CREATE TABLE photo_reactions_new (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id, emoji),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO photo_reactions_new (photo_id, user_id, emoji, created_at)
SELECT photo_id, user_id, emoji, created_at FROM photo_reactions;

DROP TABLE photo_reactions;

ALTER TABLE photo_reactions_new RENAME TO photo_reactions;

CREATE INDEX idx_photo_reactions_photo ON photo_reactions(photo_id);
CREATE INDEX idx_photo_reactions_user ON photo_reactions(user_id);
