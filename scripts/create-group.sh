#!/bin/bash
set -e

# Create a new group with an owner
# Usage: ./scripts/create-group.sh "Group Name" "Owner Name" "owner@example.com" [--prod]

if [ "$#" -lt 3 ]; then
    echo "Usage: $0 <group_name> <owner_name> <owner_email> [--prod]"
    echo "Example: $0 \"Family Photos\" \"Tom\" \"tom@example.com\""
    exit 1
fi

# Escape single quotes for SQL (replace ' with '')
escape_sql() {
    echo "$1" | sed "s/'/''/g"
}

GROUP_NAME=$(escape_sql "$1")
OWNER_NAME=$(escape_sql "$2")
OWNER_EMAIL=$(escape_sql "$3")
IS_PROD=false

if [ "$4" = "--prod" ]; then
    IS_PROD=true
    WRANGLER_REMOTE_FLAG="--remote"
    DB_NAME="photodrop-db-prod"
else
    WRANGLER_REMOTE_FLAG="--local"
    DB_NAME="photodrop-db"
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
echo "Owner: $OWNER_NAME ($OWNER_EMAIL)"
if [ "$IS_PROD" = true ]; then
    echo "Environment: Production"
else
    echo "Environment: Local development"
fi
echo ""

# Change to backend directory for wrangler
cd "$(dirname "$0")/../backend"

# Determine the frontend URL
if [ "$IS_PROD" = true ]; then
    # Load production config
    if [ -f .prod.vars ]; then
        # shellcheck source=/dev/null
        source .prod.vars
        FRONTEND_URL="${FRONTEND_URL:-https://photodrop.pages.dev}"
    else
        FRONTEND_URL="https://photodrop.pages.dev"
        echo "Warning: .prod.vars not found, using default URL"
    fi
else
    FRONTEND_URL="http://localhost:5173"
fi

# Check if user already exists
EXISTING_USER=$(wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
SELECT id FROM users WHERE email = '$OWNER_EMAIL';
" 2>&1 | grep -oE '[a-f0-9]{32}' | head -1 || true)

if [ -n "$EXISTING_USER" ]; then
    USER_ID="$EXISTING_USER"
    echo "Found existing user (ID: $USER_ID)"
else
    # Create new user
    USER_ID=$(generate_id)
    wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO users (id, name, email, created_at)
VALUES ('$USER_ID', '$OWNER_NAME', '$OWNER_EMAIL', $NOW);
"
    echo "Created new user (ID: $USER_ID)"
fi

# Create group with owner_id
wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO groups (id, name, owner_id, created_at)
VALUES ('$GROUP_ID', '$GROUP_NAME', '$USER_ID', $NOW);
"
echo "Created group (ID: $GROUP_ID)"

# Create membership for owner (with 'admin' role - owner is identified via groups.owner_id)
wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO memberships (user_id, group_id, role, joined_at)
VALUES ('$USER_ID', '$GROUP_ID', 'admin', $NOW);
"
echo "Created owner membership"

# Create magic link token for initial login
wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at)
VALUES ('$TOKEN', '$GROUP_ID', '$OWNER_EMAIL', 'login', NULL, $NOW, $EXPIRES_AT);
"
echo "Created magic link token"

MAGIC_LINK="$FRONTEND_URL/auth/$TOKEN"

# In production, send email via Resend API
EMAIL_SENT=false
if [ "$IS_PROD" = true ] && [ -n "${RESEND_API_KEY:-}" ] && [ -n "${DOMAIN:-}" ]; then
    echo "Sending invite email..."

    # Escape special characters for JSON
    JSON_GROUP_NAME=$(echo "$1" | sed 's/"/\\"/g')
    JSON_OWNER_NAME=$(echo "$2" | sed 's/"/\\"/g')

    EMAIL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.resend.com/emails" \
        -H "Authorization: Bearer $RESEND_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{
            \"from\": \"photodrop <noreply@$DOMAIN>\",
            \"to\": \"$3\",
            \"subject\": \"Welcome to $JSON_GROUP_NAME!\",
            \"html\": \"<h1>Welcome to photodrop!</h1><p>Hi $JSON_OWNER_NAME!</p><p>Your group <strong>$JSON_GROUP_NAME</strong> has been created.</p><p>Click the link below to get started (expires in 15 minutes):</p><p><a href='$MAGIC_LINK'>$MAGIC_LINK</a></p>\"
        }")

    HTTP_CODE=$(echo "$EMAIL_RESPONSE" | tail -n1)
    if [ "$HTTP_CODE" = "200" ]; then
        EMAIL_SENT=true
        echo "Email sent successfully!"
    else
        echo "Warning: Failed to send email (HTTP $HTTP_CODE)"
        echo "Response: $(echo "$EMAIL_RESPONSE" | head -n -1)"
    fi
fi

echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
if [ "$EMAIL_SENT" = true ]; then
    echo "Invite email sent to: $3"
    echo ""
    echo "Magic link (for reference):"
else
    echo "Magic link (expires in 15 minutes):"
fi
echo "$MAGIC_LINK"
echo "=========================================="
