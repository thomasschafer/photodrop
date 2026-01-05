# photodrop - Project plan

## Overview

A Progressive Web App (PWA) for privately sharing baby photos with family members. Parents can upload photos with one tap, and family members receive instant push notifications. Built with Cloudflare's free tier to minimize costs while maintaining security and reliability.

## Core requirements

### Functional requirements

- **For parents (admins)**:
  - Multiple users can be admins (both parents typically)
  - Upload photos with one tap from mobile devices
  - Add optional captions to photos
  - Manage family member invitations
  - Promote other users to admin role
  - See delivery status (who has seen what)
  - Send test notifications
  - Delete photos if needed

- **For family members**:
  - Each family member has their own view of all photos, sorted chronologically (newest photo at the top, which is there they start in the app)
  - Ability to react with an emoji to each photo
  - Receive push notifications when new photos arrive
  - Simple onboarding via unique invite links
  - Stay logged in permanently (unless they logout)
  - Work offline and sync when back online

### Non-functional requirements

- **Security**: Photos only accessible to invited users
- **Cost**: Stay within Cloudflare free tier (£0/month target)
- **Performance**: Photos load quickly, notifications arrive within seconds
- **Reliability**: Work on iOS 16.4+ and modern Android
- **Privacy**: No tracking, no third-party analytics

## Architecture

### Technology stack

**Frontend (PWA)**:
- React (via Vite) - modern, fast build tooling
- TypeScript - type safety
- Tailwind CSS - styling
- Workbox - service worker management for offline support
- Web Push API - notifications

**Backend**:
- Cloudflare Workers - serverless functions (free: 100k requests/day)
- Cloudflare D1 - SQLite database (free: 5GB storage, 5M reads/day)
- Cloudflare R2 - object storage for photos (free: 10GB storage, zero egress fees)
- Cloudflare Pages - static site hosting (free: unlimited sites)

**Authentication**:
- JWT tokens stored in httpOnly cookies
- No passwords - magic link authentication via invite system
- Refresh token rotation for security

### System diagram

```
┌─────────────────┐
│   Cloudflare    │
│     Pages       │  ← PWA hosted here
│  (Static site)  │
└────────┬────────┘
         │
         ↓
┌───────────────────┐
│    Cloudflare     │
│     Workers       │  ← API endpoints
│   (Serverless)    │
└────┬─────────┬────┘
     │         │
     ↓         ↓
┌───────────┐ ┌──────────┐
│ Cloudflare│ │Cloudflare│
│    D1     │ │    R2    │
│ (Database)│ │ (Photos) │
└───────────┘ └──────────┘
```

### Data models

**Users table**:
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,  -- Optional, for contact purposes
  role TEXT NOT NULL,  -- 'admin' or 'viewer'
  invite_token TEXT UNIQUE,
  invite_role TEXT,  -- Role that will be assigned when invite is accepted ('admin' or 'viewer')
  invite_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
```

Notes on the schema:
- `invite_role`: The role specified when the invite was created; becomes the user's actual `role` upon acceptance (unless they're the first user, who always becomes admin)
- `invite_token`: Cleared after invite is accepted for security
- First user in the system automatically gets admin role regardless of invite_role

**Push subscriptions table**:
```sql
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Photos table**:
```sql
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,  -- Key in R2 storage
  caption TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  thumbnail_r2_key TEXT,  -- Smaller version for feed
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
```

