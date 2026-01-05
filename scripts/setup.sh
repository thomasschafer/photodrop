#!/bin/bash

# Photodrop infrastructure setup script
# This script automates the creation of Cloudflare resources and local configuration
#
# Usage:
#   Local development:  ./scripts/setup.sh dev
#   Production:         ./scripts/setup.sh prod
#
# CI/CD Usage:
#   This script automatically detects CI environments (GitHub Actions, GitLab CI, CircleCI).
#   Required environment variables for CI (production):
#     - CLOUDFLARE_API_TOKEN      (for authentication)
#     - CLOUDFLARE_ACCOUNT_ID     (your Cloudflare account ID)
#     - D1_DATABASE_ID            (production database UUID from setup)
#     - JWT_SECRET                (your JWT signing secret)
#     - VAPID_PUBLIC_KEY          (web push public key)
#     - VAPID_PRIVATE_KEY         (web push private key)
#
#   Optional:
#     - SETUP_NON_INTERACTIVE=true  (skip interactive prompts)
#
# Example GitHub Actions usage:
#   - name: Setup infrastructure
#     env:
#       CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
#       CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
#       D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}
#       JWT_SECRET: ${{ secrets.JWT_SECRET }}
#       VAPID_PUBLIC_KEY: ${{ secrets.VAPID_PUBLIC_KEY }}
#       VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
#       SETUP_NON_INTERACTIVE: true
#     run: ./scripts/setup.sh prod
#
# Note: For production, run setup locally first to create resources and generate
#       secrets, then add them to GitHub. CI uses these secrets for deployment.

set -eo pipefail  # Exit on error and propagate errors in pipes

# Parse environment argument (dev or prod)
ENV=${1:-dev}

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
    echo "Usage: $0 [dev|prod]"
    echo "  dev  - Set up development environment (default)"
    echo "  prod - Set up production environment"
    exit 1
fi

echo "🚀 Photodrop Infrastructure Setup ($ENV)"
echo "=================================="
echo ""

# Detect CI environment
CI_MODE="false"
if [[ -n "${CI:-}" ]] || [[ -n "${GITHUB_ACTIONS:-}" ]] || [[ -n "${GITLAB_CI:-}" ]] || [[ -n "${CIRCLECI:-}" ]]; then
    CI_MODE="true"
    echo "🤖 CI environment detected"
fi

# Check for required tools
if ! command -v openssl &> /dev/null; then
    echo "❌ OpenSSL is not installed"
    exit 1
fi

# Check if wrangler is available
if command -v wrangler &> /dev/null; then
    WRANGLER_CMD="wrangler"
elif command -v npx &> /dev/null; then
    echo "📦 Using wrangler via npx..."
    WRANGLER_CMD="npx wrangler"
else
    echo "❌ Wrangler not found and npx not available"
    exit 1
fi

# Check authentication
if [[ "$CI_MODE" == "true" ]]; then
    # CI mode - require token
    if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
        echo "❌ CLOUDFLARE_API_TOKEN environment variable required in CI"
        exit 1
    fi
    if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
        echo "❌ CLOUDFLARE_ACCOUNT_ID environment variable required in CI"
        exit 1
    fi
    echo "✅ Cloudflare credentials found (API token)"
else
    # Local mode - check if logged in
    if ! $WRANGLER_CMD whoami &> /dev/null; then
        echo "❌ Not logged in to Cloudflare. Please log in..."
        $WRANGLER_CMD login
    fi
    echo "✅ Wrangler is authenticated"
fi
echo ""

# Navigate to backend directory
BACKEND_DIR="$(dirname "$0")/../backend"
if [ ! -d "$BACKEND_DIR" ]; then
    echo "❌ Backend directory not found at $BACKEND_DIR"
    exit 1
fi
cd "$BACKEND_DIR"

# Set resource names based on environment
DB_NAME="photodrop-db-${ENV}"
BUCKET_NAME="photodrop-photos-${ENV}"

