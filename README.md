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

- Cloudflare account with Workers & Pages, D1 and R2 enabled
- Domain already added to Cloudflare (can be apex like `example.com` or subdomain like `photos.example.com`)
- `wrangler` CLI authenticated (`wrangler login`)

### One-time setup

```bash
nix run .#setup-prod
```

The script will:
1. Prompt for your domain (e.g., `photos.example.com`)
2. Create D1 database and R2 bucket
3. Generate secrets (JWT, VAPID keys)
4. Create Pages project
5. Run database migrations

Your app will be available at:
- Frontend: `https://your-domain.com`
- API: `https://api.your-domain.com`

### Deploy

```bash
nix run .#deploy
```

After the first deploy, set up DNS and custom domains:

1. **Add API subdomain DNS record** (required for Worker routes):
   - Go to Cloudflare dashboard → your domain → DNS
   - Add record: Type `AAAA`, Name `api`, IPv6 address `100::`, Proxy status: Proxied (orange cloud)
   - The actual IP doesn't matter - Cloudflare routes traffic to your Worker

2. **Add Pages custom domain**:
   - Go to Cloudflare dashboard → Workers & Pages → photodrop → Custom domains
   - Add your domain (e.g., `photos.example.com`)

3. **Optional: Set up www redirect**:
   - Go to Workers & Pages → photodrop → Custom domains → Add `www.your-domain.com`
   - Add the CNAME record it prompts for (www → your-pages-project.pages.dev)
   - Go to Rules → Redirect Rules → Create rule using "Redirect from WWW to root" template
   - Set Request URL to `https://www.your-domain.com/*`
   - Set Target URL to `https://your-domain.com/${1}` with status 301
   - Check "Preserve query string"

### CI/CD setup (optional)

For automatic deployments on push to `main`:

1. Add **secrets** to GitHub (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` - Create at https://dash.cloudflare.com/profile/api-tokens with permissions:
      - Account / Workers Scripts: Edit
      - Account / D1: Edit
      - Account / Cloudflare Pages: Edit
      - Account / Account Settings: Read
      - Zone / Zone: Read
   - `CLOUDFLARE_ACCOUNT_ID` - Found in your Cloudflare dashboard URL
   - `D1_DATABASE_ID` - From `backend/.prod.vars`
   - `JWT_SECRET` - From `backend/.prod.vars`
   - `VAPID_PUBLIC_KEY` - From `backend/.prod.vars`
   - `VAPID_PRIVATE_KEY` - From `backend/.prod.vars`

2. Add **variables** to GitHub (Settings → Secrets and variables → Actions → Variables):
   - `DOMAIN` - Your frontend domain (e.g., `photos.example.com`)
   - `API_DOMAIN` - Your API domain (e.g., `api.photos.example.com`)
   - `ZONE_NAME` - Root domain in Cloudflare (e.g., `example.com`)
   - `PAGES_PROJECT` - `photodrop`

### Creating groups in production

```bash
nix run .#create-group -- "Family Photos" "Tom" "tom@example.com" --prod
```

The magic link will be output. Since email isn't configured yet, you can also view magic links in Worker logs:

```bash
wrangler tail
```

## Architecture

- **Frontend**: React + Vite PWA
- **Backend**: Cloudflare Workers + Hono
- **Database**: D1 (SQLite)
- **Storage**: R2 (S3-compatible)
- **Auth**: Passwordless magic links
