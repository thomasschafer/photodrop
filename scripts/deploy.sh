#!/bin/bash

# Photodrop deployment script
# Deploys to production environment from local machine

set -e  # Exit on error

echo "🚀 Photodrop Production Deployment"
echo "==================================="
echo ""

# Check if production config exists and is configured
if [ ! -f "backend/wrangler.production.toml" ]; then
    echo "❌ wrangler.production.toml not found."
    exit 1
fi

if grep -q "your-database-id-here" backend/wrangler.production.toml; then
    echo "❌ wrangler.production.toml is not configured yet."
    echo "Run 'npm run setup:prod' first to create production resources."
    exit 1
fi

# Run backend tests
echo "🧪 Running backend tests..."
cd backend
npm run test:run
echo "✅ Tests passed"
echo ""

# Deploy Worker
echo "📦 Deploying Worker to production..."
npx wrangler deploy --config wrangler.production.toml
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