# Create D1 database
echo "📦 Creating D1 database ($DB_NAME)..."
# Try to get existing database ID first
# Use jq if available, otherwise parse the output manually
if command -v jq &> /dev/null; then
    DATABASE_ID=$($WRANGLER_CMD d1 list --json 2>/dev/null | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid" 2>/dev/null | head -1)
else
    # Parse table output - get all UUIDs and names, find matching pair
    D1_OUTPUT=$($WRANGLER_CMD d1 list 2>&1)
    # Extract UUID from the line containing the database
    # The UUID is on a separate line from the name, so we need to be smart
    DATABASE_ID=$(echo "$D1_OUTPUT" | grep -E '^[[:space:]]*[a-f0-9-]{36}' | head -1 | awk '{print $1}')
fi

if [ -n "$DATABASE_ID" ]; then
    echo "⚠️  Database '$DB_NAME' already exists (ID: $DATABASE_ID)"
else
    # Database doesn't exist, create it
    echo "Creating new database..."
    OUTPUT=$($WRANGLER_CMD d1 create "$DB_NAME" 2>&1)
    echo "Wrangler output:"
    echo "$OUTPUT"
    echo ""

    if echo "$OUTPUT" | grep -q "already exists"; then
        # Race condition - database was created between check and create
        echo "⚠️  Database '$DB_NAME' was just created"
        DATABASE_ID=$($WRANGLER_CMD d1 list 2>&1 | grep "$DB_NAME" | awk '{print $2}' | head -1)
    else
        # Try multiple extraction patterns
        DATABASE_ID=$(echo "$OUTPUT" | grep -E "database_id|database-id" | sed -n 's/.*database[_-]id[" =:]*\([a-f0-9-]*\).*/\1/p' | head -1)
        if [ -n "$DATABASE_ID" ]; then
            echo "✅ Database created: $DATABASE_ID"
        else
            echo "⚠️ Could not extract database ID from output, checking list..."
            DATABASE_ID=$($WRANGLER_CMD d1 list 2>&1 | grep "$DB_NAME" | awk '{print $2}' | head -1)
        fi
    fi
fi

if [ -z "$DATABASE_ID" ]; then
    echo "❌ Failed to get or create database"
    echo "Debug: listing all databases..."
    $WRANGLER_CMD d1 list
    exit 1
fi
echo ""

# Create R2 bucket
echo "📦 Creating R2 bucket ($BUCKET_NAME)..."
# Check if bucket already exists
if $WRANGLER_CMD r2 bucket list 2>/dev/null | grep -q "$BUCKET_NAME"; then
    echo "⚠️  Bucket '$BUCKET_NAME' already exists"
else
    # Try to create bucket
    BUCKET_OUTPUT=$($WRANGLER_CMD r2 bucket create "$BUCKET_NAME" 2>&1) || true
    if echo "$BUCKET_OUTPUT" | grep -q "already exists"; then
        echo "⚠️  Bucket '$BUCKET_NAME' already exists"
    elif echo "$BUCKET_OUTPUT" | grep -q "Created bucket"; then
        echo "✅ Bucket created: $BUCKET_NAME"
    else
        echo "❌ Failed to create bucket: $BUCKET_NAME"
        echo "$BUCKET_OUTPUT"
        exit 1
    fi
fi
echo ""

# Generate wrangler config
if [ "$ENV" = "dev" ]; then
    if [ -f wrangler.toml ]; then
        echo "⚠️  wrangler.toml already exists, backing up to wrangler.toml.bak"
        cp wrangler.toml wrangler.toml.bak
    fi
    echo "📝 Creating wrangler.toml for development..."
    cat > wrangler.toml << EOF
name = "photodrop-api"
main = "src/index.ts"
compatibility_date = "2025-01-04"

[[d1_databases]]
binding = "DB"
database_name = "$DB_NAME"
database_id = "$DATABASE_ID"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "$BUCKET_NAME"
EOF
    echo "✅ wrangler.toml created for development"
else
    echo "✅ Production resources created (database ID saved to .prod.vars)"
    echo "   wrangler.production.toml remains as a template (not modified)"
fi
echo ""

# Generate or load secrets
# Priority: 1) Environment variables (for CI), 2) Existing file, 3) Generate new
VARS_FILE=".${ENV}.vars"

# Check if secrets are provided via environment variables (CI mode)
if [[ -n "${JWT_SECRET:-}" ]] && [[ -n "${VAPID_PUBLIC_KEY:-}" ]] && [[ -n "${VAPID_PRIVATE_KEY:-}" ]]; then
    echo "🔐 Using secrets from environment variables..."
    VAPID_PUBLIC="$VAPID_PUBLIC_KEY"
    VAPID_PRIVATE="$VAPID_PRIVATE_KEY"
    echo "✅ Secrets loaded from environment"
elif [ -f "$VARS_FILE" ]; then
    echo "🔐 Secrets file $VARS_FILE already exists, reusing existing secrets..."
    # Load existing secrets
    source "$VARS_FILE"
    if [ -z "$JWT_SECRET" ] || [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
        echo "❌ Existing secrets file is incomplete or corrupted"
        exit 1
    fi
    JWT_SECRET="$JWT_SECRET"
    VAPID_PUBLIC="$VAPID_PUBLIC_KEY"
    VAPID_PRIVATE="$VAPID_PRIVATE_KEY"
    echo "✅ Existing secrets loaded from file"
else
    echo "🔐 Generating new secrets..."
    JWT_SECRET=$(openssl rand -base64 32)
    if [ -z "$JWT_SECRET" ]; then
        echo "❌ Failed to generate JWT secret"
        exit 1
    fi
    echo "✅ JWT secret generated"

    # Generate VAPID keys using npx (no global install needed)
    echo "Generating VAPID keys..."
    VAPID_OUTPUT=$(npx --yes web-push generate-vapid-keys --json)
    VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | grep -o '"publicKey":"[^"]*' | sed 's/"publicKey":"//')
    VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | grep -o '"privateKey":"[^"]*' | sed 's/"privateKey":"//')

    if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ]; then
        echo "❌ Failed to extract VAPID keys"
        exit 1
    fi
    echo "✅ VAPID keys generated"
