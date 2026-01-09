#!/bin/bash
set -e

# Create a new group with an admin user
# Usage: ./scripts/create-group.sh "Group Name" "Admin Name" "admin@example.com" [--remote]

if [ "$#" -lt 3 ]; then
    echo "Usage: $0 <group_name> <admin_name> <admin_email> [--remote]"
    echo "Example: $0 \"Family Photos\" \"Tom\" \"tom@example.com\""
    exit 1
fi

GROUP_NAME="$1"
ADMIN_NAME="$2"
ADMIN_EMAIL="$3"
REMOTE_FLAG=""

if [ "$4" = "--remote" ]; then
    REMOTE_FLAG="--remote"
else
    REMOTE_FLAG="--local"
fi

# Generate random hex IDs (32 chars for IDs, 64 chars for tokens)
generate_id() {
    openssl rand -hex 16
}

generate_token() {
    openssl rand -hex 32
}

GROUP_ID=$(generate_id)
USER_ID=$(generate_id)
TOKEN=$(generate_token)
NOW=$(date +%s)
EXPIRES_AT=$((NOW + 900))  # 15 minutes

echo "Creating group: $GROUP_NAME"
echo "Admin: $ADMIN_NAME <$ADMIN_EMAIL>"
echo ""

# Change to backend directory for wrangler
cd "$(dirname "$0")/../backend"

# Insert group
wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
INSERT INTO groups (id, name, created_at, created_by)
VALUES ('$GROUP_ID', '$GROUP_NAME', $NOW, 'cli');
"

echo "✓ Group created (ID: $GROUP_ID)"

# Insert admin user
wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
INSERT INTO users (id, group_id, name, email, role, invite_accepted_at, created_at)
VALUES ('$USER_ID', '$GROUP_ID', '$ADMIN_NAME', '$ADMIN_EMAIL', 'admin', NULL, $NOW);
"

echo "✓ Admin user created (ID: $USER_ID)"

# Create magic link token for initial login
wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at)
VALUES ('$TOKEN', '$GROUP_ID', '$ADMIN_EMAIL', 'login', NULL, $NOW, $EXPIRES_AT);
"

echo "✓ Magic link token created"
echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
echo "Magic link (expires in 15 minutes):"
echo "http://localhost:5173/auth/$TOKEN"
echo ""
echo "For production, replace localhost:5173 with your domain."
echo "=========================================="
