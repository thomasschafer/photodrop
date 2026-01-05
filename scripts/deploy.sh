#!/bin/bash

# Photodrop deployment script
# Deploys to production environment
#
# Usage:
#   Local:  ./scripts/deploy.sh (loads from backend/.prod.vars)
#   CI:     Requires environment variables set

set -eo pipefail  # Exit on error and propagate errors in pipes

echo "🚀 Photodrop Production Deployment"
echo "==================================="
echo ""

# Navigate to backend directory
cd "$(dirname "$0")/../backend"

# Load environment variables
# Priority: 1) Already set (CI), 2) From .prod.vars (local)
if [ -f .prod.vars ] && [ -z "${D1_DATABASE_ID:-}" ]; then
    echo "📦 Loading configuration from .prod.vars..."
    source .prod.vars
fi

# Validate required environment variables
REQUIRED_VARS=(
    "D1_DATABASE_ID"
    "JWT_SECRET"
    "VAPID_PUBLIC_KEY"
    "VAPID_PRIVATE_KEY"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        echo "❌ Required environment variable $var is not set"
        echo "   Run 'nix run .#setup-prod' first to generate secrets"
        exit 1
    fi
done

echo "✅ Configuration loaded"
echo ""

# Generate wrangler.toml from template and environment variables
echo "📝 Generating wrangler.toml from environment..."
cat > wrangler.toml << EOF
name = "photodrop-api"
main = "src/index.ts"
compatibility_date = "2025-01-04"

[[d1_databases]]
binding = "DB"
database_name = "photodrop-db-prod"
database_id = "$D1_DATABASE_ID"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "photodrop-photos-prod"
EOF
echo "✅ Configuration file generated"
echo ""

# Run backend tests
echo "🧪 Running backend tests..."
npm run test:run
echo "✅ Tests passed"
echo ""

# Set Worker secrets
echo "🔐 Setting Worker secrets..."
if ! echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET --config wrangler.toml; then
    echo "❌ Failed to set JWT_SECRET"
    exit 1
fi
if ! echo "$VAPID_PUBLIC_KEY" | npx wrangler secret put VAPID_PUBLIC_KEY --config wrangler.toml; then
    echo "❌ Failed to set VAPID_PUBLIC_KEY"
    exit 1
fi
if ! echo "$VAPID_PRIVATE_KEY" | npx wrangler secret put VAPID_PRIVATE_KEY --config wrangler.toml; then
    echo "❌ Failed to set VAPID_PRIVATE_KEY"
    exit 1
fi
echo "✅ Worker secrets set"
echo ""

# Apply database migrations
echo "🗄️  Applying database migrations..."
if ! npx wrangler d1 migrations apply photodrop-db-prod --config wrangler.toml; then
    echo "❌ Failed to apply migrations"
    exit 1
fi
echo "✅ Migrations applied"
echo ""

# Deploy Worker
echo "📦 Deploying Worker to production..."
npx wrangler deploy --config wrangler.toml
echo "✅ Worker deployed"
echo ""

# Deploy frontend
echo "📦 Building and deploying frontend..."
cd ../frontend
npm run build
npx wrangler pages deploy dist --project-name=photodrop
echo "✅ Frontend deployed"
echo ""

# Health check
echo "🏥 Running health check..."
sleep 5
if curl -f https://photodrop-api.workers.dev/health 2>/dev/null; then
    echo "✅ Health check passed"
else
    echo "⚠️  Health check failed, but deployment may still be successful"
fi
echo ""

echo "==================================="
echo "✅ Deployment complete!"
echo ""
echo "Your app should be live at:"
echo "  - API: https://photodrop-api.workers.dev"
echo "  - Frontend: https://photodrop.pages.dev (or your custom domain)"
