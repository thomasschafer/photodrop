-- Account deletion keeps family archive contributions while erasing the
-- person's account details. The users row becomes an inert tombstone so the
-- existing photos.uploaded_by foreign key can keep archive attribution.
ALTER TABLE users ADD COLUMN deleted_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

-- Short-lived, single-use confirmations for the destructive account deletion
-- action. These are separate from login/invite links so a login link can never
-- be confused with consent to delete an account.
CREATE TABLE IF NOT EXISTS account_deletion_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_tokens_user
  ON account_deletion_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_account_deletion_tokens_expires
  ON account_deletion_tokens(expires_at);
