-- D1 should have foreign keys enabled by default, but enforce it explicitly.
-- This PRAGMA ensures ON DELETE CASCADE works correctly.
PRAGMA foreign_keys = ON;
