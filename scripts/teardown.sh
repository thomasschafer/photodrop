#!/bin/bash

# Photodrop teardown script
#
# Usage:
#   ./scripts/teardown.sh dev   - Delete local dev files only
#   ./scripts/teardown.sh prod  - Delete production Cloudflare resources
#   ./scripts/teardown.sh all   - Delete everything

set -e

ENV=${1:-all}

if [[ "$ENV" != "dev" && "$ENV" != "prod" && "$ENV" != "all" ]]; then
    echo "Usage: $0 [dev|prod|all]"
    exit 1
fi

cd "$(dirname "$0")/../backend"

#
# DEV TEARDOWN - Local files only
#
teardown_dev() {
    echo "Cleaning up dev environment..."

    if [ -f .dev.vars ]; then
        rm .dev.vars
        echo "  Deleted .dev.vars"
    fi

    if [ -d .wrangler ]; then
        rm -rf .wrangler
        echo "  Deleted .wrangler/ (local database)"
    fi

    echo "Dev cleanup complete"
}

#
# PROD TEARDOWN - Cloudflare resources
#
teardown_prod() {
    echo "This will DELETE production Cloudflare resources:"
    echo "  - D1 database 'photodrop-db-prod' and all data"
    echo "  - R2 bucket 'photodrop-photos-prod' and all photos"
    echo ""
    echo "This action CANNOT be undone!"
    echo ""
    read -p "Type 'yes' to confirm: " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo "Aborted"
        return
    fi

    # Check wrangler
    if command -v wrangler &> /dev/null; then
        WRANGLER_CMD="wrangler"
    else
        WRANGLER_CMD="npx --yes wrangler"
    fi

    # Delete R2 bucket
    echo ""
    echo "Deleting R2 bucket..."
    if $WRANGLER_CMD r2 bucket list 2>/dev/null | grep -q "photodrop-photos-prod"; then
        $WRANGLER_CMD r2 bucket delete "photodrop-photos-prod" || true
        echo "  Deleted bucket"
    else
        echo "  Bucket not found"
    fi

    # Delete D1 database
    echo "Deleting D1 database..."
    if $WRANGLER_CMD d1 list 2>/dev/null | grep -q "photodrop-db-prod"; then
        $WRANGLER_CMD d1 delete "photodrop-db-prod" --skip-confirmation || true
        echo "  Deleted database"
    else
        echo "  Database not found"
    fi

    # Delete local files
    [ -f .prod.vars ] && rm .prod.vars && echo "  Deleted .prod.vars"
    [ -f .prod.secrets.txt ] && rm .prod.secrets.txt && echo "  Deleted .prod.secrets.txt"

    echo "Production cleanup complete"
}

case "$ENV" in
    dev)
        teardown_dev
        ;;
    prod)
        teardown_prod
        ;;
    all)
        teardown_dev
        echo ""
        teardown_prod
        ;;
esac

echo ""
echo "Done. Run 'nix run .#setup-$ENV' to set up again."
