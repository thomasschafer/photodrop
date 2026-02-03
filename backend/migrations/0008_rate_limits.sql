-- Rate limiting table for tracking request counts per key
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL
);

-- Index for cleanup of expired entries
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
