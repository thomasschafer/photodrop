# photodrop

A Progressive Web App (PWA) for privately sharing baby photos with family members.

## Project Status

**Phase 1 Foundation - In Progress**

### ✅ Completed

**Frontend Setup:**
- Vite + React + TypeScript project configured
- Tailwind CSS integrated
- Vitest and React Testing Library configured
- Test scripts ready (`npm test`, `npm run test:ui`, `npm run test:run`)

**Backend Setup:**
- Cloudflare Workers project structure created
- Hono web framework integrated
- TypeScript configuration
- Vitest testing framework configured

**Authentication System:**
- ✅ JWT generation and validation (with 27 passing unit tests)
  - HMAC-SHA256 signing using Web Crypto API
  - Access tokens (15 min expiry)
  - Refresh tokens (30 day expiry)
  - Role-based tokens (admin/viewer)

- ✅ Database helper functions (with comprehensive tests)
  - User management (create, read, update, delete)
  - Invite token generation (cryptographically secure)
  - Invite acceptance with automatic first-user-as-admin logic
  - Role management with safety checks

- ✅ Auth middleware
  - JWT verification
  - Role-based access control (requireAuth, requireAdmin)

- ✅ Auth API endpoints
  - `POST /api/auth/create-invite` - Create invite (admin only)
  - `POST /api/auth/accept-invite` - Accept invite and get tokens
  - `POST /api/auth/refresh` - Refresh access token
  - `POST /api/auth/logout` - Clear refresh token

**Database:**
- ✅ Initial schema migration created (`migrations/001_initial_schema.sql`)
- Tables: users, photos, photo_views, photo_reactions, push_subscriptions, schema_migrations
- Proper indexes and foreign keys
- Cascading deletes configured

### 🚧 Next Steps (Requires Your Action)

**Cloudflare Infrastructure Setup:**

You'll need to create the following in your Cloudflare dashboard:

1. **D1 Database:**
   ```bash
   # Create the database
   npx wrangler d1 create photodrop-db

   # This will output a database_id - add it to backend/wrangler.toml

   # Run the initial migration
   npx wrangler d1 execute photodrop-db --file=migrations/001_initial_schema.sql --local
   npx wrangler d1 execute photodrop-db --file=migrations/001_initial_schema.sql
   ```

2. **R2 Bucket:**
   ```bash
   # Create the R2 bucket
   npx wrangler r2 bucket create photodrop-photos

   # Add the binding to backend/wrangler.toml
   ```

3. **Environment Variables:**
   ```bash
   cd backend

   # Copy the example file
   cp .dev.vars.example .dev.vars

   # Generate a JWT secret
   openssl rand -base64 32

   # Generate VAPID keys (for push notifications later)
   npm install -g web-push
   web-push generate-vapid-keys

   # Add these values to .dev.vars
   ```

4. **Update `backend/wrangler.toml`:**
   Uncomment and fill in the D1 and R2 bindings with your IDs.

### 🧪 Running Tests

**Frontend:**
```bash
cd frontend
npm test          # Run tests in watch mode
npm run test:ui   # Open Vitest UI
npm run test:run  # Run tests once
```

**Backend:**
```bash
cd backend
npm test          # Run tests in watch mode
npm run test:run  # Run tests once
```

Current test status: **27/27 backend tests passing** ✅

### 🚀 Local Development (Once Infrastructure is Set Up)

**Backend:**
```bash
cd backend
npm run dev  # Starts Wrangler dev server on http://localhost:8787
```

**Frontend:**
```bash
cd frontend
npm run dev  # Starts Vite dev server on http://localhost:5173
```

### 📋 Remaining Work (Phase 1)

**Stage 3: Core upload flow**
- [ ] Implement client-side image compression (browser-image-compression)
- [ ] Build photo upload UI component
- [ ] Create photo upload API endpoint
- [ ] Set up R2 storage integration
- [ ] Implement thumbnail generation (client-side)
- [ ] Create photo listing endpoint
- [ ] Build photo feed UI
- [ ] Add unit tests for image processing
- [ ] Test upload and viewing

