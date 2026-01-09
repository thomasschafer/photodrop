#!/bin/bash
set -e

# Create a new group with an admin user
# Usage: ./scripts/create-group.sh "Group Name" "admin@example.com" [--remote]

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <group_name> <admin_email> [--remote]"
    echo "Example: $0 \"Family Photos\" \"tom@example.com\""
    exit 1
fi

GROUP_NAME="$1"
ADMIN_EMAIL="$2"
REMOTE_FLAG=""

if [ "$3" = "--remote" ]; then
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
TOKEN=$(generate_token)
NOW=$(date +%s)
EXPIRES_AT=$((NOW + 900))  # 15 minutes

echo "Creating group: $GROUP_NAME"
echo "Admin email: $ADMIN_EMAIL"
echo ""

# Change to backend directory for wrangler
cd "$(dirname "$0")/../backend"

# Insert group
wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
INSERT INTO groups (id, name, created_at, created_by)
VALUES ('$GROUP_ID', '$GROUP_NAME', $NOW, 'cli');
"

echo "✓ Group created (ID: $GROUP_ID)"

# Check if user already exists and create membership for them
EXISTING_USER=$(wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
SELECT id FROM users WHERE email = '$ADMIN_EMAIL';
" 2>&1 | grep -oE '[a-f0-9]{32}' | head -1 || true)

if [ -n "$EXISTING_USER" ]; then
    USER_ID="$EXISTING_USER"
    echo "✓ Found existing user (ID: $USER_ID)"

    # Create membership for existing user
    wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
INSERT INTO memberships (user_id, group_id, role, joined_at)
VALUES ('$USER_ID', '$GROUP_ID', 'admin', $NOW);
"
    echo "✓ Admin membership created"
else
    echo "✓ New user - will be created when magic link is clicked"
fi

# Create magic link token for initial login (or to create new user)
wrangler d1 execute photodrop-db $REMOTE_FLAG --command "
INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at)
VALUES ('$TOKEN', '$GROUP_ID', '$ADMIN_EMAIL', 'invite', 'admin', $NOW, $EXPIRES_AT);
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
