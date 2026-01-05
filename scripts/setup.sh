#!/bin/bash

# Photodrop infrastructure setup script
# This script automates the creation of Cloudflare resources and local configuration

set -e  # Exit on error

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

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler is not installed. Installing..."
    npm install -g wrangler
fi

# Check if logged in
if ! wrangler whoami &> /dev/null; then
    echo "❌ Not logged in to Cloudflare. Please log in..."
    wrangler login
fi

echo "✅ Wrangler is installed and authenticated"
echo ""

# Navigate to backend directory
cd "$(dirname "$0")/../backend"

# Set resource names based on environment
DB_NAME="photodrop-db-${ENV}"
BUCKET_NAME="photodrop-photos-${ENV}"

# Create D1 database
echo "📦 Creating D1 database ($DB_NAME)..."
if wrangler d1 list | grep -q "$DB_NAME"; then
    echo "⚠️  Database '$DB_NAME' already exists"
    DATABASE_ID=$(wrangler d1 list | grep "$DB_NAME" | awk '{print $2}')
else
    OUTPUT=$(wrangler d1 create "$DB_NAME")
    DATABASE_ID=$(echo "$OUTPUT" | grep "database_id" | sed -n 's/.*database_id = "\(.*\)"/\1/p')
    echo "✅ Database created: $DATABASE_ID"
fi
echo ""

# Create R2 bucket
echo "📦 Creating R2 bucket ($BUCKET_NAME)..."
if wrangler r2 bucket list | grep -q "$BUCKET_NAME"; then
    echo "⚠️  Bucket '$BUCKET_NAME' already exists"
else
    wrangler r2 bucket create "$BUCKET_NAME"
    echo "✅ Bucket created: $BUCKET_NAME"
fi
echo ""

# Generate wrangler config
if [ "$ENV" = "dev" ]; then
    echo "📝 Creating wrangler.toml for development..."
    cat > wrangler.toml << EOF
name = "photodrop-api"
main = "src/index.ts"
compatibility_date = "2025-01-04"

[[d1_databases]]
binding = "DB"
database_name = "$DB_NAME"
database_id = "$DATABASE_ID"

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "$BUCKET_NAME"
EOF
    echo "✅ wrangler.toml created for development"
else
    echo "📝 Updating wrangler.production.toml with resource IDs..."
    sed -i.bak "s/^# \[\[d1_databases\]\]/[[d1_databases]]/" wrangler.production.toml
    sed -i.bak "s/^# binding = \"DB\"/binding = \"DB\"/" wrangler.production.toml
    sed -i.bak "s/^# database_name = \"photodrop-db-prod\"/database_name = \"$DB_NAME\"/" wrangler.production.toml
    sed -i.bak "s/^# database_id = \".*\"/database_id = \"$DATABASE_ID\"/" wrangler.production.toml
    sed -i.bak "s/^# \[\[r2_buckets\]\]/[[r2_buckets]]/" wrangler.production.toml
    sed -i.bak "s/^# binding = \"PHOTOS\"/binding = \"PHOTOS\"/" wrangler.production.toml
    sed -i.bak "s/^# bucket_name = \"photodrop-photos-prod\"/bucket_name = \"$BUCKET_NAME\"/" wrangler.production.toml
    rm -f wrangler.production.toml.bak

    echo "✅ wrangler.production.toml updated with database_id: $DATABASE_ID"
    echo ""
    echo "⚠️  IMPORTANT: Commit wrangler.production.toml to git:"
    echo "   git add backend/wrangler.production.toml"
    echo "   git commit -m 'Configure production database'"
fi
echo ""

# Generate secrets
echo "🔐 Generating secrets..."
JWT_SECRET=$(openssl rand -base64 32)
echo "✅ JWT secret generated"

# Check if web-push is installed
if ! command -v web-push &> /dev/null; then
    echo "Installing web-push for VAPID key generation..."
    npm install -g web-push
fi

VAPID_OUTPUT=$(web-push generate-vapid-keys --json)
VAPID_PUBLIC=$(echo "$VAPID_OUTPUT" | grep -o '"publicKey":"[^"]*' | sed 's/"publicKey":"//')
VAPID_PRIVATE=$(echo "$VAPID_OUTPUT" | grep -o '"privateKey":"[^"]*' | sed 's/"privateKey":"//')
echo "✅ VAPID keys generated"
echo ""

# Create environment variables file
if [ "$ENV" = "dev" ]; then
    echo "📝 Creating .dev.vars..."
    cat > .dev.vars << EOF
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
EOF
    echo "✅ .dev.vars created"
else
    echo "📝 Creating .prod.vars..."
    cat > .prod.vars << EOF
D1_DATABASE_ID=$DATABASE_ID
JWT_SECRET=$JWT_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
EOF
    echo "✅ .prod.vars created (contains database ID and secrets for deployment)"
fi
echo ""

# Run migrations
echo "🗄️  Running database migrations..."

if [ "$ENV" = "dev" ]; then
    echo "Running local migration..."
    wrangler d1 execute "$DB_NAME" --local --file=../migrations/001_initial_schema.sql
    echo "✅ Local migration complete"
fi

echo "Running remote migration on $DB_NAME..."
wrangler d1 execute "$DB_NAME" --file=../migrations/001_initial_schema.sql
echo "✅ Remote migration complete"
echo ""

# Set Cloudflare Worker secrets (for prod environment)
if [ "$ENV" = "prod" ]; then
    echo "🔐 Cloudflare Worker secrets"
    echo "Do you want to set Worker secrets now? (y/n)"
    read -r SET_SECRETS

    if [[ "$SET_SECRETS" =~ ^[Yy]$ ]]; then
        echo "Setting JWT_SECRET..."
        echo "$JWT_SECRET" | wrangler secret put JWT_SECRET --env production

        echo "Setting VAPID_PUBLIC_KEY..."
        echo "$VAPID_PUBLIC" | wrangler secret put VAPID_PUBLIC_KEY --env production

        echo "Setting VAPID_PRIVATE_KEY..."
        echo "$VAPID_PRIVATE" | wrangler secret put VAPID_PRIVATE_KEY --env production

        echo "✅ Worker secrets set for production environment"
    fi
    echo ""
fi

if [ "$ENV" = "prod" ]; then
    # Print GitHub secrets instructions for production
    echo "📋 GitHub Secrets Configuration"
    echo "================================"
    echo ""
    echo "For automated deployments, add these secrets to your GitHub repository:"
    echo "(Settings → Secrets and variables → Actions → New repository secret)"
    echo ""
    echo "CLOUDFLARE_API_TOKEN"
    echo "  Get from: https://dash.cloudflare.com/profile/api-tokens"
    echo "  Template: Edit Cloudflare Workers"
    echo ""
    echo "CLOUDFLARE_ACCOUNT_ID"
    echo "  Get from: Dashboard → Workers & Pages → Overview (right sidebar)"
    echo ""
    echo "JWT_SECRET"
    echo "  Value: $JWT_SECRET"
    echo ""
    echo "VAPID_PUBLIC_KEY"
    echo "  Value: $VAPID_PUBLIC"
    echo ""
    echo "VAPID_PRIVATE_KEY"
    echo "  Value: $VAPID_PRIVATE"
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
    echo "1. Commit wrangler.production.toml: git add backend/wrangler.production.toml && git commit"
    echo "2. Deploy with 'npm run deploy:prod'"
    echo "3. Or add the secrets above to GitHub for automated deployments"
fi
