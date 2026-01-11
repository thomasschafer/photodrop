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
    "ZONE_NAME"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        echo "Error: Required variable $var is not set"
        echo "Run 'nix run .#setup-prod' first"
        exit 1
    fi
done

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

# Custom domain route
routes = [
  { pattern = "$API_DOMAIN/*", zone_name = "$ZONE_NAME" }
]

# Environment variables (non-secret)
[vars]
FRONTEND_URL = "https://$DOMAIN"
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "photodrop-db-prod"
database_id = "$D1_DATABASE_ID"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "photodrop-photos-prod"
EOF
echo "Generated wrangler.prod.toml with route: $API_DOMAIN/*"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm ci
fi

# Run backend tests
echo "Running backend tests..."
npm run test:run
echo "Tests passed"
echo ""

# Set Worker secrets
echo "Setting Worker secrets..."
echo "$JWT_SECRET" | npx --yes wrangler secret put JWT_SECRET --config wrangler.prod.toml
echo "$VAPID_PUBLIC_KEY" | npx --yes wrangler secret put VAPID_PUBLIC_KEY --config wrangler.prod.toml
echo "$VAPID_PRIVATE_KEY" | npx --yes wrangler secret put VAPID_PRIVATE_KEY --config wrangler.prod.toml
echo "Worker secrets configured"
echo ""

# Apply database migrations
echo "Applying database migrations..."
npx --yes wrangler d1 migrations apply photodrop-db-prod --remote --config wrangler.prod.toml
echo "Migrations applied"
echo ""

# Deploy Worker
echo "Deploying Worker..."
WORKER_OUTPUT=$(npx --yes wrangler deploy --config wrangler.prod.toml 2>&1)
WORKER_EXIT_CODE=$?
echo "$WORKER_OUTPUT"

if [ $WORKER_EXIT_CODE -ne 0 ]; then
    echo "Error: Worker deployment failed"
    exit 1
fi

echo "Worker deployed"
echo ""

# Build and deploy frontend
echo "Building frontend..."
cd ../frontend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm ci
fi

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
echo "Your app is live at:"
echo "  Frontend: https://$DOMAIN"
echo "  API:      https://$API_DOMAIN"
echo ""
echo "If this is your first deploy, you need to set up the Pages custom domain:"
echo "  1. Go to: https://dash.cloudflare.com/"
echo "  2. Navigate to: Workers & Pages > photodrop > Custom domains"
echo "  3. Add custom domain: $DOMAIN"
echo "  4. Cloudflare will auto-configure DNS"
echo ""
echo "Then create your first group:"
echo "  nix run .#create-group -- \"My Group\" \"Your Name\" \"you@example.com\" --prod"
echo ""
echo "View magic links in logs:"
echo "  wrangler tail"
echo ""
