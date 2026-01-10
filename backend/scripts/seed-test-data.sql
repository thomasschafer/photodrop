-- Seed test data for local development
-- Run with: wrangler d1 execute photodrop-db --local --file=scripts/seed-test-data.sql

-- Create test users first (needed before groups due to owner_id FK)
INSERT OR IGNORE INTO users (id, name, email, created_at)
VALUES ('test-owner-1', 'Test Owner', 'owner@test.com', unixepoch());

INSERT OR IGNORE INTO users (id, name, email, created_at)
VALUES ('test-member-1', 'Test Member', 'member@test.com', unixepoch());

-- Create a test group (owner_id references the owner user)
INSERT OR IGNORE INTO groups (id, name, owner_id, created_at)
VALUES ('test-group-1', 'Test Family', 'test-owner-1', unixepoch());

-- Create memberships (owner has 'admin' role - ownership is tracked in groups.owner_id)
INSERT OR IGNORE INTO memberships (user_id, group_id, role, joined_at)
VALUES ('test-owner-1', 'test-group-1', 'admin', unixepoch());

INSERT OR IGNORE INTO memberships (user_id, group_id, role, joined_at)
VALUES ('test-member-1', 'test-group-1', 'member', unixepoch());
