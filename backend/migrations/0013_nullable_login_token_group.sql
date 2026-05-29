-- Login magic links can exist for users who currently have no group memberships.
-- Invite tokens remain group-scoped; the application enforces a non-null group_id
-- for invite tokens before processing them.

CREATE TABLE magic_link_tokens_new (
  token TEXT PRIMARY KEY,
  group_id TEXT,
  email TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('invite', 'login')),
  invite_role TEXT CHECK(invite_role IN ('admin', 'member')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  pending_at INTEGER DEFAULT NULL,
  CHECK(type = 'login' OR group_id IS NOT NULL),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

INSERT INTO magic_link_tokens_new (
  token,
  group_id,
  email,
  type,
  invite_role,
  created_at,
  expires_at,
  used_at,
  pending_at
)
SELECT
  token,
  CASE
    WHEN type = 'login' AND group_id = 'no-group' THEN NULL
    ELSE group_id
  END,
  email,
  type,
  invite_role,
  created_at,
  expires_at,
  used_at,
  pending_at
FROM magic_link_tokens;

DROP TABLE magic_link_tokens;
ALTER TABLE magic_link_tokens_new RENAME TO magic_link_tokens;

CREATE INDEX IF NOT EXISTS idx_magic_link_email ON magic_link_tokens(email);
CREATE INDEX IF NOT EXISTS idx_magic_link_group ON magic_link_tokens(group_id);
CREATE INDEX IF NOT EXISTS idx_magic_link_expires ON magic_link_tokens(expires_at);
