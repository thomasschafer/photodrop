# photodrop

A web app for privately sharing photos.

See [PLAN.md](PLAN.md) for architecture details and implementation status.

## Local development

```bash
# Enter nix shell (or use direnv)
nix develop

# Start development servers (auto-configures on first run)
nix run .#dev
```

Visit http://localhost:5173. No Cloudflare account needed - D1 and R2 are simulated locally.

**Note:** Push notifications don't work in local development yet (although we could change this in future).
**Note:** The frontend uses a same-origin `/api` proxy by default in dev. Override with `VITE_API_URL` if needed.

### Creating a group

Groups are created via CLI (there's no public signup):

```bash
nix run .#create-group -- "Family Photos" "Tom" "tom@example.com"
```

This outputs a magic link. Click it to log in as the group owner.

### Testing with seed data

For quick testing, seed the database with a test group, five test users, and a feed of photos with reactions and comments:

```bash
nix run .#db-seed
nix run .#db-seed -- --photos 50
```

Then go to http://localhost:5173/login, enter `owner@test.com`, and copy the magic link from the backend console.

Photos default to 10 and are synthesised when the command runs, so no image files are stored in the repository. Pass `--group <id>` to seed photos into a different group, and `--seed <n>` to reproduce a previous run.

The command is idempotent: re-running replaces the previously seeded photos, along with their reactions and comments, rather than adding another batch. Photos uploaded through the app are left alone.

## Available commands

| Command                                            | Description                            |
| -------------------------------------------------- | -------------------------------------- |
| `nix run .#dev`                                    | Start development servers              |
| `nix run .#create-group -- <name> <owner> <email>` | Create a new group                     |
| `nix run .#db-seed -- [--photos n]`                | Seed local DB with test data           |
| `nix run .#test`                                   | Run unit tests                         |
| `nix run .#test-e2e`                               | Run end-to-end tests                   |
| `nix run .#setup-prod`                             | Create production Cloudflare resources |
| `nix run .#deploy`                                 | Deploy to production (run by CI)       |
| `nix run .#teardown-dev`                           | Clean local dev files                  |
| `nix run .#teardown-prod`                          | Delete production Cloudflare resources |

## Production deployment

Production deploys run in CI: every push to `main` deploys automatically once tests
pass (see `.github/workflows/ci.yml`). Day-to-day operation needs no Cloudflare
credentials on any local machine — the only exceptions are the one-time provisioning
below and the break-glass procedures at the end of this section.

### Prerequisites

- Cloudflare account with Workers & Pages, D1 and R2 enabled
- Domain already added to Cloudflare (can be apex like `example.com` or subdomain like `photos.example.com`)

### One-time provisioning

Provisioning runs locally with temporary Cloudflare credentials:

```bash
wrangler login
nix run .#setup-prod
```

The script will:

1. Prompt for your domain (e.g., `photos.example.com`)
2. Create D1 database and R2 bucket
3. Generate secrets (JWT, VAPID keys)
4. Create Pages project
5. Run database migrations

Afterwards, copy the generated values from `backend/.prod.vars` into GitHub Actions
secrets and variables (see "CI/CD setup" below), then remove the local credentials:

```bash
rm ~/Library/Preferences/.wrangler/config/default.toml
```

Your app will be available at:

- Frontend: `https://your-domain.com` or `https://photos.example.com`
- API: `https://api.your-domain.com` for apex domains, or `https://photos-api.example.com`
  when the frontend uses a subdomain like `photos.example.com`

Avoid nested API hostnames like `api.photos.example.com` unless you have custom SSL
coverage for that nested name. Cloudflare Universal SSL covers `*.example.com`, not
`*.*.example.com`.

Production deploys set `VITE_API_URL=https://$API_DOMAIN` at build time. If you want the
frontend to call the API through the same origin (e.g. for SW caching), set
`VITE_API_URL=/api` at build time and configure your Pages/edge to proxy `/api` to the API worker.

### Deploy

Push to `main` (or trigger the CI workflow manually via Actions → CI → Run workflow).
The deploy job applies database migrations, deploys the Worker with its secrets, and
publishes the frontend to Pages.

After the first deploy, set up DNS and custom domains:

1. **Add API subdomain DNS record** (required for Worker routes):
   - Go to Cloudflare dashboard → your domain → DNS
   - Add record: Type `AAAA`, Name matching `API_DOMAIN`, IPv6 address `100::`, Proxy status: Proxied (orange cloud)
   - Example for `API_DOMAIN=photos-api.example.com`: Name `photos-api`
   - Example for `API_DOMAIN=api.example.com`: Name `api`
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

### CI/CD setup

CI needs the following configuration to deploy and to create groups:

1. Add **secrets** to GitHub (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` - Create at https://dash.cloudflare.com/profile/api-tokens with permissions:
     - Account / Workers Scripts: Edit
     - Account / D1: Edit
     - Account / Cloudflare Pages: Edit
     - Account / Account Settings: Read
     - Zone / Workers Routes: Edit
     - Zone / Zone: Read
     - Include zone resource: your root zone (e.g., `example.com`)
   - `CLOUDFLARE_ACCOUNT_ID` - From `backend/.prod.vars`
   - `D1_DATABASE_ID` - From `backend/.prod.vars`
   - `JWT_SECRET` - From `backend/.prod.vars`
   - `VAPID_PUBLIC_KEY` - From `backend/.prod.vars`
   - `VAPID_PRIVATE_KEY` - From `backend/.prod.vars`
   - `RESEND_API_KEY` - From Resend (see "Email setup" below). Required: email is
     the only authentication path, so deploys fail without it

2. Add **variables** to GitHub (Settings → Secrets and variables → Actions → Variables):
   - `DOMAIN` - Your frontend domain (e.g., `photos.example.com`)
   - `API_DOMAIN` - Your API domain (e.g., `photos-api.example.com` for subdomain frontends, or `api.example.com` for apex frontends)
   - `ZONE_NAME` - Your Cloudflare zone/root domain (e.g., `example.com`)
   - `EMAIL_FROM` - Sender address for Resend (e.g., `photodrop <noreply@example.com>`)
   - `PAGES_PROJECT` - `photodrop` (optional, defaults to `photodrop`)

### Creating groups in production

**Note:** Email must be configured before creating groups. See "Email setup" below.

Groups are created via the "Create group" GitHub Actions workflow:

1. Go to Actions → Create group → Run workflow
2. Enter the group name, owner name, and owner email
3. The magic link is emailed to the owner (expires in 15 minutes)

This repo is public, so the workflow is careful with its logs: owner details are
masked and the magic link is only ever delivered by email. If the email fails to
send, the run fails rather than printing the link.

Runs are idempotent: re-running with the same group name and owner reuses the
existing user and group (group names are unique per owner) and emails a fresh
magic link, so a failed run can simply be retried.

### Email setup (Resend)

Email is required for magic link authentication. We use [Resend](https://resend.com) (3,000 emails/month free).

1. **Sign up** at https://resend.com

2. **Add your domain**:
   - Go to Resend dashboard → Domains → Add Domain
   - Enter your domain (e.g., `example.com`)
   - Follow the automated flow to add DNS records to Cloudflare
   - Wait for verification (usually instant, can take up to 48h)

3. **Create API key**:
   - Go to Resend dashboard → API Keys → Create API Key
   - Give it a name and "Sending access" permission
   - Copy the key (you won't see it again)

4. **Add to production**: save the key as the `RESEND_API_KEY` GitHub Actions secret.
   The next CI deploy applies it to the Worker.

5. **Test**: Create a group with your real email address and verify the invite email arrives.

Emails are sent from `EMAIL_FROM` when configured, otherwise `noreply@your-domain.com`
based on your `DOMAIN` setting.

### Break-glass: manual production access

Routine operations (deploys, group creation) run in CI and need no local
credentials. For everything else — provisioning, teardown, incident debugging —
authenticate temporarily and clean up afterwards:

1. Authenticate: `wrangler login` (or export a short-lived, tightly scoped
   `CLOUDFLARE_API_TOKEN`)
2. Run what you need:
   - Provision or tear down: `nix run .#setup-prod` / `nix run .#teardown-prod`
   - Manual deploy: run the whole thing in a subshell so no production
     values outlive the deploy:

     ```bash
     (
         set -a; source backend/.prod.vars; set +a
         # Not stored in .prod.vars; paste the key from Resend. read -rs
         # keeps it out of files and shell history.
         read -rs RESEND_API_KEY && export RESEND_API_KEY
         nix run .#deploy
     )
     ```
   - Inspect the production database: prefer the D1 console in the Cloudflare
     dashboard; for CLI access run
     `npx wrangler d1 execute photodrop-db-prod --remote --command "..."` from
     `backend/`
3. Remove the credentials:

   ```bash
   rm ~/Library/Preferences/.wrangler/config/default.toml
   ```

## Architecture

- **Frontend**: React + Vite PWA
- **Backend**: Cloudflare Workers + Hono
- **Database**: D1 (SQLite)
- **Storage**: R2 (S3-compatible)
- **Auth**: Passwordless magic links
