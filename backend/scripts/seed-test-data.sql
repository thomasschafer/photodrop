-- Seed test data for local development
-- Run with: wrangler d1 execute photodrop-db-dev --local --file=scripts/seed-test-data.sql

-- Create a test group
INSERT OR IGNORE INTO groups (id, name, created_at, created_by)
VALUES ('test-group-1', 'Test Family', unixepoch(), 'system');

-- Create a test admin user
INSERT OR IGNORE INTO users (id, name, email, created_at)
VALUES ('test-admin-1', 'Test Admin', 'admin@test.com', unixepoch());

-- Create a test member user
INSERT OR IGNORE INTO users (id, name, email, created_at)
VALUES ('test-member-1', 'Test Member', 'member@test.com', unixepoch());

-- Create memberships
INSERT OR IGNORE INTO memberships (user_id, group_id, role, joined_at)
VALUES ('test-admin-1', 'test-group-1', 'admin', unixepoch());

INSERT OR IGNORE INTO memberships (user_id, group_id, role, joined_at)
VALUES ('test-member-1', 'test-group-1', 'member', unixepoch());
