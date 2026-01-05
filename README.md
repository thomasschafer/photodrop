# photodrop

A Progressive Web App (PWA) for privately sharing baby photos with family members.

## Current Status

**Phase 1 (Foundation)**: ✅ Complete
- Photo upload and feed working
- JWT authentication (access + refresh tokens)
- User management endpoints
- Photo reactions and view tracking
- All tests passing (27/27)

**Phase 1.5 (Email Authentication)**: 🚧 In Progress
- Migrating from token-based to email-based passwordless authentication
- See PLAN.md for complete architecture details
- See NEXT_STEPS.md for implementation checklist

**Not yet functional:**
- User onboarding (being rebuilt with email-based auth)
- First admin creation (will use secure CLI script)
- Invite system (will send emails instead of shareable links)

## Prerequisites

- [Nix](https://install.determinate.systems/nix) with flakes enabled
- Cloudflare account (free tier works) with:
  - **D1 database** enabled (visit [Cloudflare Dashboard → D1](https://dash.cloudflare.com/d1) and enable)
  - **R2 storage** enabled (visit [Cloudflare Dashboard → R2](https://dash.cloudflare.com/r2) and enable)
- [direnv](https://direnv.net/) (optional, for automatic environment setup)

## Quick start

```bash
# Enter development shell
nix develop  # or use direnv

# Login to Cloudflare
wrangler login

# Set up development environment
nix run .#setup-dev
```

This creates:
- `photodrop-db-dev` D1 database
- `photodrop-photos-dev` R2 bucket
- `.dev.vars` with generated secrets
- `wrangler.toml` configured for development

### ⚠️ Phase 1.5 Migration Notice

If you previously ran `setup-dev` before the email authentication migration, you'll need to tear down and recreate your development environment:

```bash
nix run .#teardown-dev
nix run .#setup-dev
```

This is required because we've migrated from token-based to email-based authentication, which changes the database schema. This is a one-time requirement during the Phase 1.5 transition.

## Local development

```bash
# If you're in a direnv shell or ran 'nix develop'
dev

# Or run directly without entering the shell
nix run .#dev
```

Then visit http://localhost:5173

## Production deployment

### One-time setup (run locally)

1. **Create Cloudflare resources and generate secrets:**
   ```bash
   nix run .#setup-prod
   ```
   This creates:
   - `photodrop-db-prod` D1 database
   - `photodrop-photos-prod` R2 bucket
   - `.prod.vars` with database ID and generated secrets (gitignored)
   - `.prod.secrets.txt` with all values for GitHub (gitignored)

2. **Add secrets to GitHub:**
   - View secrets: `cat backend/.prod.secrets.txt`
   - Go to: Settings → Secrets and variables → Actions → New repository secret
   - Add the following secrets:
     - `CLOUDFLARE_API_TOKEN` - Get from https://dash.cloudflare.com/profile/api-tokens
     - `CLOUDFLARE_ACCOUNT_ID` - Get from Workers & Pages dashboard
     - `D1_DATABASE_ID` - From `.prod.secrets.txt` (your database UUID)
     - `JWT_SECRET` - From `.prod.secrets.txt`
     - `VAPID_PUBLIC_KEY` - From `.prod.secrets.txt`
     - `VAPID_PRIVATE_KEY` - From `.prod.secrets.txt`

**Note:** All configuration is environment-driven. The repo contains no environment-specific IDs, allowing multiple deployments (staging, prod, etc.) using different secret sets.

### Ongoing deployments (automatic via CI)

Once setup is complete, every push to `main`:
1. Runs all tests (backend + frontend)
2. Generates `wrangler.toml` from environment variables
3. Deploys to production automatically

You can also deploy manually:
```bash
nix run .#deploy
```

### Multiple environments

To deploy to multiple environments (e.g., staging, production):
1. Run `nix run .#setup-prod` for each environment to create separate databases
2. Store secrets in different GitHub environments or repositories
3. Each deployment uses its own database ID and secrets

## Teardown

```bash
nix run .#teardown-dev   # Delete dev only
nix run .#teardown-prod  # Delete prod only
nix run .#teardown       # Delete everything
```

## Tests

```bash
nix run .#test            # All tests
nix run .#test-backend    # Backend only
nix run .#test-frontend   # Frontend only
```

## Security

Scan for secrets before committing:

```bash
nix run .#secrets-scan
```
