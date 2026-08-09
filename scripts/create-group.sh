#!/bin/bash
set -e

# Create a new group with an owner
# Usage: ./scripts/create-group.sh "Group Name" "Owner Name" "owner@example.com" [--prod] [--email-only]
#
#   --prod        Target the production D1 database (requires Cloudflare auth)
#   --email-only  Require the invite email to be sent, and never print the
#                 magic link or owner details. Used by CI, where logs are
#                 publicly visible.

if [ "$#" -lt 3 ]; then
    echo "Usage: $0 <group_name> <owner_name> <owner_email> [--prod] [--email-only]"
    echo "Example: $0 \"Family Photos\" \"Tom\" \"tom@example.com\""
    exit 1
fi

# Escape for use inside a single-quoted SQL string literal. Doubling single
# quotes is SQLite's complete escaping mechanism (it has no backslash
# escapes), so escaped values cannot alter query structure. Use the SQL_*
# variables only inside SQL; use the raw arguments everywhere else.
escape_sql() {
    echo "$1" | sed "s/'/''/g"
}

SQL_GROUP_NAME=$(escape_sql "$1")
SQL_OWNER_NAME=$(escape_sql "$2")
SQL_OWNER_EMAIL=$(escape_sql "$3")
IS_PROD=false
EMAIL_ONLY=false

for arg in "${@:4}"; do
    case "$arg" in
        --prod) IS_PROD=true ;;
        --email-only) EMAIL_ONLY=true ;;
        *)
            echo "Error: Unknown option: $arg"
            exit 1
            ;;
    esac
done

if [ "$EMAIL_ONLY" = true ] && [ "$IS_PROD" != true ]; then
    echo "Error: --email-only requires --prod (emails are only sent in production)"
    exit 1
fi

if [ "$IS_PROD" = true ]; then
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

# Email-only mode runs in GitHub Actions, where this workflow command masks the
# token in the publicly visible logs — without it, a failing wrangler call
# could echo the SQL, token included.
if [ "$EMAIL_ONLY" = true ]; then
    echo "::add-mask::$TOKEN"
fi

# In email-only mode, keep owner details out of the output as defence in depth
# against them landing in publicly visible CI logs.
if [ "$EMAIL_ONLY" = true ]; then
    echo "Creating group: $1"
    echo "Owner: (withheld from logs)"
else
    echo "Creating group: $1"
    echo "Owner: $2 ($3)"
fi
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
    # Config comes from the environment (CI) or from .prod.vars (break-glass
    # local use, written by setup-prod). Environment values win.
    if [ -f .prod.vars ] && [ -z "${FRONTEND_URL:-}" ]; then
        # shellcheck source=/dev/null
        source .prod.vars
    fi
    if [ -z "${FRONTEND_URL:-}" ]; then
        FRONTEND_URL="https://photodrop.pages.dev"
        echo "Warning: FRONTEND_URL not configured, using default URL"
    fi
    if [ -z "${EMAIL_FROM:-}" ] && [ -n "${DOMAIN:-}" ]; then
        EMAIL_FROM="photodrop <noreply@$DOMAIN>"
    fi
else
    FRONTEND_URL="http://localhost:5173"
fi

# In email-only mode the email is the sole way the owner receives their magic
# link, so fail before touching the database if sending cannot possibly work.
if [ "$EMAIL_ONLY" = true ] && { [ -z "${RESEND_API_KEY:-}" ] || [ -z "${EMAIL_FROM:-}" ]; }; then
    echo "Error: --email-only requires RESEND_API_KEY and EMAIL_FROM to be set"
    exit 1
fi

