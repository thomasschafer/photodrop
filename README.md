# photodrop

A Progressive Web App (PWA) for privately sharing photos within isolated groups.

See [PLAN.md](PLAN.md) for architecture details and implementation status.

## Quick start

```bash
# Enter nix shell (or use direnv)
nix develop

# Start development - everything auto-configures on first run
nix run .#dev
```

That's it! Visit http://localhost:5173

No Cloudflare account needed for local development - D1 and R2 are simulated locally.

## Testing the auth flow

```bash
nix run .#db-seed  # Create test users (one time)
nix run .#dev      # Start servers
```

Then:
1. Go to http://localhost:5173/login
2. Enter `admin@test.com`
3. Copy magic link from backend console
4. Paste in browser to login

## Available commands

| Command | Description |
|---------|-------------|
| `nix run .#dev` | Start development servers |
| `nix run .#db-seed` | Seed local DB with test users |
| `nix run .#test` | Run all tests |
| `nix run .#setup-dev` | Regenerate dev secrets |
| `nix run .#setup-prod` | Create production Cloudflare resources |
| `nix run .#deploy` | Deploy to production |
| `nix run .#teardown-dev` | Clean local dev files |
| `nix run .#teardown-prod` | Delete production resources |

## Production deployment

### One-time setup

```bash
# Requires Cloudflare account
wrangler login
nix run .#setup-prod
```

This creates D1 database, R2 bucket, and generates secrets. Add the secrets from `backend/.prod.secrets.txt` to GitHub Actions.

### Deploy

Push to `main` for automatic deployment, or:

```bash
nix run .#deploy
```

## Architecture

- **Frontend**: React + Vite PWA
- **Backend**: Cloudflare Workers + Hono
- **Database**: D1 (SQLite)
- **Storage**: R2 (S3-compatible)
- **Auth**: Passwordless magic links
