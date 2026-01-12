#!/bin/bash

# Photodrop setup script
#
# Usage:
#   Local development:  ./scripts/setup.sh dev   (generates .dev.vars only, no Cloudflare login needed)
#   Production:         ./scripts/setup.sh prod  (creates Cloudflare resources, requires login)

set -eo pipefail

ENV=${1:-dev}

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 [dev|prod]"
    echo "  dev  - Set up local development (default)"
    echo "  prod - Set up production (requires Cloudflare login)"
    exit 1
fi

echo "Setting up $ENV environment..."
echo ""

cd "$(dirname "$0")/../backend"

# Check for required tools
if ! command -v openssl &> /dev/null; then
    echo "Error: OpenSSL is required"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required"
    exit 1
fi

#
# DEV SETUP - Local only, no Cloudflare resources needed
#
if [ "$ENV" = "dev" ]; then
    if [ -f .dev.vars ]; then
        echo ".dev.vars already exists, skipping"
    else
        echo "Generating secrets..."
        JWT_SECRET=$(openssl rand -base64 32)

        # Generate VAPID keys
        VAPID_OUTPUT=$(npx --yes web-push generate-vapid-keys --json)
        VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | grep -o '"publicKey":"[^"]*' | sed 's/"publicKey":"//')
        VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | grep -o '"privateKey":"[^"]*' | sed 's/"privateKey":"//')
        if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ]; then
            echo "Error: Failed to generate VAPID keys"
            exit 1
        fi

        cat > .dev.vars << EOF
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
FRONTEND_URL=http://localhost:5173
EOF
        chmod 600 .dev.vars
        echo "Created .dev.vars"
    fi

    echo ""
    echo "Dev setup complete! See README.md for next steps."
    exit 0
fi

#
# PROD SETUP - Creates real Cloudflare resources
#
echo "Production setup requires Cloudflare authentication..."
echo ""

# Check wrangler availability
if command -v wrangler &> /dev/null; then
    WRANGLER_CMD="wrangler"
else
    WRANGLER_CMD="npx --yes wrangler"
fi

# Check authentication
if ! $WRANGLER_CMD whoami &> /dev/null; then
    echo "Not logged in to Cloudflare. Running wrangler login..."
    $WRANGLER_CMD login
fi
echo "Authenticated with Cloudflare"
echo ""

# Get account ID from wrangler whoami output
# The output contains a table with "Account ID" column - extract the hex ID
# Try 32-char format first, then UUID format (with dashes)
WHOAMI_OUTPUT=$($WRANGLER_CMD whoami 2>&1 || true)
ACCOUNT_ID=$(echo "$WHOAMI_OUTPUT" | grep -oEi '[a-f0-9]{32}' | head -1 || true)
if [ -z "$ACCOUNT_ID" ]; then
    # Try UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    ACCOUNT_ID=$(echo "$WHOAMI_OUTPUT" | grep -oEi '[a-f0-9-]{36}' | head -1 || true)
fi
if [ -z "$ACCOUNT_ID" ]; then
    echo "Could not determine Cloudflare account ID."
    echo "Please enter your Cloudflare Account ID (found in Workers & Pages dashboard URL):"
    read -r ACCOUNT_ID
fi
echo "Using account: $ACCOUNT_ID"
echo ""

#
# DOMAIN CONFIGURATION
#
echo "=== Domain Configuration ==="
echo ""
echo "Enter your root domain (must already be in your Cloudflare account):"
echo "  Example: example.com"
echo ""
read -rp "Root domain: " ZONE_NAME

if [ -z "$ZONE_NAME" ]; then
    echo "Error: Domain is required"
    exit 1
fi

echo ""
echo "Would you like to use a subdomain? (leave empty for apex domain)"
echo "  Example: entering 'photos' → photos.$ZONE_NAME"
echo ""
read -rp "Subdomain (optional): " SUBDOMAIN

if [ -n "$SUBDOMAIN" ]; then
    DOMAIN="${SUBDOMAIN}.${ZONE_NAME}"
else
    DOMAIN="$ZONE_NAME"
fi

API_DOMAIN="api.$DOMAIN"

echo ""
echo "Frontend will be at: https://$DOMAIN"
echo "API will be at:      https://$API_DOMAIN"
echo "Zone (root domain):  $ZONE_NAME"
echo ""
read -rp "Is this correct? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted. Please run setup again."
    exit 1
fi
echo ""

DB_NAME="photodrop-db-prod"
BUCKET_NAME="photodrop-photos-prod"
PAGES_PROJECT="photodrop"