fi
echo ""

# Create environment variables file
if [ "$ENV" = "dev" ]; then
    if [ ! -f .dev.vars ]; then
        echo "📝 Creating .dev.vars..."
        cat > .dev.vars << EOF
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
EOF
        chmod 600 .dev.vars
        echo "✅ .dev.vars created with secure permissions"
    else
        echo "✅ .dev.vars already exists"
    fi
else
    if [ ! -f .prod.vars ]; then
        echo "📝 Creating .prod.vars..."
        cat > .prod.vars << EOF
D1_DATABASE_ID=$DATABASE_ID
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
EOF
        chmod 600 .prod.vars
        echo "✅ .prod.vars created with secure permissions (contains database ID and secrets for deployment)"
    else
        echo "✅ .prod.vars already exists"
    fi
fi
echo ""

# Run migrations
echo "🗄️  Running database migrations..."

if [ "$ENV" = "dev" ]; then
    echo "Applying local migrations..."
    if ! $WRANGLER_CMD d1 migrations apply "$DB_NAME" --local; then
        echo "❌ Failed to apply local migrations"
        exit 1
    fi
    echo "✅ Local migrations applied"
fi

echo "Applying remote migrations to $DB_NAME..."
if ! $WRANGLER_CMD d1 migrations apply "$DB_NAME"; then
    echo "❌ Failed to apply remote migrations"
    exit 1
fi
echo "✅ Remote migrations applied"
echo ""

# Set Cloudflare Worker secrets (for prod environment)
if [ "$ENV" = "prod" ]; then
    echo "🔐 Cloudflare Worker secrets"

    # Check if running in non-interactive mode or CI
    if [[ "${SETUP_NON_INTERACTIVE:-false}" == "true" ]] || [[ "$CI_MODE" == "true" ]]; then
        echo "⚠️  Skipping Worker secrets setup (non-interactive mode)"
        echo "   You can set them later manually or via CI/CD"
    else
        echo "Do you want to set Worker secrets now? (y/n)"
        read -r SET_SECRETS

        if [[ "$SET_SECRETS" =~ ^[Yy]$ ]]; then
            echo "Setting JWT_SECRET..."
            if ! echo "$JWT_SECRET" | $WRANGLER_CMD secret put JWT_SECRET --env production; then
                echo "❌ Failed to set JWT_SECRET"
                exit 1
            fi

            echo "Setting VAPID_PUBLIC_KEY..."
            if ! echo "$VAPID_PUBLIC" | $WRANGLER_CMD secret put VAPID_PUBLIC_KEY --env production; then
                echo "❌ Failed to set VAPID_PUBLIC_KEY"
                exit 1
            fi

            echo "Setting VAPID_PRIVATE_KEY..."
            if ! echo "$VAPID_PRIVATE" | $WRANGLER_CMD secret put VAPID_PRIVATE_KEY --env production; then
                echo "❌ Failed to set VAPID_PRIVATE_KEY"
                exit 1
            fi

            echo "✅ Worker secrets set for production environment"
        fi
    fi
    echo ""
fi

if [ "$ENV" = "prod" ]; then
    # Save GitHub secrets instructions to file for security
    SECRETS_FILE=".prod.secrets.txt"
    cat > "$SECRETS_FILE" << EOF
GitHub Secrets Configuration for Production
============================================

For automated deployments, add these secrets to your GitHub repository:
(Settings → Secrets and variables → Actions → New repository secret)

CLOUDFLARE_API_TOKEN
  Get from: https://dash.cloudflare.com/profile/api-tokens
  Template: Edit Cloudflare Workers

CLOUDFLARE_ACCOUNT_ID
  Get from: Dashboard → Workers & Pages → Overview (right sidebar)

D1_DATABASE_ID
  Value: $DATABASE_ID

JWT_SECRET
  Value: $JWT_SECRET

VAPID_PUBLIC_KEY
  Value: $VAPID_PUBLIC

VAPID_PRIVATE_KEY
  Value: $VAPID_PRIVATE

============================================
EOF
    chmod 600 "$SECRETS_FILE"
    echo "📋 GitHub Secrets Configuration"
    echo "================================"
    echo ""
    echo "⚠️  Production secrets have been saved to: $SECRETS_FILE"
    echo "   This file contains sensitive information. Keep it secure!"
    echo "   View it with: cat backend/$SECRETS_FILE"
    echo ""
    echo "================================"
fi

echo "✅ $ENV setup complete!"
echo ""

if [ "$ENV" = "dev" ]; then
    echo "Next steps:"
    echo "1. Run 'cd backend && npm run dev' to start backend"
    echo "2. Run 'cd frontend && npm run dev' to start frontend"
    echo "3. Visit http://localhost:5173"
else
    echo "Next steps:"
    echo "1. Add secrets from $SECRETS_FILE to GitHub (see instructions above)"
    echo "2. Deploy with 'nix run .#deploy' or push to main for automated deployment"
    echo "3. For multiple environments, create separate databases and use different secret sets"
fi
