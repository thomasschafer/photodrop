#!/bin/bash

# Photodrop deployment script
# Deploys to production environment with custom domain
#
# Usage:
#   Local:  ./scripts/deploy.sh (loads from backend/.prod.vars)
#   CI:     Requires environment variables set

set -eo pipefail

echo "Photodrop Production Deployment"
echo "================================"
echo ""

# Navigate to backend directory
cd "$(dirname "$0")/../backend"

# Load environment variables
# Priority: 1) Already set (CI), 2) From .prod.vars (local)
if [ -f .prod.vars ] && [ -z "${D1_DATABASE_ID:-}" ]; then
    echo "Loading configuration from .prod.vars..."
    # shellcheck source=/dev/null
    source .prod.vars
fi

# Validate required environment variables
REQUIRED_VARS=(
    "D1_DATABASE_ID"
    "JWT_SECRET"
    "VAPID_PUBLIC_KEY"
    "VAPID_PRIVATE_KEY"
    "DOMAIN"
    "API_DOMAIN"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        echo "Error: Required variable $var is not set"
        echo "Run 'nix run .#setup-prod' first"
        exit 1
    fi
done

# For local deploys, require RESEND_API_KEY (email is required for the app to work)
if [ -f .prod.vars ] && [ -z "${RESEND_API_KEY:-}" ]; then
    echo "Error: RESEND_API_KEY is not set in .prod.vars"
    echo ""
    echo "Email is required for magic link authentication."
    echo "See README.md → 'Email setup (Resend)'"
    exit 1
fi

echo "Configuration loaded"
echo "  Frontend: https://$DOMAIN"
echo "  API:      https://$API_DOMAIN"
echo ""

# Generate production wrangler config (separate from dev config)
echo "Generating wrangler.prod.toml..."
cat > wrangler.prod.toml << EOF
name = "photodrop-api"
main = "src/index.ts"
compatibility_date = "2025-01-04"
compatibility_flags = ["nodejs_compat"]

# Environment variables (non-secret)
[vars]
FRONTEND_URL = "https://$DOMAIN"
ENVIRONMENT = "production"
EMAIL_FROM = "photodrop <noreply@$DOMAIN>"

[[d1_databases]]
binding = "DB"
database_name = "photodrop-db-prod"
database_id = "$D1_DATABASE_ID"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "photodrop-photos-prod"
EOF
echo "Generated wrangler.prod.toml"
echo ""

# Install dependencies if needed
echo "Installing backend dependencies..."
npm install

# Build backend to catch type errors
echo "Building backend..."
npm run build
echo "Build passed"
echo ""

# Apply database migrations
echo "Applying database migrations..."
npx --yes wrangler d1 migrations apply photodrop-db-prod --remote --config wrangler.prod.toml
echo "Migrations applied"
echo ""

# Deploy Worker first (creates it if it doesn't exist)
echo "Deploying Worker..."
if ! npx --yes wrangler deploy --config wrangler.prod.toml; then
    echo "Error: Worker deployment failed"
    exit 1
fi

echo "Worker deployed"
echo ""

# Set Worker secrets only in CI (local deploys use secrets set by setup-prod)
if [ ! -f .prod.vars ]; then
    echo "Setting Worker secrets (CI mode)..."

    if ! echo "$JWT_SECRET" | npx --yes wrangler secret put JWT_SECRET --config wrangler.prod.toml; then
        echo "Error: Failed to set JWT_SECRET"
        exit 1
    fi

    if ! echo "$VAPID_PUBLIC_KEY" | npx --yes wrangler secret put VAPID_PUBLIC_KEY --config wrangler.prod.toml; then
        echo "Error: Failed to set VAPID_PUBLIC_KEY"
        exit 1
    fi

    if ! echo "$VAPID_PRIVATE_KEY" | npx --yes wrangler secret put VAPID_PRIVATE_KEY --config wrangler.prod.toml; then
        echo "Error: Failed to set VAPID_PRIVATE_KEY"
        exit 1
    fi

    # RESEND_API_KEY is optional - only set if provided
    if [ -n "${RESEND_API_KEY:-}" ]; then
        if ! echo "$RESEND_API_KEY" | npx --yes wrangler secret put RESEND_API_KEY --config wrangler.prod.toml; then
            echo "Error: Failed to set RESEND_API_KEY"
            exit 1
        fi
    fi

    echo "Worker secrets configured"
    echo ""
else
    echo "Skipping secrets (already set by setup-prod)"
    echo ""
fi

# Build and deploy frontend
echo "Building frontend..."
cd ../frontend

echo "Installing frontend dependencies..."
npm install

# Build frontend (API URL is derived from hostname at runtime)
if ! npm run build; then
    echo "Error: Frontend build failed"
    exit 1
fi
echo "Frontend built"
echo ""

echo "Deploying frontend to Pages..."
PAGES_PROJECT="${PAGES_PROJECT:-photodrop}"
if ! npx --yes wrangler pages deploy dist --project-name="$PAGES_PROJECT"; then
    echo "Error: Frontend deployment failed"
    exit 1
fi
echo "Frontend deployed"
echo ""

# Health check
echo "Running health check..."
sleep 3

HEALTH_URL="https://$API_DOMAIN/health"
if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Health check passed: $HEALTH_URL"
else
    echo "Warning: Health check failed on $HEALTH_URL"
    echo "The custom domain route may take a few minutes to activate."
    echo "Check Cloudflare DNS if this persists."
fi
echo ""

echo "================================"
echo "Deployment complete!"
echo "================================"
echo ""
echo "  Frontend: https://$DOMAIN"
echo "  API:      https://$API_DOMAIN"
echo ""