# Create D1 database
echo "Creating D1 database ($DB_NAME)..."
DATABASE_ID=$($WRANGLER_CMD d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid" 2>/dev/null | head -1 || true)

if [ -n "$DATABASE_ID" ]; then
    echo "Database already exists: $DATABASE_ID"
else
    OUTPUT=$($WRANGLER_CMD d1 create "$DB_NAME" 2>&1)
    # Match UUID format: 8-4-4-4-12 hex characters
    DATABASE_ID=$(echo "$OUTPUT" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)
    if [ -z "$DATABASE_ID" ]; then
        echo "Failed to create database"
        echo "$OUTPUT"
        exit 1
    fi
    echo "Created database: $DATABASE_ID"
fi
echo ""

# Create R2 bucket
echo "Creating R2 bucket ($BUCKET_NAME)..."
if $WRANGLER_CMD r2 bucket list 2>/dev/null | grep -q "$BUCKET_NAME"; then
    echo "Bucket already exists"
else
    if ! $WRANGLER_CMD r2 bucket create "$BUCKET_NAME" 2>&1; then
        echo "Failed to create bucket"
        exit 1
    fi
    echo "Created bucket"
fi
echo ""

# Create Pages project
echo "Creating Pages project ($PAGES_PROJECT)..."
if $WRANGLER_CMD pages project list 2>/dev/null | grep -q "$PAGES_PROJECT"; then
    echo "Pages project already exists"
else
    if ! $WRANGLER_CMD pages project create "$PAGES_PROJECT" --production-branch main 2>&1; then
        echo "Error: Failed to create Pages project"
        exit 1
    fi
    echo "Created Pages project"
fi
echo ""

# Generate secrets if needed
if [ -f .prod.vars ]; then
    echo "Loading existing secrets from .prod.vars..."
    # shellcheck source=/dev/null
    source .prod.vars
else
    echo "Generating new secrets..."
    JWT_SECRET=$(openssl rand -base64 32)
    VAPID_OUTPUT=$(npx --yes web-push generate-vapid-keys --json)
    VAPID_PUBLIC_KEY=$(echo "$VAPID_OUTPUT" | grep -o '"publicKey":"[^"]*' | sed 's/"publicKey":"//')
    VAPID_PRIVATE_KEY=$(echo "$VAPID_OUTPUT" | grep -o '"privateKey":"[^"]*' | sed 's/"privateKey":"//')
    if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
        echo "Error: Failed to generate VAPID keys"
        exit 1
    fi
fi

# Save prod vars (with domain info)
cat > .prod.vars << EOF
# Domain configuration
DOMAIN=$DOMAIN
API_DOMAIN=$API_DOMAIN
ZONE_NAME=$ZONE_NAME

# Cloudflare resources
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID
D1_DATABASE_ID=$DATABASE_ID
PAGES_PROJECT=$PAGES_PROJECT

# Secrets (keep these secure!)
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY

# URLs
FRONTEND_URL=https://$DOMAIN
API_URL=https://$API_DOMAIN
EOF
chmod 600 .prod.vars
echo "Saved .prod.vars"
echo ""

# Generate wrangler.prod.toml for migrations and deployment
echo "Generating wrangler.prod.toml..."
cat > wrangler.prod.toml << EOF
name = "photodrop-api"
main = "src/index.ts"
compatibility_date = "2025-01-04"
compatibility_flags = ["nodejs_compat"]

routes = [
  { pattern = "$API_DOMAIN/*", zone_name = "$ZONE_NAME" }
]

[vars]
FRONTEND_URL = "https://$DOMAIN"
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "$DB_NAME"
database_id = "$DATABASE_ID"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "$BUCKET_NAME"
EOF
echo "Generated wrangler.prod.toml"
echo ""

# Run migrations
echo "Running database migrations..."
$WRANGLER_CMD d1 migrations apply "$DB_NAME" --remote --config wrangler.prod.toml
echo ""

# Deploy Worker to create the route (one-time setup)
echo "Deploying Worker to create route..."
if ! $WRANGLER_CMD deploy --config wrangler.prod.toml; then
    echo "Error: Initial Worker deployment failed"
    exit 1
fi
echo "Worker deployed with route: $API_DOMAIN/*"

echo ""
echo "==========================================="
echo "Production setup complete!"
echo "==========================================="
echo ""
echo "  Frontend: https://$DOMAIN"
echo "  API:      https://$API_DOMAIN"
echo ""
echo "Configuration saved to .prod.vars"
echo ""
echo "NEXT: Set up email before deploying."
echo "      See README.md → 'Email setup (Resend)'"
echo ""
