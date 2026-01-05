# photodrop

A Progressive Web App (PWA) for privately sharing baby photos with family members.

## Prerequisites

- [Nix](https://install.determinate.systems/nix) with flakes enabled
- Cloudflare account (free tier works)
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

**Production setup:**

```bash
nix run .#setup-prod
```

Creates production resources and updates `wrangler.production.toml` (commit this file).

## Local development

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Visit http://localhost:5173

## Deploy

```bash
nix run .#deploy
```

Or push to main for automated deployment via GitHub Actions.

## Teardown

```bash
npm run teardown:dev   # Delete dev only
npm run teardown:prod  # Delete prod only
npm run teardown       # Delete everything
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
