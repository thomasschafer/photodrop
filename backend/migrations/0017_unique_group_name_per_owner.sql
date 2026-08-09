-- Group names are unique per owner. This is what lets create-group.sh treat
-- (owner_id, name) as an idempotency key: retrying a partially failed run
-- reuses the existing group, and a concurrent duplicate insert fails loudly
-- instead of creating a second group.
CREATE UNIQUE INDEX idx_groups_owner_name ON groups (owner_id, name);
