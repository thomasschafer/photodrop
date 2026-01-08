-- Seed test data for local development
-- Run with: wrangler d1 execute photodrop-db-dev --local --file=scripts/seed-test-data.sql

-- Create a test group
INSERT OR IGNORE INTO groups (id, name, created_at, created_by)
VALUES ('test-group-1', 'Test Family', unixepoch(), 'system');

-- Create a test admin user
INSERT OR IGNORE INTO users (id, group_id, name, email, role, invite_accepted_at, created_at)
VALUES ('test-admin-1', 'test-group-1', 'Test Admin', 'admin@test.com', 'admin', unixepoch(), unixepoch());

-- Create a test member user
INSERT OR IGNORE INTO users (id, group_id, name, email, role, invite_accepted_at, created_at)
VALUES ('test-member-1', 'test-group-1', 'Test Member', 'member@test.com', 'member', unixepoch(), unixepoch());