# Check if user already exists
EXISTING_USER=$(wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
SELECT id FROM users WHERE email = '$SQL_OWNER_EMAIL';
" 2>&1 | grep -oE '[a-f0-9]{32}' | head -1 || true)

if [ -n "$EXISTING_USER" ]; then
    USER_ID="$EXISTING_USER"
    echo "Found existing user (ID: $USER_ID)"
else
    # Create new user
    USER_ID=$(generate_id)
    # Pick a random profile color
    PROFILE_COLORS=("terracotta" "coral" "amber" "rust" "clay" "copper" "sienna" "sage" "olive" "forest" "moss" "jade" "slate" "ocean" "teal" "indigo" "plum" "wine" "mauve" "rose")
    RANDOM_COLOR=${PROFILE_COLORS[$((RANDOM % ${#PROFILE_COLORS[@]}))]}
    wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO users (id, name, email, profile_color, created_at)
VALUES ('$USER_ID', '$SQL_OWNER_NAME', '$SQL_OWNER_EMAIL', '$RANDOM_COLOR', $NOW);
"
    echo "Created new user (ID: $USER_ID)"
fi

# Reuse an existing group with the same owner and name — unique per migration
# 0017, which makes (owner_id, name) a safe idempotency key — so a run that
# failed partway (e.g. email delivery) can be retried without creating
# duplicates. The lookup fails closed: a wrangler or parse error aborts the
# script (set -e) rather than falling through to a duplicate insert.
GROUP_LOOKUP=$(wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --json --command "
SELECT id FROM groups WHERE owner_id = '$USER_ID' AND name = '$SQL_GROUP_NAME';
")
EXISTING_GROUP=$(printf '%s' "$GROUP_LOOKUP" | node -e '
let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  const id = JSON.parse(data)[0]?.results?.[0]?.id;
  if (id) process.stdout.write(id);
});
')

if [ -n "$EXISTING_GROUP" ]; then
    GROUP_ID="$EXISTING_GROUP"
    echo "Found existing group (ID: $GROUP_ID)"
else
    wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO groups (id, name, owner_id, created_at)
VALUES ('$GROUP_ID', '$SQL_GROUP_NAME', '$USER_ID', $NOW);
"
    echo "Created group (ID: $GROUP_ID)"
fi

# Create membership for owner (with 'admin' role - owner is identified via
# groups.owner_id). OR IGNORE keeps retried runs idempotent.
wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT OR IGNORE INTO memberships (user_id, group_id, role, joined_at)
VALUES ('$USER_ID', '$GROUP_ID', 'admin', $NOW);
"
echo "Ensured owner membership"

# Create magic link token for initial login
wrangler d1 execute "$DB_NAME" $WRANGLER_REMOTE_FLAG --command "
INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at)
VALUES ('$TOKEN', '$GROUP_ID', '$SQL_OWNER_EMAIL', 'login', NULL, $NOW, $EXPIRES_AT);
"
echo "Created magic link token"

MAGIC_LINK="$FRONTEND_URL/auth/$TOKEN"

# In production, send email via Resend API
EMAIL_SENT=false
if [ "$IS_PROD" = true ] && [ -n "${RESEND_API_KEY:-}" ] && [ -n "${EMAIL_FROM:-}" ]; then
    echo "Sending invite email..."

    # Build the request body with a real JSON encoder, and HTML-escape the
    # user-supplied names where they land in markup. The payload goes via a
    # temp file: a heredoc inside $() trips a parser bug in macOS's bash 3.2.
    EMAIL_PAYLOAD_FILE=$(mktemp)
    trap 'rm -f "$EMAIL_PAYLOAD_FILE"' EXIT
    RAW_GROUP_NAME="$1" RAW_OWNER_NAME="$2" RAW_OWNER_EMAIL="$3" \
    RAW_EMAIL_FROM="$EMAIL_FROM" RAW_MAGIC_LINK="$MAGIC_LINK" \
    node > "$EMAIL_PAYLOAD_FILE" <<'NODE'
const escapeHtml = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const groupName = escapeHtml(process.env.RAW_GROUP_NAME);
const ownerName = escapeHtml(process.env.RAW_OWNER_NAME);
const magicLink = process.env.RAW_MAGIC_LINK;

process.stdout.write(
  JSON.stringify({
    from: process.env.RAW_EMAIL_FROM,
    to: process.env.RAW_OWNER_EMAIL,
    subject: `Welcome to ${process.env.RAW_GROUP_NAME}!`,
    html: `<h1>Welcome to photodrop!</h1><p>Hi ${ownerName}!</p><p>Your group <strong>${groupName}</strong> has been created.</p><p>Click the link below to get started (expires in 15 minutes):</p><p><a href='${magicLink}'>${magicLink}</a></p>`,
  }),
);
NODE

    EMAIL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.resend.com/emails" \
        -H "Authorization: Bearer $RESEND_API_KEY" \
        -H "Content-Type: application/json" \
        --data-binary @"$EMAIL_PAYLOAD_FILE")

    HTTP_CODE=$(echo "$EMAIL_RESPONSE" | tail -n1)
    if [ "$HTTP_CODE" = "200" ]; then
        EMAIL_SENT=true
        echo "Email sent successfully!"
    else
        echo "Warning: Failed to send email (HTTP $HTTP_CODE)"
        echo "Response: $(echo "$EMAIL_RESPONSE" | head -n -1)"
    fi
fi

if [ "$EMAIL_ONLY" = true ] && [ "$EMAIL_SENT" != true ]; then
    echo ""
    echo "Error: The invite email could not be sent, and --email-only forbids"
    echo "printing the magic link. Fix the email problem and re-run with the"
    echo "same inputs: the run is idempotent, so the existing user and group"
    echo "are reused and a fresh magic link is issued."
    exit 1
fi

echo ""
echo "=========================================="
echo "Setup complete!"
echo ""
if [ "$EMAIL_ONLY" = true ]; then
    echo "Invite email sent to the owner's address."
    echo "The magic link expires in 15 minutes."
elif [ "$EMAIL_SENT" = true ]; then
    echo "Invite email sent to: $3"
    echo ""
    echo "Magic link (for reference):"
    echo "$MAGIC_LINK"
else
    echo "Magic link (expires in 15 minutes):"
    echo "$MAGIC_LINK"
fi
echo "=========================================="
