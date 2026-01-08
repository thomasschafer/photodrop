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
        VAPID_OUTPUT=$(npx --yes web-push generate-vapid-keys --json 2>/dev/null)
        VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | grep -o '"publicKey":"[^"]*' | sed 's/"publicKey":"//')
        VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | grep -o '"privateKey":"[^"]*' | sed 's/"privateKey":"//')

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
    echo "Dev setup complete!"
    echo ""
    echo "Next steps:"
    echo "  nix run .#dev     # Start development servers"
    echo "  nix run .#db-seed # (Optional) Seed test users"
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
    WRANGLER_CMD="npx wrangler"
fi

# Check authentication
if ! $WRANGLER_CMD whoami &> /dev/null; then
    echo "Not logged in to Cloudflare. Running wrangler login..."
    $WRANGLER_CMD login
fi
echo "Authenticated with Cloudflare"
echo ""

DB_NAME="photodrop-db-prod"
BUCKET_NAME="photodrop-photos-prod"

# Create D1 database
echo "Creating D1 database ($DB_NAME)..."
if command -v jq &> /dev/null; then
    DATABASE_ID=$($WRANGLER_CMD d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid" 2>/dev/null | head -1)
else
    DATABASE_ID=""
fi

if [ -n "$DATABASE_ID" ]; then
    echo "Database already exists: $DATABASE_ID"
else
    OUTPUT=$($WRANGLER_CMD d1 create "$DB_NAME" 2>&1)
    DATABASE_ID=$(echo "$OUTPUT" | grep -oE '[a-f0-9-]{36}' | head -1)
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

# Generate secrets if needed
if [ -f .prod.vars ]; then
    echo "Loading existing secrets from .prod.vars..."
    source .prod.vars
else
    echo "Generating new secrets..."
    JWT_SECRET=$(openssl rand -base64 32)
    VAPID_OUTPUT=$(npx --yes web-push generate-vapid-keys --json 2>/dev/null)
    VAPID_PUBLIC_KEY=$(echo "$VAPID_OUTPUT" | grep -o '"publicKey":"[^"]*' | sed 's/"publicKey":"//')
    VAPID_PRIVATE_KEY=$(echo "$VAPID_OUTPUT" | grep -o '"privateKey":"[^"]*' | sed 's/"privateKey":"//')
fi

# Save prod vars
cat > .prod.vars << EOF
D1_DATABASE_ID=$DATABASE_ID
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
FRONTEND_URL=https://photodrop.pages.dev
EOF
chmod 600 .prod.vars
echo "Saved .prod.vars"
echo ""

# Run migrations
echo "Running database migrations..."
$WRANGLER_CMD d1 migrations apply "$DB_NAME" --remote
echo ""

# Save GitHub secrets reference
cat > .prod.secrets.txt << EOF
GitHub Secrets for Production Deployment
========================================

Add these to: Settings > Secrets and variables > Actions

CLOUDFLARE_API_TOKEN    = (create at https://dash.cloudflare.com/profile/api-tokens)
CLOUDFLARE_ACCOUNT_ID   = (from Workers & Pages dashboard)
D1_DATABASE_ID          = $DATABASE_ID
JWT_SECRET              = $JWT_SECRET
VAPID_PUBLIC_KEY        = $VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY       = $VAPID_PRIVATE_KEY
EOF
chmod 600 .prod.secrets.txt

echo "Production setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add secrets to GitHub (see backend/.prod.secrets.txt)"
echo "  2. Update FRONTEND_URL in .prod.vars"
echo "  3. Deploy with: nix run .#deploy"
