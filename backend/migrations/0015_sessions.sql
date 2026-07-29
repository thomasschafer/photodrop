-- Migration 0015: Server-side sessions behind refresh tokens
--
-- Refresh tokens used to be pure bearer JWTs: /auth/logout cleared the cookie
-- and nothing else, so a token captured from a browser stayed usable for its
-- full 30 days no matter what the user did. Every refresh token now names a row
-- in this table, which gives the server somewhere to revoke.
--
-- One row per session, where a session is one device's login:
--
--   jti          the id of the single refresh token that is currently valid for
--                this session. Rotating the token overwrites it in place, so a
--                session can never have two live refresh tokens.
--   family_id    stable across every rotation of that session (hence UNIQUE, and
--                the key every lookup uses). It is what makes the lineage of a
--                token explicit: a refresh token that verifies, names a live
--                family, but is not that family's current jti, is a replay of an
--                already-rotated token. That is the signature of a leaked token,
--                so the whole family is deleted rather than just that token.
--   previous_jti the token the current one replaced, with rotated_at recording
--                when. It keeps the just-superseded token acceptable for a few
--                seconds, because two browser tabs refreshing at the same moment
--                otherwise look exactly like a replay and would sign the device
--                out. Seeded to jti on insert so both columns are always set.
--
-- Deliberately not a users.session_epoch counter: bumping a counter on logout
-- would sign the user out on every device at once. Deliberately not group
-- scoped either — a session belongs to a device, not to a group; which group is
-- selected lives in the token, and group access is re-checked from memberships
-- on every request.
--
-- Refresh tokens issued before this migration carry no jti and are rejected on
-- their next refresh, so every signed-in device is signed out once, at deploy.
CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  previous_jti TEXT NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Lookups by family_id are already served by the UNIQUE constraint above.

-- Opportunistic pruning selects the oldest expired rows; without this it would
-- table-scan on every refresh.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Every session a user has, for account-wide revocation ("sign out everywhere").
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
