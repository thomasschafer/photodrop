#!/bin/bash

# Photodrop infrastructure teardown script
# This script destroys all Cloudflare resources and local configuration

set -e  # Exit on error

# Parse environment argument (dev, prod, or all)
ENV=${1:-all}

if [[ "$ENV" != "dev" && "$ENV" != "prod" && "$ENV" != "all" ]]; then
    echo "Usage: $0 [dev|prod|all]"
    echo "  dev  - Delete development environment only"
    echo "  prod - Delete production environment only"
    echo "  all  - Delete both environments (default)"
    exit 1
fi

echo "⚠️  Photodrop Infrastructure Teardown ($ENV)"
echo "====================================="
echo ""

if [ "$ENV" = "all" ]; then
    echo "This will DELETE:"
    echo "  - D1 databases (dev and prod) and all data"
    echo "  - R2 buckets (dev and prod) and all photos"
    echo "  - Local .dev.vars and .prod.vars files"
    echo "  - wrangler.toml"
    echo "  - Production secrets from Cloudflare Workers"
elif [ "$ENV" = "dev" ]; then
    echo "This will DELETE:"
    echo "  - D1 database 'photodrop-db-dev' and all data"
    echo "  - R2 bucket 'photodrop-photos-dev' and all photos"
    echo "  - Local .dev.vars file"
    echo "  - wrangler.toml (if only dev is configured)"
else
    echo "This will DELETE:"
    echo "  - D1 database 'photodrop-db-prod' and all data"
    echo "  - R2 bucket 'photodrop-photos-prod' and all photos"
    echo "  - Local .prod.vars file"
    echo "  - Production secrets from Cloudflare Workers"
fi

echo ""
echo "This action CANNOT be undone!"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "Starting teardown..."
echo ""

# Navigate to backend directory
cd "$(dirname "$0")/../backend"

# Function to delete environment resources
delete_env() {
    local env_name=$1
    local db_name="photodrop-db-${env_name}"
    local bucket_name="photodrop-photos-${env_name}"
    local vars_file=".${env_name}.vars"

    # Delete R2 bucket
    echo "🗑️  Deleting R2 bucket ($bucket_name)..."
    if npx wrangler r2 bucket list | grep -q "$bucket_name"; then
        echo "⚠️  Warning: This will delete all photos in $bucket_name"
        read -p "Continue? (y/n): " DELETE_BUCKET
        if [[ "$DELETE_BUCKET" =~ ^[Yy]$ ]]; then
            npx wrangler r2 bucket delete "$bucket_name"
            echo "✅ Bucket deleted"
        else
            echo "⏭️  Skipped bucket deletion"
        fi
    else
        echo "⏭️  Bucket '$bucket_name' does not exist"
    fi
    echo ""

    # Delete D1 database
    echo "🗑️  Deleting D1 database ($db_name)..."
    if npx wrangler d1 list | grep -q "$db_name"; then
        npx wrangler d1 delete "$db_name" --skip-confirmation
        echo "✅ Database deleted"
    else
        echo "⏭️  Database '$db_name' does not exist"
    fi
    echo ""

    # Delete vars file
    echo "🗑️  Deleting $vars_file..."
    if [ -f "$vars_file" ]; then
        rm "$vars_file"
        echo "✅ $vars_file deleted"
    else
        echo "⏭️  $vars_file does not exist"
    fi
    echo ""
}

# Delete based on environment selection
if [ "$ENV" = "all" ]; then
    delete_env "dev"
    delete_env "prod"
elif [ "$ENV" = "dev" ]; then
    delete_env "dev"
else
    delete_env "prod"
fi

# Delete production secrets (only for prod or all)
if [ "$ENV" = "prod" ] || [ "$ENV" = "all" ]; then
    echo "🔐 Deleting production Worker secrets..."
    read -p "Delete production secrets from Cloudflare Workers? (y/n): " DELETE_SECRETS
    if [[ "$DELETE_SECRETS" =~ ^[Yy]$ ]]; then
        npx wrangler secret delete JWT_SECRET --env production --force 2>/dev/null || echo "⏭️  JWT_SECRET not found"
        npx wrangler secret delete VAPID_PUBLIC_KEY --env production --force 2>/dev/null || echo "⏭️  VAPID_PUBLIC_KEY not found"
        npx wrangler secret delete VAPID_PRIVATE_KEY --env production --force 2>/dev/null || echo "⏭️  VAPID_PRIVATE_KEY not found"
        echo "✅ Secrets deleted"
    else
        echo "⏭️  Skipped secret deletion"
    fi
    echo ""
fi

# Delete wrangler.toml (only for all)
if [ "$ENV" = "all" ]; then
    echo "🗑️  Deleting wrangler.toml..."
    if [ -f wrangler.toml ]; then
        rm wrangler.toml
        echo "✅ wrangler.toml deleted"
    else
        echo "⏭️  wrangler.toml does not exist"
    fi
    echo ""
fi

echo "====================================="
echo "✅ Teardown complete!"
echo ""
echo "Next steps:"
if [ "$ENV" = "all" ]; then
    echo "1. Run 'nix run .#setup-dev' to recreate dev environment"
    echo "2. Run 'nix run .#setup-prod' to recreate prod environment"
elif [ "$ENV" = "dev" ]; then
    echo "1. Run 'nix run .#setup-dev' to recreate dev environment"
else
    echo "1. Run 'nix run .#setup-prod' to recreate prod environment"
fi
