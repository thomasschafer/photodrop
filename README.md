# photodrop

A Progressive Web App (PWA) for privately sharing photos within isolated groups.

See [PLAN.md](PLAN.md) for architecture details and implementation status.

## Local development

```bash
# Enter nix shell (or use direnv)
nix develop

# Start development servers (auto-configures on first run)
nix run .#dev
```

Visit http://localhost:5173. No Cloudflare account needed - D1 and R2 are simulated locally.

### Creating a group

Groups are created via CLI (there's no public signup):

```bash
nix run .#create-group -- "Family Photos" "Tom" "tom@example.com"
```

This outputs a magic link. Click it to log in as the group owner.

### Testing with seed data

For quick testing, seed the database with test users:

```bash
nix run .#db-seed
```

Then go to http://localhost:5173/login, enter `admin@test.com`, and copy the magic link from the backend console.

## Available commands

| Command | Description |
|---------|-------------|
| `nix run .#dev` | Start development servers |
| `nix run .#create-group -- <name> <owner> <email>` | Create a new group |
| `nix run .#db-seed` | Seed local DB with test users |
| `nix run .#test` | Run unit tests |
| `nix run .#test-e2e` | Run end-to-end tests |
| `nix run .#setup-prod` | Create production Cloudflare resources |
| `nix run .#deploy` | Deploy to production |
| `nix run .#teardown-dev` | Clean local dev files |
| `nix run .#teardown-prod` | Delete production Cloudflare resources |

## Production deployment

### Prerequisites

- Cloudflare account with Workers, D1, R2, and Pages enabled
- `wrangler` CLI authenticated (`wrangler login`)

### One-time setup

```bash
nix run .#setup-prod
```

This creates D1 database, R2 bucket, and generates secrets. Follow the output instructions to:
1. Add secrets to GitHub Actions (see `backend/.prod.secrets.txt`)
2. Update `FRONTEND_URL` in `backend/.prod.vars` with your domain

### Deploy

Push to `main` for automatic deployment via GitHub Actions, or deploy manually:

```bash
nix run .#deploy
```

### Creating groups in production

```bash
nix run .#create-group -- "Family Photos" "Tom" "tom@example.com" --remote
```

## Architecture

- **Frontend**: React + Vite PWA
- **Backend**: Cloudflare Workers + Hono
- **Database**: D1 (SQLite)
- **Storage**: R2 (S3-compatible)
- **Auth**: Passwordless magic links