**Photo views table** (for read receipts):
```sql
CREATE TABLE photo_views (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Photo reactions table**:
```sql
CREATE TABLE photo_reactions (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,  -- The emoji character(s), e.g., "❤️", "😍", "🥰"
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### API endpoints

**Authentication**:
- `POST /api/auth/create-invite` - Generate invite link (admin only)
- `POST /api/auth/accept-invite` - Accept invite, create account, get JWT
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Invalidate refresh token

**Photos**:
- `GET /api/photos` - List all photos (paginated)
- `POST /api/photos` - Upload new photo (admin only)
- `GET /api/photos/:id` - Get specific photo metadata
- `POST /api/photos/:id/view` - Mark photo as viewed
- `GET /api/photos/:id/viewers` - Get list of who viewed (admin only)
- `DELETE /api/photos/:id` - Delete photo (admin only)
- `POST /api/photos/:id/react` - Add or update reaction to photo
- `DELETE /api/photos/:id/react` - Remove reaction from photo
- `GET /api/photos/:id/reactions` - Get all reactions for a photo

**Users**:
- `GET /api/users` - List all users (admin only)
- `GET /api/users/me` - Get current user info
- `PATCH /api/users/:id/role` - Update user role (admin only, can promote to admin or demote to viewer)
- `DELETE /api/users/:id` - Remove user (admin only)

**Push notifications**:
- `POST /api/push/subscribe` - Register push subscription
- `POST /api/push/unsubscribe` - Remove push subscription
- `POST /api/push/test` - Send test notification (admin only)

**R2 signed URLs**:
- `GET /api/photos/:id/url` - Get temporary signed URL for photo download
- `GET /api/photos/:id/thumbnail-url` - Get temporary signed URL for thumbnail

### Security model

**Authentication flow**:

1. **Invite generation** (admin):
   - Admin creates invite with user name
   - System generates cryptographically random invite token (32 bytes)
   - Stores token in database linked to pending user record
   - Returns shareable URL: `https://app.com/invite/{token}`

2. **Invite acceptance**:
   - User clicks invite link
   - Frontend calls `/api/auth/accept-invite` with token
   - Backend validates token, creates user account
   - If this is the first user in the system, automatically assign admin role
   - Otherwise, assign role specified in invite (typically 'viewer')
   - Issues JWT access token (15 min expiry) + refresh token (30 day expiry)
   - Refresh token stored in httpOnly cookie
   - Access token returned in response body

3. **Ongoing authentication**:
   - Access token stored in memory (not localStorage)
   - All API requests include access token in Authorization header
   - When access token expires, auto-refresh using refresh token cookie
   - Service worker caches access token for offline requests

**Photo access control**:

1. Photos stored in R2 with random UUIDs as keys
2. R2 bucket is private (no public access)
3. All photo access requires authentication
4. API generates temporary signed URLs (valid 1 hour) for photo downloads
5. Photos only accessible via signed URLs, not direct R2 URLs

**Security measures**:

- HTTPS only (enforced by Cloudflare)
- CORS configured to only allow requests from your domain
- Rate limiting on all endpoints (Cloudflare Workers built-in)
- JWT tokens use RS256 signing (asymmetric keys)
- httpOnly cookies prevent XSS token theft
- Invite tokens single-use (invalidated after acceptance)
- CSP headers to prevent XSS attacks

**Preventing unauthorized access**:

1. **No public endpoints**: All endpoints require valid JWT
2. **Token verification middleware**: Every request validates JWT signature and expiry
3. **Role-based access**: Admin-only endpoints check user role
4. **Invite-only**: No signup page, only invite links work
5. **Token rotation**: Refresh tokens rotated on use
6. **Revocation**: Removing user deletes all their tokens and subscriptions

### Image processing strategy

**Thumbnail generation**:

Cloudflare Workers have CPU time limits (10ms on free tier, 50ms on paid), which makes real-time server-side image processing challenging. Here's the recommended approach:

1. **Client-side thumbnail generation**:
   - When uploading, generate thumbnail on the client using Canvas API
   - Create 400px wide thumbnail (maintaining aspect ratio)
   - Compress aggressively (60-70% quality) to achieve ~50KB size
   - Upload both full-size and thumbnail to R2 in parallel
   - Benefits: No server CPU time, instant upload, works offline

2. **Fallback server-side generation** (for future admin tools):
   - If uploading from desktop/admin panel, use Cloudflare Images or external service
   - Alternative: Use R2 event notifications + separate Worker to process async
   - Or: Use Cloudflare Image Resizing (paid feature, $0.50 per 1000 images)

3. **Image formats**:
   - Accept JPEG, PNG, HEIC (iPhone default)
   - Convert HEIC to JPEG client-side if possible, or server-side
   - Output: JPEG for both full-size and thumbnails (best compatibility)

4. **Compression library**:
   - Use `browser-image-compression` npm package for client-side work
   - Handles EXIF orientation, maintains quality, works cross-browser
   - Example config:
     ```javascript
     // Full-size: light compression
     const fullSize = await imageCompression(file, {
       maxSizeMB: 2,
       useWebWorker: true,
       maxWidthOrHeight: 1920
     });

     // Thumbnail: aggressive compression
     const thumbnail = await imageCompression(file, {
       maxSizeMB: 0.05,
       useWebWorker: true,
       maxWidthOrHeight: 400
     });
     ```

### Cost management

**Cloudflare free tier limits**:

- **Workers**: 100,000 requests/day
- **D1**: 5GB storage, 5M reads/day, 100k writes/day
- **R2**: 10GB storage, 1M Class A operations/month, 10M Class B operations/month
- **Pages**: Unlimited bandwidth and requests

**Usage estimates** (10 family members, 50 photos/month):

- **Storage**: ~500MB/month (10MB avg per photo)
- **Workers requests**: ~5,000/month (100 photos views + admin actions)
- **D1 reads**: ~5,000/month
- **D1 writes**: ~500/month
- **R2 operations**: ~1,000/month

**Staying within free tier**:

1. **Image optimization**:
   - Smart compression strategy: Keep original quality for photos under 2MB, apply light compression (90% quality JPEG) only for larger images
   - This preserves high quality while preventing extremely large uploads (some phones shoot 10-15MB photos)
   - Generate thumbnails (~50KB) for feed view using aggressive compression
   - Lazy load full-size images only when tapped
   - Original quality images stored in R2, thumbnails used for browsing

2. **Caching**:
   - Service worker caches photos locally
   - Cloudflare CDN caches signed URLs
   - Reduce repeated R2 requests

3. **Efficient queries**:
   - Paginate photo feeds (10-20 at a time)
   - Index database properly
   - Cache user sessions

**Setting hard spending limits**:

Cloudflare doesn't have hard spending caps, but you can:

1. **Set up billing alerts**:
   - Go to Cloudflare dashboard → Notifications
   - Create alert for "Billing" triggers
   - Set threshold at £1, £5, £10
   - Get email when exceeded

2. **Monitor usage weekly**:
   - Check Workers analytics in dashboard
   - Review R2 storage and operations
   - D1 database size and queries

3. **Implement soft limits in code**:
   ```javascript
   // Reject uploads if storage > 9GB (90% of free tier)
   const currentStorage = await getR2StorageSize();
   if (currentStorage > 9 * 1024 * 1024 * 1024) {
     throw new Error('Storage limit reached');
   }
   ```

4. **Fallback plan**:
   - If you exceed free tier, costs are minimal:
   - R2 overage: $0.015/GB storage, $0 egress
   - Workers overage: $0.30 per million requests
   - D1 overage: $0.001 per GB, $0.001 per million reads
   - Realistic worst case: £2-5/month even with 10x usage

**Note**: Cloudflare doesn't automatically charge - they'll notify you before billing starts. You can disable paid features to stay free-tier only.

### Domain and hosting setup

**Domain acquisition**:

1. **Buy domain** (choose one):
   - Cloudflare Registrar: £8-15/year (.com/.app/.family)
   - Namecheap/Google Domains: Similar pricing
   - Recommendation: Use `.family` or `.app` for thematic fit

2. **Transfer to Cloudflare** (if bought elsewhere):
   - Unlock domain at current registrar
   - Get authorization code
   - Transfer to Cloudflare (costs same as renewal, usually £8-12)
   - Benefits: DNS managed in same place as hosting

3. **DNS setup**:
   - Add your domain to Cloudflare
   - Cloudflare provides nameservers
   - Update nameservers at registrar (if not using Cloudflare Registrar)
   - Propagation takes 24-48 hours max

**Cloudflare Pages deployment**:

1. Connect GitHub repo to Cloudflare Pages
2. Configure build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment: Node 18+
3. Cloudflare auto-deploys on every git push to main
4. Custom domain: Add your domain in Pages settings
5. HTTPS automatically provisioned (free SSL cert)

**Cloudflare Workers deployment**:

1. Create Worker in Cloudflare dashboard
2. Deploy using Wrangler CLI:
   ```bash
   npx wrangler deploy
   ```
3. Bind Worker to your domain:
   - Create route: `api.yourdomain.com/*`
   - Or use subdomain: `yourdomain.com/api/*`
4. Bind D1 database and R2 bucket to Worker

**Environment setup**:

Development:
- `http://localhost:5173` - Vite dev server
- `http://localhost:8787` - Wrangler local worker

Production:
- `https://yourdomain.com` - Main app
- `https://yourdomain.com/api/*` - API endpoints

### Infrastructure as Code (IaC)

**Approach**: Use Wrangler configuration and GitHub Actions for automated infrastructure provisioning and deployment.

**What can be automated:**

1. **Wrangler configuration** (`backend/wrangler.toml`):
   - D1 database bindings (database must be created first)
   - R2 bucket bindings (bucket must be created first)
   - Environment variable definitions
   - Worker routes and settings
   - All configuration is version controlled

2. **Database migrations**:
   - SQL migration files in `migrations/` directory
   - Automatically applied via Wrangler CLI
   - Tracked in `schema_migrations` table
   - Can be run in CI/CD pipeline

3. **GitHub Actions workflows**:
   - Automated testing on PR
   - Automated deployment to production on merge to main
   - Database migrations applied automatically
   - Frontend and backend deployed together

**What requires manual setup (one-time):**

1. **Cloudflare account setup**:
   - Create Cloudflare account (free tier)
   - Verify email
   - Set up payment method (required even for free tier, won't be charged)

2. **Initial resource creation**:
   ```bash
   # These commands create the resources (one-time setup)
   npx wrangler d1 create photodrop-db
   npx wrangler r2 bucket create photodrop-photos

   # Copy the database_id from output and add to wrangler.toml
   ```

   **Why manual?** Wrangler doesn't support declarative resource creation in config files yet. You must create D1/R2 resources via CLI, then reference them in wrangler.toml.

3. **GitHub secrets**:
   Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN`: Create at Cloudflare Dashboard → My Profile → API Tokens
     - Use "Edit Cloudflare Workers" template
     - Or create custom token with permissions: Workers Scripts (Edit), D1 (Edit), R2 (Edit), Pages (Edit)
   - `CLOUDFLARE_ACCOUNT_ID`: Found in Cloudflare Dashboard → Workers & Pages → Overview (right sidebar)
   - `JWT_SECRET`: Generate with `openssl rand -base64 32`
   - `VAPID_PUBLIC_KEY`: Generate with `npx web-push generate-vapid-keys`
   - `VAPID_PRIVATE_KEY`: From same command as above

4. **Custom domain setup** (optional):
   - Purchase domain (Cloudflare Registrar or external)
   - Add domain to Cloudflare
   - Configure DNS records
   - Link domain to Pages project in Cloudflare Dashboard

**Deployment workflow**:

The GitHub Actions workflow automates:
1. Run tests on every PR
2. On merge to `main`:
   - Run frontend build
   - Run backend tests
   - Deploy backend Worker via Wrangler
   - Apply database migrations
   - Deploy frontend to Cloudflare Pages
   - Verify deployment health

**Benefits of this approach**:
- Version-controlled infrastructure configuration
- Automated deployments (no manual steps after initial setup)
- Safe migrations (tested in CI before production)
- Rollback capability (git revert + redeploy)
- Multiple environments possible (staging/production)

**Limitations**:
- Cannot fully provision Cloudflare resources via IaC (D1/R2 creation is manual)
- Secrets must be manually added to GitHub
- Custom domain DNS requires Cloudflare Dashboard interaction
- First deployment requires manual Cloudflare account connection

### GitHub Actions workflows

**Workflow files to create:**

1. **`.github/workflows/test.yml`** - Run tests on every PR and push
   - Triggers: Pull requests, pushes to main
   - Jobs:
     - Checkout code
     - Setup Node.js
     - Install dependencies (frontend + backend)
     - Run frontend tests
     - Run backend tests
     - Report test results

2. **`.github/workflows/deploy.yml`** - Deploy to production on merge to main
   - Triggers: Push to main branch
   - Jobs:
     - Run all tests first (fail fast if tests fail)
     - Deploy backend:
       - Install dependencies
       - Run backend tests
       - Deploy Worker via `wrangler deploy`
       - Apply database migrations
       - Set environment secrets (JWT_SECRET, VAPID keys)
     - Deploy frontend:
       - Install dependencies
       - Build production bundle
       - Deploy to Cloudflare Pages
     - Health check:
       - Verify API health endpoint responds
       - Verify frontend loads

**Required GitHub Actions secrets:**

Set these in: Repository Settings → Secrets and variables → Actions → New repository secret

- `CLOUDFLARE_API_TOKEN` - API token with Workers/D1/R2/Pages permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID
- `JWT_SECRET` - Secret for JWT signing (base64, 32+ bytes)
- `VAPID_PUBLIC_KEY` - VAPID public key for push notifications
- `VAPID_PRIVATE_KEY` - VAPID private key for push notifications

**Environment-specific deployments (optional future enhancement):**

Create separate workflows for staging vs production:
- `.github/workflows/deploy-staging.yml` - Deploy to staging on PR
- `.github/workflows/deploy-production.yml` - Deploy to production on main
- Use different Cloudflare resources (separate D1/R2) per environment
- Use GitHub environments to manage secrets per deployment target

**Workflow features:**

- Automatic rollback on failed health checks
- Slack/Discord notifications on deployment success/failure
- Manual approval gates for production deployments
- Deployment previews for PRs (Cloudflare Pages preview deployments)

## User flows

### Parent uploading a photo

1. Open PWA (already logged in from previous session)
2. Tap floating "+" button
3. Camera/gallery picker appears
4. Select photo
5. Image compressed client-side
6. Optional: Add caption
7. Tap "Send"
8. Photo uploads to R2
9. Thumbnail generated server-side
10. Push notifications sent to all family members
11. Success confirmation shown
12. Photo appears in feed

### Family member receiving a photo

1. Phone shows push notification: "New photo from Tom & [wife]!"
2. Tap notification
3. PWA opens to photo detail view
4. Full-size image loads (thumbnail shown first)
5. View recorded in database
6. Can swipe to next/previous photos

### Invite and onboarding flow

1. **Admin creates invite**:
   - Go to "Family" tab
   - Tap "Invite someone"
   - Enter name: "Grandma Smith"
   - Optional: Phone number
   - Optional: Select role (Admin or Viewer) - defaults to Viewer
   - Tap "Create invite"
   - Copy shareable link
   - Send via WhatsApp/text
   - Note: Typically only create admin invites for the other parent initially

2. **Family member accepts invite**:
   - Receives message: "Join our baby photo app! [link]"
   - Taps link
   - Lands on personalized welcome page
   - Shows: "Hi Grandma! Tom and [wife] want to share baby photos with you"

3. **Installation steps** (auto-detected platform):

   **iOS**:
   - Step 1: "Tap Share button (box with arrow)"
   - Step 2: "Tap 'Add to Home Screen'"
   - Step 3: "Tap 'Add'"
   - Animated GIF shows exact steps

   **Android**:
   - Step 1: "Tap three dots menu"
   - Step 2: "Tap 'Install app'"
   - Shows screenshot

4. **Open installed app**:
   - "Now tap the icon on your home screen"
   - Shows what icon looks like

5. **Grant permissions**:
   - App opens, shows welcome
   - "We need permission to notify you about new photos"
   - Tap "Enable notifications"
   - Browser shows permission prompt
   - User taps "Allow"

6. **Complete**:
   - "You're all set!"
   - Admin dashboard shows test notification button
   - Admin sends test: "Testing! You should see this notification"
   - User receives test notification
   - Success state shown

7. **Account created**:
   - Refresh token cookie set (30 day expiry)
   - User marked as active
   - No password needed - they're permanently logged in

### Role management

**Multiple admins support**:

1. **Initial setup**:
   - First user created (via first invite) is automatically an admin
   - This is typically one of the parents who sets up the app
   - They can then promote other users to admin (e.g., the other parent)

2. **Promoting users to admin**:
   - Any admin can promote a viewer to admin via user management interface
   - API call: `PATCH /api/users/:id/role` with `{ "role": "admin" }`
   - Useful for giving both parents full control
   - Can also promote trusted family members if needed

3. **Demoting admins**:
   - Any admin can demote another admin to viewer
   - Safety rule: Cannot demote yourself if you're the last admin (prevents lockout)
   - Prevents accidental loss of all admin access

4. **Admin capabilities**:
   - Upload photos
   - Delete photos
   - Create invites
   - Manage users (view all users, promote/demote roles, remove users)
   - View photo analytics (who viewed what)
   - Send test notifications

5. **Viewer capabilities**:
   - View all photos
   - React to photos
   - Receive notifications
   - Cannot upload, delete, or manage users

6. **Safety considerations**:
   - Always maintain at least one admin
   - Log all role changes for security audit
   - Consider adding confirmation dialog: "Promote [name] to admin? They will be able to upload and delete photos."

### Staying logged in

**Session persistence**:

1. **Initial login** (via invite acceptance):
   - Refresh token (30 day expiry) stored in httpOnly cookie
   - Access token (15 min expiry) stored in app memory
   - User considered "logged in"

2. **Returning to app**:
   - Service worker loads app shell from cache (instant)
   - App checks for access token in memory
   - If missing (app was closed), checks for refresh token cookie
   - If refresh token exists, automatically requests new access token
   - User sees app instantly, photos load in background

3. **Token refresh**:
   - Access token expires every 15 minutes
   - App automatically refreshes using refresh token cookie
   - Happens silently in background
   - User never sees "logged out" state unless they explicitly logout

4. **Logout**:
   - User taps "Logout" in settings
   - App calls `/api/auth/logout`
   - Server invalidates refresh token
   - Cookie cleared
   - User redirected to logged-out landing page

5. **Token expiry**:
   - Refresh token expires after 30 days of no use
   - User must click invite link again to re-authenticate
   - For family members who check regularly, effectively permanent login

**Offline behavior**:

- Service worker caches app shell and previously viewed photos
- User can browse cached photos without internet
- Upload queue holds photos until online
- When back online, queued photos auto-upload
- Sync badge shows pending uploads

### Photo deletion

**Admin capabilities**:

1. **Delete individual photos**:
   - Admins can delete any photo from the admin dashboard or photo detail view
   - Confirmation dialog shows: "Delete this photo? This cannot be undone."
   - Upon confirmation, photo and thumbnail removed from R2
   - Database records deleted (cascading to views and reactions)
   - All family members' cached versions eventually cleared

2. **What gets deleted**:
   - Photo record in database
   - Full-size image from R2
   - Thumbnail from R2
   - All photo_views entries (cascading delete)
   - All photo_reactions entries (cascading delete)

3. **Deletion flow**:
   - User taps delete button → confirmation dialog → API call to `DELETE /api/photos/:id`
   - Backend validates admin role
   - Deletes database record (cascades to views/reactions)
   - Deletes R2 objects (both full-size and thumbnail)
   - Returns success
   - Frontend removes photo from local cache and UI

4. **Soft delete option** (future enhancement):
   - Instead of hard delete, mark photos as deleted with `deleted_at` timestamp
   - Hide from normal views but keep in archive for 30 days
   - Allows "undo" functionality
   - Permanently delete after 30 days via cleanup job

### Password reset (not applicable)

Since this app uses **magic link authentication** (invite-only), there are no passwords to reset. Instead:

**If user needs new access**:

1. Admin creates new invite for them
2. User clicks new invite link
3. If previous account exists, new tokens issued
4. Old tokens invalidated
5. User logged back in

**If device is lost**:

1. User gets new device
2. Clicks original invite link (if saved) OR admin creates new invite
3. Logs in on new device
4. Old device's tokens still valid until they expire or user logs out

**If user accidentally logs out**:

1. User can't log back in (no login page)
2. User contacts admin
3. Admin sends them their original invite link (saved in admin panel)
4. Or admin creates fresh invite
5. User clicks link, logged back in

**Security consideration**: This is actually more secure than passwords because:
- No weak passwords
- No password reuse across sites
- No phishing attacks for passwords
- Token-based auth with automatic expiry
- Admin has full control over access

## Implementation roadmap

### Phase 1: Foundation ✅

**Stage 1: Project setup** ✅
- [x] Initialize git repository
- [x] Set up Vite + React + TypeScript project
- [x] Configure Tailwind CSS
- [x] Set up Cloudflare Workers project structure
- [x] Configure Wrangler for local development
- [x] Create infrastructure automation (Nix + bash scripts)
- [x] Set up basic folder structure
- [x] Configure Vitest for unit testing
- [x] Set up Testing Library for React
- [x] Configure test scripts in package.json
- [x] Set up GitHub Actions CI with Nix

**Stage 2: Authentication system** ✅
- [x] Implement JWT generation and validation (HMAC-SHA256)
- [x] Write unit tests for JWT functions (27/27 passing)
- [x] Create invite token generation endpoint
- [x] Write unit tests for invite token generation
- [x] Build invite acceptance endpoint
- [x] Implement refresh token rotation
- [x] Create auth middleware for Workers
- [x] Write unit tests for auth middleware
- [x] Build login state management in React (AuthContext)
- [x] Create API client with auth interceptors

**Stage 3: Core upload flow** ✅
- [x] Build photo upload UI (PhotoUpload component)
- [x] Implement client-side image compression (browser-image-compression)
- [x] Create photo upload API endpoint (with thumbnail support)
- [x] Set up R2 storage integration
- [x] Implement thumbnail generation (client-side, 400px)
- [x] Create photo listing endpoint (paginated)
- [x] Build photo feed UI (PhotoFeed component with lightbox)
- [x] Add photo views tracking + reactions endpoints
- [x] Add photo deletion endpoint (admin only)
- [x] Create user management endpoints

**Infrastructure** ✅
- [x] Automated setup scripts (dev/prod)
- [x] Deployment automation (manual + GitHub Actions)
- [x] Nix integration for reproducible environments
- [x] Secret scanning with gitleaks
- [x] Database migrations
- [x] Teardown scripts

### Phase 2: PWA features

**Stage 1: Service worker**
- [ ] Set up Workbox for service worker
- [ ] Implement offline caching strategy
- [ ] Add install prompt handling
- [ ] Create offline fallback page
- [ ] Test offline functionality

**Stage 2: Push notifications**
- [ ] Generate VAPID keys
- [ ] Implement web push API integration
- [ ] Create subscription storage endpoints
- [ ] Build notification trigger on photo upload
- [ ] Create notification permission UI flow
- [ ] Test notifications on iOS and Android

**Stage 3: Invite and onboarding**
- [ ] Build admin invite creation UI
- [ ] Create invite landing page with platform detection
- [ ] Design installation instruction screens
- [ ] Implement step-by-step onboarding flow
- [ ] Add test notification feature
- [ ] Test full onboarding on multiple devices

### Phase 3: Polish and features

**Stage 1: Admin features**
- [ ] Build user management interface
- [ ] Implement role management (promote/demote users)
- [ ] Add safety check (prevent demoting last admin)
- [ ] Create photo viewer tracking
- [ ] Implement delivery status UI
- [ ] Add user removal functionality
- [ ] Implement photo deletion (admin only)
- [ ] Add deletion confirmation dialog
- [ ] Ensure R2 cleanup when photos deleted
- [ ] Create admin dashboard

**Stage 2: User experience**
- [ ] Add photo captions
- [ ] Implement photo detail view
- [ ] Create photo gallery with swipe navigation
- [ ] Add emoji reactions to photos
- [ ] Build reaction storage and display
- [ ] Add loading states and skeletons
- [ ] Improve error handling and user feedback
- [ ] Add optimistic UI updates

**Stage 3: Testing and deployment**
- [ ] Register domain
- [ ] Configure Cloudflare DNS
- [ ] Deploy Workers to production
- [ ] Deploy Pages to production
- [ ] Set up SSL certificates
- [ ] Test on multiple devices (iOS + Android)
- [ ] Fix any issues found
- [ ] Create backup and monitoring plan

### Phase 4: Launch preparation

**Stage 1: Documentation**
- [ ] Write user guide for family members
- [ ] Create troubleshooting documentation
- [ ] Document admin features
- [ ] Set up monitoring alerts

**Stage 2: Beta testing**
- [ ] Invite 2-3 family members for beta
- [ ] Collect feedback
- [ ] Fix critical issues
- [ ] Refine UI based on feedback

**Stage 3: Full launch**
- [ ] Send invites to all family members
- [ ] Provide 1-on-1 setup help as needed
- [ ] Monitor for issues
- [ ] Celebrate! 🎉

## Future enhancements

**After launch, consider adding**:

### Nice-to-haves
- Multiple photo upload (batch)
- Video support (if within storage limits)
- Photo albums/grouping
- Search and filtering
- Dark mode
- Photo download option for family members
- Comments on photos (opt-in, to maintain simplicity)
- Reaction emojis (hearts, likes)

### Advanced features
- Progressive image loading (blur-up)
- Photo editing (crop, rotate, filters)
- Automatic face detection and tagging
- Print ordering integration
- Export to Google Photos/iCloud
- Shared family calendar
- Milestone tracking (first smile, first steps)

### Technical improvements
- Automated image optimization pipeline
- CDN caching optimization
- Database query optimization
- Accessibility improvements (screen reader support)
- Internationalization (if family speaks multiple languages)
- Analytics (privacy-respecting, self-hosted)

## Testing strategy

### Testing framework setup

**Stage 1: Initial setup (Phase 1)**:
- Set up Vitest for unit testing (fast, Vite-native)
- Configure test environment for Node and browser code
- Add test scripts to package.json
- Set up basic CI (GitHub Actions) to run tests on PRs

**Tools**:
- **Vitest**: Unit and integration tests (for both frontend and backend)
- **Testing Library**: React component testing
- **MSW (Mock Service Worker)**: API mocking for frontend tests
- **Miniflare**: Local Cloudflare Workers testing environment

### Unit tests

**Priority: High - implement in Phase 1-2**

Tests to write as you build features:

1. **Authentication** (Phase 1, Stage 2):
   - JWT generation creates valid tokens
   - JWT validation rejects expired/invalid tokens
   - Invite token generation is cryptographically random
   - Refresh token rotation works correctly
   - Role-based access control (admin vs viewer)

2. **Image processing** (Phase 1, Stage 3):
   - Thumbnail generation produces correct dimensions
   - Image compression respects quality settings
   - HEIC conversion works
   - File size limits enforced

3. **Database queries** (Throughout):
   - Photo listing with pagination
   - User lookup by ID and invite token
   - Reaction adding/updating/removing
   - View tracking

4. **Push notifications** (Phase 2, Stage 2):
   - Notification payload generation
   - Subscription storage and retrieval
   - VAPID key validation

### Integration tests

**Priority: Medium - implement in Phase 2-3**

Test complete workflows:

1. **Auth flow**:
   - Admin creates invite → user accepts → JWT issued → user can access protected endpoints

2. **Photo upload flow**:
   - Upload photo → stored in R2 → thumbnail generated → appears in feed → push notification sent

3. **Reaction flow**:
   - User views photo → adds reaction → reaction appears for all users → user changes reaction → updates correctly

4. **Token refresh**:
   - Access token expires → automatic refresh → user stays logged in

### End-to-end tests

**Priority: Low - implement in Phase 4 (post-launch)**

Full browser automation testing:

- Use Playwright for E2E tests
- Test critical paths only (not worth the maintenance burden for everything)
- Run against staging environment

Critical E2E tests:
1. Complete onboarding flow (invite accept → install → notifications)
2. Photo upload and viewing
3. Offline mode and sync

**Why E2E comes later**:
- High maintenance cost (UI changes break tests)
- Slow to run
- Manual testing catches most issues initially
- Automated E2E adds most value once UI is stable

### Testing during development

**Phase 1-2 approach**:
- Write unit tests alongside features
- Run tests before committing: `npm test`
- Manual testing for UI and integration
- Test on real devices (iOS + Android) weekly

**Phase 3-4 approach**:
- Add integration tests for complete flows
- Set up CI/CD to block PRs with failing tests
- Manual testing on multiple devices before major releases
- Consider E2E tests for critical paths

### Manual testing checklist
- [ ] Install PWA on iOS (multiple iOS versions if possible)
- [ ] Install PWA on Android
- [ ] Test photo upload from both platforms
- [ ] Verify push notifications arrive
- [ ] Test offline mode
- [ ] Verify photos load from cache when offline
- [ ] Test with slow network (3G simulation)
- [ ] Verify images compress correctly
- [ ] Test invite flow with non-technical user
- [ ] Test admin features (user management, etc.)
- [ ] Verify signed URLs expire correctly
- [ ] Test cross-device login
- [ ] Verify tokens refresh automatically

### Browser compatibility
- iOS Safari 16.4+
- Android Chrome (latest 2 versions)
- Desktop Chrome/Edge/Firefox (for admin tasks)

## Database migrations

### Migration strategy

D1 doesn't have built-in migration tooling like traditional ORMs, so you'll need to manage schema changes manually:

1. **Initial schema setup**:
   - Create `migrations/` folder in your project
   - Store each migration as a numbered SQL file: `001_initial_schema.sql`, `002_add_reactions.sql`, etc.
   - Run migrations via Wrangler CLI: `wrangler d1 execute DB_NAME --file=migrations/001_initial_schema.sql`

2. **Migration tracking**:
   - Create a migrations table to track what's been applied:
     ```sql
     CREATE TABLE schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at INTEGER NOT NULL,
       description TEXT
     );
     ```
   - Before running a migration, check if it's already applied
   - Record successful migrations in this table

3. **Development vs production**:
   - Local development: Use `wrangler d1 execute DB_NAME --local --file=migrations/XXX.sql`
   - Production: Use `wrangler d1 execute DB_NAME --file=migrations/XXX.sql` (without --local flag)
   - Always test migrations locally first

4. **Making schema changes**:
   - Create new migration file with incremented number
   - Write both `UP` and `DOWN` SQL (for rollback capability)
   - Test migration locally
   - Apply to production during low-traffic period
   - Example migration file:
     ```sql
     -- Migration 002: Add photo reactions
     -- UP
     CREATE TABLE photo_reactions (
       photo_id TEXT NOT NULL,
       user_id TEXT NOT NULL,
       emoji TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (photo_id, user_id),
       FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
     );

     -- DOWN (for rollback, keep commented)
     -- DROP TABLE photo_reactions;
     ```

5. **Backup before migrations**:
   - Export database before major schema changes: `wrangler d1 export DB_NAME --output=backup.sql`
   - Store backups in version control or secure storage
   - Can restore via: `wrangler d1 execute DB_NAME --file=backup.sql`

6. **Safe migration practices**:
   - Additive changes are safest (new tables, new columns with defaults)
   - Avoid renaming columns (add new, migrate data, remove old)
   - Use transactions where possible
   - Never delete data in a migration (archive instead)
   - Test with production data copy when possible

## Monitoring and maintenance

### Usage monitoring
- Track monthly storage usage (R2)
- Monitor Workers request count
- Check D1 database size and queries
- Review error logs weekly

### Health checks
- Set up Cloudflare Worker for /health endpoint
- Use external uptime monitor (UptimeRobot free tier)
- Monitor push notification delivery rates

### Backup strategy
- D1 database: Export monthly via Wrangler CLI
- R2 photos: Enable versioning (free feature)
- Code: Git repository with regular commits
- Critical data: Manual export of user list monthly

### Incident response
- If notifications stop: Check VAPID keys, verify worker deployment
- If uploads fail: Check R2 storage limits, verify CORS settings
- If auth breaks: Verify JWT signing keys, check token expiry logic
- If performance degrades: Review Workers analytics, optimize queries

## Security checklist

Before launch:
- [ ] HTTPS enforced on all endpoints
- [ ] CORS configured correctly
- [ ] JWT tokens using strong signing algorithm (RS256)
- [ ] Refresh tokens in httpOnly cookies
- [ ] Rate limiting enabled
- [ ] CSP headers configured
- [ ] R2 bucket is private (no public access)
- [ ] Signed URLs expire within 1 hour
- [ ] Invite tokens are cryptographically random
- [ ] Invite tokens invalidated after use
- [ ] SQL queries use prepared statements (D1 does this automatically)
- [ ] User input sanitized on backend
- [ ] Error messages don't leak sensitive info
- [ ] Admin endpoints protected with role check
- [ ] Service worker caches don't store tokens
- [ ] No sensitive data in client-side logs

## Privacy considerations

- **No third-party analytics**: All data stays within Cloudflare
- **No tracking cookies**: Only auth cookies (functional, not tracking)
- **Minimal data collection**: Only name, optional phone, photos
- **Right to deletion**: Admin can remove users and their data
- **Data retention**: Photos stored indefinitely unless manually deleted
- **GDPR compliance**: Since family-only, likely exempt, but respect privacy anyway
- **Photo ownership**: Clear that parents control all photos
- **Access logs**: Only stored for debugging, not analyzed

## Troubleshooting guide

### Common issues

**"I can't add to home screen"**:
- iOS: Must use Safari browser, not Chrome/Firefox
- Android: Most browsers support it, try Chrome
- Check iOS version: Requires 16.4+
- Screenshot current browser and share for debugging

**"Notifications aren't working"**:
- Verify notification permission granted in settings
- Check if PWA is installed (not just bookmarked)
- Try sending test notification from admin panel
- iOS: Must open app from home screen icon, not browser
- Reinstall PWA if all else fails

**"Photos won't upload"**:
- Check internet connection
- Verify photo size (<10MB)
- Try different photo
- Check storage limits in admin panel
- Clear service worker cache and retry

**"App keeps logging me out"**:
- Check if cookies are blocked in browser settings
- Verify not using private/incognito mode
- Check if refresh token has expired (30 days)
- May need new invite link if tokens corrupted

**"App won't load offline"**:
- Service worker may not be installed
- First load requires internet
- Try force-reload (pull to refresh)
- Check if service worker is enabled in browser settings

## Questions for later

- Do we want read receipts visible to all users or just admins?
- Should there be a daily/weekly digest notification option?
- Do we want photo expiry (auto-delete after X months)?
- Should we support multiple albums (pregnancy, newborn, milestones)?
- Do we want in-app messaging or keep it notification-only?

## Success metrics

How we'll know it's working:
- All family members successfully onboarded (100% completion rate)
- Notifications arrive within 60 seconds of upload
- Zero cost for first 6 months (stay in free tier)
- Photos load in <2 seconds on 4G
- Positive feedback from family members
- Used regularly (at least 1-2 uploads per week)

## Notes

- This is a living document - update as features change
- Keep complexity low - resist feature creep
- Prioritize reliability over features
- Family members are the real QA team
- Document all Cloudflare setup steps for reproducibility
- Keep original invite links saved securely (for re-sharing if needed)