After Phase 1 is complete, we'll move to:
- Phase 2: PWA features (service worker, push notifications, onboarding)
- Phase 3: Polish and features (admin dashboard, reactions, photo deletion)
- Phase 4: Launch preparation (documentation, beta testing, deployment)

### 📁 Project Structure

```
photodrop/
├── frontend/              # React PWA
│   ├── src/
│   │   ├── test/         # Test setup
│   │   └── ...
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── backend/              # Cloudflare Workers API
│   ├── src/
│   │   ├── lib/          # Utility functions
│   │   │   ├── jwt.ts    # JWT generation/validation
│   │   │   ├── jwt.test.ts
│   │   │   ├── db.ts     # Database helpers
│   │   │   ├── db.test.ts
│   │   │   └── crypto.ts # Secure random generation
│   │   ├── middleware/   # Hono middleware
│   │   │   └── auth.ts   # Auth middleware
│   │   ├── routes/       # API routes
│   │   │   └── auth.ts   # Auth endpoints
│   │   └── index.ts      # Main entry point
│   ├── migrations/       # D1 database migrations
│   │   └── 001_initial_schema.sql
│   ├── wrangler.toml     # Cloudflare Workers config
│   ├── package.json
│   └── tsconfig.json
│
├── PLAN.md              # Comprehensive project plan
└── README.md            # This file
```

### 🔐 Security Features Implemented

- JWT tokens with HMAC-SHA256 signing
- Refresh token rotation
- httpOnly cookies for refresh tokens
- Cryptographically secure invite tokens (32 bytes)
- Cryptographically secure user IDs (16 bytes)
- Role-based access control
- First user automatically becomes admin
- Safety check: cannot demote last admin
- CORS configured for specific origins
- Invite tokens single-use (cleared after acceptance)

### 🧰 Technology Stack

**Frontend:**
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Vitest + Testing Library

**Backend:**
- Cloudflare Workers
- Hono web framework
- D1 SQLite database
- R2 object storage
- TypeScript
- Vitest

**Authentication:**
- JWT with Web Crypto API
- httpOnly cookie refresh tokens
- No passwords (invite-only system)

## Deployment

### Deploying a new instance from scratch

**Prerequisites:**
- Cloudflare account (free tier)
- GitHub account
- Git installed locally
- Node.js 18+ installed

### Step 1: Cloudflare account setup

1. **Create Cloudflare account:**
   - Go to https://dash.cloudflare.com/sign-up
   - Verify your email
   - Add payment method (required even for free tier, you won't be charged)

2. **Create API token:**
   - Go to: Dashboard → My Profile → API Tokens
   - Click "Create Token"
   - Use "Edit Cloudflare Workers" template
   - Or create custom token with these permissions:
     - Account → Workers Scripts → Edit
     - Account → D1 → Edit
     - Account → Workers R2 Storage → Edit
     - Account → Cloudflare Pages → Edit
   - Copy the token (you'll need it for GitHub secrets)

3. **Get your Account ID:**
   - Dashboard → Workers & Pages → Overview
   - Copy the Account ID from the right sidebar

### Step 2: Create Cloudflare resources

```bash
# Clone the repository
git clone <your-repo-url>
cd photodrop

# Install Wrangler globally (or use npx)
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create D1 database
cd backend
wrangler d1 create photodrop-db
# Copy the database_id from the output

# Create R2 bucket
wrangler r2 bucket create photodrop-photos
```

### Step 3: Update Wrangler configuration

Edit `backend/wrangler.toml` and uncomment/update these sections:

```toml
[[d1_databases]]
binding = "DB"
database_name = "photodrop-db"
database_id = "YOUR_DATABASE_ID_HERE"  # From step 2

[[r2_buckets]]
binding = "PHOTOS"
bucket_name = "photodrop-photos"
```

Commit this change:
```bash
git add backend/wrangler.toml
git commit -m "Configure D1 and R2 bindings"
git push
```

### Step 4: Run initial database migration

```bash
# Run locally first to test
wrangler d1 execute photodrop-db --local --file=../migrations/001_initial_schema.sql

# Run in production
wrangler d1 execute photodrop-db --file=../migrations/001_initial_schema.sql
```

### Step 5: Generate secrets

```bash
# Generate JWT secret
openssl rand -base64 32
# Save this output

# Generate VAPID keys for push notifications
npm install -g web-push
web-push generate-vapid-keys
# Save both public and private keys
```

### Step 6: Configure GitHub secrets

Go to your GitHub repository:
- Settings → Secrets and variables → Actions → New repository secret

Add these secrets:
- `CLOUDFLARE_API_TOKEN` - The API token from Step 1
- `CLOUDFLARE_ACCOUNT_ID` - The Account ID from Step 1
- `JWT_SECRET` - The base64 string from Step 5
- `VAPID_PUBLIC_KEY` - The public key from Step 5
- `VAPID_PRIVATE_KEY` - The private key from Step 5

### Step 7: Set up local development (optional)

```bash
cd backend
cp .dev.vars.example .dev.vars
# Edit .dev.vars and add your JWT_SECRET and VAPID keys
```

### Step 8: Create GitHub Actions workflows

The project needs two workflow files (these will be created in a future update):
- `.github/workflows/test.yml` - Runs tests on every PR
- `.github/workflows/deploy.yml` - Deploys on merge to main

**Note:** These workflow files are specified in PLAN.md but not yet implemented. Once created, deployments will be fully automated.

### Step 9: Deploy manually (until GitHub Actions is set up)

**Deploy backend:**
```bash
cd backend

# Set secrets for the Worker
wrangler secret put JWT_SECRET
# Paste your JWT secret when prompted

wrangler secret put VAPID_PUBLIC_KEY
# Paste your VAPID public key

wrangler secret put VAPID_PRIVATE_KEY
# Paste your VAPID private key

# Deploy the Worker
wrangler deploy
```

**Deploy frontend:**
```bash
cd frontend

# Build production bundle
npm run build

# Deploy to Cloudflare Pages (first time setup)
# Option 1: Via Cloudflare Dashboard
# - Go to Dashboard → Workers & Pages → Create application → Pages
# - Connect your GitHub repository
# - Configure build settings:
#   - Build command: cd frontend && npm install && npm run build
#   - Build output directory: frontend/dist
# - Deploy

# Option 2: Via Wrangler (requires Pages project to exist)
npx wrangler pages deploy dist --project-name photodrop
```

### Step 10: Verify deployment

1. Check Worker is running:
   ```bash
   curl https://photodrop-api.<your-subdomain>.workers.dev/health
   # Should return: {"status":"ok"}
   ```

2. Check frontend is deployed:
   - Visit your Cloudflare Pages URL
   - Or your custom domain if configured

### Automated deployments (once GitHub Actions is set up)

After completing the one-time setup above, every push to `main` will:
1. Run all tests
2. Deploy backend Worker
3. Apply database migrations
4. Deploy frontend to Pages
5. Verify deployment health

To deploy:
```bash
git add .
git commit -m "Your changes"
git push origin main
```

GitHub Actions will handle the rest automatically.

### Custom domain setup (optional)

1. **Purchase domain** (or use existing):
   - Cloudflare Registrar or external provider
   - Recommended: `.app` or `.family` domains

2. **Add domain to Cloudflare:**
   - Dashboard → Websites → Add a site
   - Follow DNS setup instructions

3. **Configure Pages custom domain:**
   - Dashboard → Workers & Pages → Your Pages project → Custom domains
   - Add your domain
   - DNS records are configured automatically

4. **Configure Worker route (for API):**
   - Dashboard → Workers & Pages → Your Worker → Settings → Triggers
   - Add route: `api.yourdomain.com/*`
   - Or use path: `yourdomain.com/api/*`

### Multiple environments (optional)

To set up staging and production environments:

1. Create separate Cloudflare resources:
   ```bash
   wrangler d1 create photodrop-db-staging
   wrangler r2 bucket create photodrop-photos-staging
   ```

2. Create environment-specific wrangler configs or use Wrangler environments

3. Set up GitHub environments with different secrets

4. Create separate deployment workflows for each environment

See PLAN.md for detailed multi-environment setup instructions.

## Notes

- All tests are passing (27/27 backend tests)
- Code follows defensive programming principles
- No unnecessary comments added (per coding guidelines)
- DRY principles followed throughout
- Ready for infrastructure setup and continued development
