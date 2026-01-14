# photodrop - Project plan

## Status

**Current implementation:**
- ✅ Phase 1 (Foundation): Complete - photo upload/feed, JWT auth, user management
- ✅ Phase 1.5 (Email Auth): Complete - magic links working, mock email for local dev
- ✅ Phase 1.6 (UI Polish): Complete - warm terracotta design, responsive layout
- ✅ Phase 1.7 (Multi-group): Complete - users can belong to multiple groups
- ✅ Phase 1.8 (Owner role): Complete - immutable owner role per group
- ✅ Phase 2.1 (Install prompts): Complete - PWA setup, platform-specific install instructions
- ✅ Phase 2.1.5 (Production deployment): Complete - deployed with CI/CD
- ✅ Phase 2.2 (Email delivery): Complete - Resend integration for magic links
- ✅ Phase 2.3 (Push notifications): Complete - bell UI, per-group subscriptions, tests done
- ✅ Phase 2.4 (Offline caching): Complete - service worker caching, offline indicator
- ✅ Phase 2.5 (Reactions and comments): Complete - emoji reactions, comments, privacy mode
- ❌ Phase 2.5.1 (Profile colors): Not started - colored avatars with initials, user menu
- ❌ Phase 2.6 (Production hardening): Not started - rate limiting, CSP
- ❌ Phase 3 (Polish): Not started - UX improvements, video, accessibility
- ❌ Phase 4 (Launch): Not started - beta testing, full launch

---

## Overview

A PWA for privately sharing photos within isolated groups. Each group has its own admins and members with complete data isolation. Group admins upload photos with one tap; members receive instant push notifications. Built on Cloudflare's free tier.

**Use cases:** Family photos, travel photos, event photos - each in separate isolated groups.

**Multi-tenancy:** Each group is completely isolated. Users can belong to multiple groups (with different roles in each), but data between groups is never shared. When viewing a group, users only see that group's photos and members.

## Core requirements

### Functional

**Group admins:**
- Upload photos with optional captions
- Manage member invitations and roles
- View delivery status (who has seen what)
- Delete photos from their group

**Group members:**
- View all photos in their group (newest first)
- React with emojis
- Receive push notifications for new photos
- Simple email-based onboarding
- Offline support with sync

**Group isolation (critical):**
- Complete data isolation between groups
- Users can belong to multiple groups (via memberships table)
- Each session operates in one group context at a time
- All queries scoped by group_id from current session

### Non-functional

- **Security:** Photos only accessible within same group
- **Cost:** Stay within Cloudflare free tier (£0/month target)
- **Performance:** Fast photo loading, notifications within seconds
- **Reliability:** iOS 16.4+ and modern Android
- **Privacy:** No tracking, no third-party analytics

## Architecture

### Technology stack

**Frontend (PWA):** React + Vite, TypeScript, Tailwind CSS, Workbox, Web Push API

**Backend:** Cloudflare Workers, D1 (SQLite), R2 (object storage), Pages (hosting), Email Workers

**Authentication:** Passwordless email (magic links), JWT tokens with httpOnly cookies, 15-minute expiry magic links

### System diagram

```
┌─────────────────┐
│   Cloudflare    │
│     Pages       │  ← PWA hosted here
└────────┬────────┘
         ↓
┌───────────────────┐
│    Cloudflare     │
│     Workers       │  ← API endpoints
└────┬─────────┬────┘
     ↓         ↓
┌───────────┐ ┌──────────┐
│    D1     │ │    R2    │
│ (Database)│ │ (Photos) │
└───────────┘ └──────────┘
```

### Design system

**Philosophy:** Warm, earthy, approachable aesthetic. Bold typography, high contrast, clean interface focused on photos.

**Colors:** Warm terracotta/clay primary palette, warm gray neutrals, forest green accents. All combinations meet WCAG 2.1 AA contrast requirements.

**Accessibility requirements:**
- 4.5:1 minimum contrast for interactive elements
- All elements keyboard accessible with visible focus indicators
- Semantic HTML with ARIA labels
- 44x44px minimum touch targets
- Respect `prefers-reduced-motion`

### Data models

```sql
-- Groups (owner_id guarantees every group has an immutable owner)
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Users (account info only, no group affiliation)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Memberships (junction table: users can belong to multiple groups)
-- Note: owner is stored in groups.owner_id, but also has 'admin' role here
CREATE TABLE memberships (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'admin' or 'member' (owner has 'admin' role)
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Magic links (temporary, single-use)
CREATE TABLE magic_link_tokens (
  token TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  email TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'invite' or 'login'
  invite_role TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Photos (group_id required for isolation)
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  thumbnail_r2_key TEXT,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Plus: photo_views, photo_reactions tables (push_subscriptions will be added in Phase 2)
```

**Critical:** All queries MUST filter by group_id (from JWT) to prevent cross-group access.

### API endpoints

**Authentication:**
- `POST /auth/send-invite` - Send invite email (admin only, scoped to admin's group)
- `POST /auth/send-login-link` - Send login link (public, looks up user by email)
- `POST /auth/verify-magic-link` - Verify token and issue JWT
- `POST /auth/refresh` - Refresh JWT
- `POST /auth/logout` - Invalidate refresh token
- `POST /auth/switch-group` - Switch to different group (issues new tokens)
- `POST /auth/select-group` - Initial group selection for multi-group users (after login)

**Groups:**
- `GET /groups` - List groups current user is a member of (with roles)
- `GET /groups/:groupId/members` - List members of a group (admin only)
- `PATCH /groups/:groupId/members/:userId` - Update member role (admin only)
- `DELETE /groups/:groupId/members/:userId` - Remove user from group (admin only)

**Group + admin creation:** CLI script only (no public endpoint)
```bash
nix run .#create-group -- "Group Name" "Admin Name" "admin@example.com"
```

**Photos:** All endpoints validate group_id
- `GET /photos` - List photos (paginated)
- `POST /photos` - Upload (admin only)
- `DELETE /photos/:id` - Delete (admin only)
- `POST /photos/:id/view` - Mark viewed
- `POST /photos/:id/react` - Add reaction
- `GET /photos/:id/url` - Get signed URL

**Users:** All endpoints validate group_id
- `GET /users` - List users (admin only)
- `GET /users/me` - Current user
- `PATCH /users/:id/role` - Update role (admin only)
- `DELETE /users/:id` - Remove user (admin only)

### Security model

**Authentication flow:**
1. First admin created via CLI script (secure, no public endpoint)
2. Admin invites users via email (magic link scoped to admin's group)
3. User clicks link → account created → JWT issued with group_id claim
4. Returning users request login links (self-service)

**Photo access:**
- R2 bucket is private; all access via signed URLs
- API validates user's group_id matches photo's group_id before generating URLs
- Signed URLs expire in 1 hour

**Security measures:**
- HTTPS only, CORS restricted, rate limiting
- JWT with HS256, httpOnly cookies
- Magic links: cryptographically random, single-use, 15-minute expiry
- CSP headers, SQL injection protection (D1 prepared statements)

### Image processing

**Client-side approach** (avoids Worker CPU limits):
- Generate 800px thumbnail on client using Canvas API
- Compress thumbnails to ~200KB at 85% quality
- Upload both full-size and thumbnail to R2 in parallel
- Use `browser-image-compression` library

### Cost management

**Free tier limits:** Workers 100k req/day, D1 5GB/5M reads, R2 10GB storage

**Estimates (10 viewers, 50 photos/month):** ~500MB storage, ~5k requests - well within free tier.

**Staying free:** Thumbnail-first loading, service worker caching, paginated feeds, soft limits in code.

## User flows

### Photo upload (admin)
1. Tap "+" → select photo → compress client-side → add caption → upload
2. Push notifications sent to all group members
3. Photo appears in feed

### Invite flow
1. Admin enters name, email, role → sends invite
2. User receives email with magic link (15 min expiry)
3. Click link → account created → logged in with group context

### Self-service login
1. Enter email → receive login link → click → logged in
2. No admin intervention needed

### Session persistence
- Refresh token (30 day) in httpOnly cookie
- Access token (15 min) in memory, auto-refreshes
- Offline: service worker caches app shell and viewed photos

## Implementation roadmap

### Phase 1: Foundation ✅

- [x] Project setup (Vite, React, TypeScript, Tailwind, Workers)
- [x] JWT auth system (HMAC-SHA256, refresh rotation)
- [x] Photo upload/feed with R2 storage and thumbnails
- [x] User management endpoints
- [x] Infrastructure automation (Nix, migrations)
- [x] GitHub Actions CI (lint, format, build, test, e2e, secrets scan, deploy)

### Phase 1.5: Email auth + multi-group ✅

**Completed:**
- [x] Email service scaffolding (templates ready)
- [x] Magic link service
- [x] Database layer updated for groups
- [x] API endpoints updated for group isolation
- [x] Formatting/linting setup
- [x] Mock email delivery for local testing (magic links logged to console)
- [x] Login page (email input → send link)
- [x] Magic link verification page (`/auth/:token`)
- [x] Invite form component
- [x] Update App.tsx with routing (React Router)
- [x] Update AuthContext for email flow
- [x] `scripts/create-group.sh` CLI script

**Local testing:**
```bash
nix run .#db-seed  # Create test users (one time)
nix run .#dev      # Start servers (auto-setup on first run)

# Test: Go to /login, enter admin@test.com, copy magic link from console
```

### Phase 1.6: UI polish ✅

**Completed:**
- [x] Warm terracotta color palette (#c67d5a primary, warm cream background)
- [x] Landing page with centered sign-in
- [x] Login page with responsive form layout
- [x] Consistent button styles across app
- [x] Photo feed with single-column card layout
- [x] Lightbox for full-size image viewing
- [x] Sticky header with tabs
- [x] Admin delete button for photos
- [x] Improved thumbnail quality (800px, 85% quality)
- [x] Auth middleware support for query param tokens (for image URLs)
- [x] Atomic photo upload with R2 cleanup on failure
- [x] Dark mode toggle (system/light/dark)

### Phase 1.7: Multi-group membership ✅

**Goal:** Allow users to belong to multiple groups with different roles in each. One login grants access to all groups; users switch between groups via a header dropdown.

**Backend changes:**

- [x] New `Membership` type and DB functions:
  - `getUserMemberships(db, userId): Membership[]`
  - `getMembership(db, userId, groupId): Membership | null`
  - `createMembership(db, userId, groupId, role)`
  - `updateMembershipRole(db, userId, groupId, role)`
  - `deleteMembership(db, userId, groupId)`
- [x] Update `User` type: remove `group_id` and `role` fields
- [x] Update `createUser()`: no longer takes groupId/role
- [x] Update `getUserByEmail()`: returns user without group context
- [x] New auth endpoint `POST /auth/switch-group`:
  - Verify user has membership in requested group
  - Issue new access/refresh tokens with that groupId
  - Return new tokens + group info
- [x] New endpoint `GET /groups`:
  - Return all groups the current user is a member of
  - Include role for each group
- [x] New endpoint `GET /groups/:groupId/members`:
  - Admin only - list all members of a group with their roles
- [x] New endpoint `PATCH /groups/:groupId/members/:userId`:
  - Admin only - update member role
  - Cannot demote yourself if you're the last admin
- [x] New endpoint `DELETE /groups/:groupId/members/:userId`:
  - Admin only - remove a user from the group
  - Deletes membership record (user account remains)
  - Cannot remove yourself if you're the last admin
- [x] Update magic link verification:
  - For invites: create user (if needed) + create membership
  - For login: look up user, get their memberships
  - If single group → issue token for that group
  - If multiple groups → issue token with `groupId: null`, frontend shows picker
- [x] Update `requireAuth` middleware:
  - Validate groupId in token against memberships table
  - Populate `c.get('membership')` with role from memberships table
- [x] Update invite flow:
  - Check if email already exists as user
  - If yes: just create membership (user joins another group)
  - If no: create user + membership

**Frontend changes:**

- [x] New `GroupSwitcher` component (header dropdown):
  - Reuse keyboard navigation pattern from `ThemeToggle` (Arrow keys, Home/End, Escape)
  - Show current group name with dropdown indicator
  - List all user's groups with role badges
  - Call switch-group API on selection
  - Refresh app state after switch
- [x] Update `AuthContext`:
  - Store `currentGroup` and `groups` list
  - Add `switchGroup(groupId)` function
  - Handle multi-group login flow (show picker if needed)
- [x] New `GroupPickerPage` for post-login group selection:
  - Shown when user has multiple groups and no current selection
  - Grid/list of group cards
  - Selecting a group calls switch-group and redirects to feed
  - Empty state for users with no groups: "You're not a member of any groups yet. Ask someone to invite you."
- [x] Update header to include `GroupSwitcher` next to `ThemeToggle`
- [x] Update `InviteForm`:
  - Handle case where invited email already has an account
  - Show appropriate success message ("Invite sent" vs "User added to group")
- [x] New `MembersPage` or `MembersList` component (admin only):
  - List all members of current group with their roles
  - Role toggle/dropdown to promote member → admin or demote admin → member
  - Remove button for each member (with confirmation)
  - Cannot remove yourself if you're the last admin
  - Cannot demote yourself if you're the last admin
  - Accessible from a new "Members" tab (admin only)

**Login flow (updated):**

1. User enters email → receives magic link
2. User clicks link → backend verifies token
3. If new user: create user + membership, issue token for that group
4. If existing user with one group: issue token for that group
5. If existing user with multiple groups:
   - Issue token with no groupId (or special "picker" state)
   - Frontend shows GroupPickerPage
   - User selects group → switch-group API → token with groupId → redirect to feed
6. If existing user with zero groups:
   - Issue token with no groupId
   - Frontend shows GroupPickerPage with empty state
   - User waits to be invited to a group

**Testing:**

Unit tests (Vitest):
- [x] `getUserMemberships()` returns all memberships for a user
- [x] `getUserMemberships()` returns empty array for user with no groups
- [x] `getMembership()` returns correct role for user+group
- [x] `createMembership()` handles new membership creation
- [x] `createMembership()` fails gracefully for duplicate membership
- [x] `deleteMembership()` removes membership but keeps user account
- [x] `updateMembershipRole()` changes role correctly
- [x] Switch-group token generation includes correct groupId
- [x] Switch-group rejects if user not a member of group

E2E tests (Playwright):
- [x] User with single group logs in directly to feed (no picker)
- [x] User with multiple groups sees group picker after login
- [x] User can select group from picker and lands on correct feed
- [x] User with zero groups sees empty state after login
- [x] Group switcher dropdown shows all user's groups
- [x] Switching groups via dropdown loads new group's photos
- [x] User invited to second group can access both groups
- [x] Admin of group A cannot see photos from group B
- [x] Role is correct per-group (admin in A, member in B)
- [x] Admin can remove a member from the group
- [x] Removed user no longer sees that group in their list
- [x] Admin cannot remove themselves if they're the last admin
- [x] Admin can promote member to admin
- [x] Admin can demote another admin to member
- [x] Admin cannot demote themselves if they're the last admin

### Phase 1.8: Owner role ✅

**Goal:** Each group has exactly one owner who cannot be removed or have their role changed. The owner is stored in `groups.owner_id` (not as a separate role in memberships). The owner also has an 'admin' membership, so admin permission checks work unchanged. This replaces the "last admin" protection - since every group has an immutable owner, there's always someone who can manage the group.

**Design approach:**
- `groups.owner_id` = identifies who the owner is (source of truth)
- Owner's membership has `role='admin'` (not a separate 'owner' role)
- `memberships.role` is just `'admin' | 'member'`
- Admin permission checks: just check `role = 'admin'` (owner has admin role)
- Owner-specific checks (can't remove, can't change role): check `user_id === groups.owner_id`
- Display: if `user_id === owner_id` → show "Owner" badge, else show membership role

**Key invariants:**
- Every group has exactly one owner (enforced by NOT NULL constraint)
- Owner cannot be removed or have their role changed
- Groups are created via CLI with the owner specified
- Owners cannot be invited (only admins/members can be invited)

**Backend changes:**

- [x] Add `owner_id TEXT NOT NULL` to groups table with FK to users
- [x] Update role CHECK constraint to just `'admin', 'member'`
- [x] Update `updateMembershipRole()`: check against `groups.owner_id` to reject changes
- [x] Update `deleteMembership()`: check against `groups.owner_id` to reject removal
- [x] `requireAdmin` middleware unchanged (owner has admin role)
- [x] Remove `countGroupAdmins()` function (no longer needed)
- [x] Update `create-group` CLI script: set `owner_id` and create membership with `role='admin'`

**Frontend changes:**

- [x] Update `MembersList` component:
  - Check `user_id === owner_id` to display "Owner" badge
  - Hide role dropdown and remove button for owner
- [x] Update `GroupSwitcher` to show owner badge based on `owner_id`
- [x] Remove "last admin" validation from role change/remove UI

**Testing:**

Unit tests (Vitest):
- [x] `updateMembershipRole()` rejects changing owner's role
- [x] `deleteMembership()` rejects removing owner

E2E tests (Playwright):
- [x] Owner badge displays with distinct styling in members list
- [x] Owner role dropdown is not shown (immutable)
- [x] Owner has no remove button
- [x] API rejects changing owner's role (403)
- [x] API rejects removing owner (403)

### Phase 2: PWA features

**Goal:** Make photodrop a fully-featured PWA with push notifications and offline support. Target audience includes older/less tech-savvy users, so installation and notification setup must be simple and guided.

**User flow:**
1. User logs in successfully
2. If not installed → show install prompt with platform-specific instructions
3. After install (or if already installed) → prompt to enable notifications
4. Notification bell in header allows toggling notifications on/off

#### Phase 2.1: Installation prompt

**Design:**
- Detect if app is running as installed PWA vs browser
- Show friendly install banner after first successful login (not a modal - non-blocking)
- Platform-specific instructions:
  - **iOS/iPad Safari**: "Tap Share → Add to Home Screen" (required for notifications)
  - **Android/Chrome/Edge**: Use native `beforeinstallprompt` event for one-tap install
  - **macOS Safari**: "File → Add to Dock" or Share → Add to Dock
  - **Firefox**: Skip install, notifications work in browser - show "Continue in browser" option
- Banner can be dismissed, but add "Install App" option in settings/menu to revisit
- Track install state in localStorage to avoid re-prompting

**Frontend changes:**

- [x] Create `InstallPrompt` component:
  - Detect platform (iOS, Android, Desktop) and installed state
  - Show appropriate instructions per platform
  - Handle `beforeinstallprompt` event for Android/Desktop
  - Dismissible with "remind me later" or "don't show again"
- [x] Add install state detection hook (`useInstallPrompt`)
- [x] Add "Install App" button in header (for users who dismissed)
- [x] Store prompt dismissal in localStorage

**No backend changes required.**

#### Phase 2.1.5: Production deployment

**Goal:** Get the current app deployed to production as quickly as possible with a custom domain. This enables real-device testing and iterating with actual users. Defer email delivery and advanced security to Phase 2.5.

**Prerequisites:**
- Cloudflare account with Workers, D1, R2, and Pages enabled
- `wrangler` CLI authenticated (`wrangler login`)
- Domain already in Cloudflare (for custom domain setup)

**One-time setup (`nix run .#setup-prod`):**

The setup script prompts for configuration and automates resource creation:

- [x] Prompt for domain configuration (domain name, API subdomain)
- [x] Create D1 database and run migrations
- [x] Create R2 bucket
- [x] Generate secrets (JWT_SECRET, VAPID keys)
- [x] Create Pages project
- [x] Generate `wrangler.prod.toml` production config
- [x] Output summary with URLs and next steps

**Manual deployment (`nix run .#deploy`):**

- [x] Deploy backend Worker with secrets
- [x] Deploy frontend to Pages
- [x] Health check verification

**CI/CD setup (GitHub Actions):**

- [x] Create `.github/workflows/deploy.yml`
- [x] Add secrets to GitHub repo (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, JWT_SECRET, VAPID keys)
- [x] Add variables to GitHub repo (DOMAIN, API_DOMAIN, ZONE_NAME, PAGES_PROJECT)
- [x] Auto-deploy on push to main

**Creating groups in production:**

- [x] `create-group` script supports `--prod` flag
- [x] Magic links output to console (view via `wrangler tail`)

**Verification checklist:**

- [x] `https://api.{domain}/health` returns OK
- [x] `https://{domain}` loads frontend correctly
- [x] HTTPS works (auto-configured by Cloudflare)
- [x] Can create group via CLI with `--prod`
- [x] Can view magic link in Worker logs (`wrangler tail`)
- [x] Can complete login flow
- [x] Can upload and view photos
- [x] PWA install prompt appears
- [x] App installs correctly on mobile device

#### Phase 2.2: Email delivery

**Goal:** Replace mock email with real delivery via Resend, sending from `noreply@<domain>.com`.

**Why Resend:**
- Simple API (single HTTP call from Workers)
- 3,000 emails/month free tier (more than enough for magic links)
- Easy domain verification via DNS records
- Good deliverability and debugging dashboard

**One-time setup:**

- [x] Sign up at resend.com
- [x] Add domain and configure DNS
- [x] Create API key with send permission
- [x] Add `RESEND_API_KEY` to production secrets:
  - Add to `.prod.vars` locally
  - Run deploy script

**Backend changes:**

- [x] Update `sendEmail()` in `src/lib/email.ts`:
  - Uses `env.RESEND_API_KEY` to detect production mode
  - Uses `env.EMAIL_FROM` for sender address (configured from `DOMAIN`)
  - Falls back to console logging in development
- [x] Add `RESEND_API_KEY` and `EMAIL_FROM` to Bindings type
- [x] Update auth routes to pass env to email functions
- [x] Update deploy script to set `EMAIL_FROM` from `DOMAIN` and handle `RESEND_API_KEY`
- [x] Update GitHub Actions to include `RESEND_API_KEY` secret

**Testing:**

- [x] Test locally: verify mock mode still logs to console
- [x] Test in production:
  - Create a test group with your real email
  - Verify invite email arrives
  - Verify login link email arrives
  - Check Resend dashboard for delivery status

**Verification checklist:**

- [x] Domain verified in Resend dashboard
- [x] SPF/DKIM/DMARC records added to Cloudflare DNS
- [x] `RESEND_API_KEY` deployed to production
- [x] Invite emails deliver successfully
- [x] Login link emails deliver successfully
- [x] Emails not landing in spam (check with Gmail, iCloud)

#### Phase 2.3: Push notifications

**Design:**
- Notification bell icon in header (next to theme toggle)
- Bell states: enabled (filled), disabled (outline), unsupported (hidden)
- Click bell when disabled → browser permission prompt → if granted, subscribe
- Click bell when enabled → confirmation modal → if confirmed, unsubscribe
- Notifications sent when admin uploads a new photo
- Each user can have multiple subscriptions (multiple devices)

**Database changes:**

- [x] Add `push_subscriptions` table:
  ```sql
  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  ```

**Backend changes:**

- [x] Add subscription endpoints:
  - `POST /push/subscribe` - Save subscription for current user+group
  - `DELETE /push/subscribe` - Remove subscription by endpoint
  - `GET /push/status` - Check if current device is subscribed
- [x] Add notification sending on photo upload:
  - After successful photo upload, fetch all subscriptions for the group (excluding uploader)
  - Send push notification with photo caption (or "New photo") and thumbnail
  - Handle failed deliveries (remove invalid subscriptions)
- [x] Use web-push library for sending notifications

**Frontend changes:**

- [x] Create `NotificationBell` component:
  - Check notification permission state and subscription status
  - Three states: subscribed (filled bell), not subscribed (outline bell), unsupported (hidden)
  - On click when not subscribed: request permission → if granted, call subscribe API
  - On click when subscribed: show ConfirmModal → if confirmed, call unsubscribe API
- [x] Add custom service worker for push events:
  - Current PWA uses vite-plugin-pwa's auto-generated SW (basic caching only)
  - Need to add `src/sw.ts` with push event handler using `injectManifest` mode
  - Display notification with photo info
  - On notification click, open app to the group's photo feed
- [x] Add VAPID public key to frontend config (fetched from backend API)

**Testing:**

Unit tests (Vitest) - `backend/src/lib/db.test.ts`:
- [x] `createPushSubscription()` creates new subscription
- [x] `createPushSubscription()` upserts on duplicate endpoint
- [x] `getPushSubscription()` returns subscription for user+group+endpoint
- [x] `getPushSubscription()` returns null for non-existent subscription
- [x] `getUserPushSubscriptionsForGroup()` returns all subscriptions for user in group
- [x] `getUserPushSubscriptionsForGroup()` returns empty array when none exist
- [x] `getGroupPushSubscriptions()` returns all subscriptions for group
- [x] `getGroupPushSubscriptions()` excludes specified user when excludeUserId provided
- [x] `deletePushSubscription()` removes subscription by endpoint
- [x] `deletePushSubscriptionForGroup()` removes subscription for specific user+group+endpoint

E2E tests (Playwright) - `e2e/notifications.spec.ts`:
- [x] NotificationBell is visible in header when logged in
- [x] NotificationBell shows blocked state when permission denied
- [x] Clicking bell when unsubscribed calls subscribe API
- [x] Clicking bell when subscribed shows confirmation modal
- [x] Confirming unsubscribe calls unsubscribe API
- [x] Subscription is per-group (subscribe in group A, switch to group B → shows unsubscribed)

Manual testing checklist:
- [ ] iOS Safari: Bell appears, permission prompt works, notification received
- [x] Android Chrome: Bell appears, permission prompt works, notification received
- [x] Desktop Chrome/Edge: Bell appears, permission prompt works, notification received
- [ ] macOS Safari: Bell appears, permission prompt works, notification received
- [x] Notification click opens app to correct photo
- [x] Multiple devices can subscribe independently
- [ ] Unsubscribing on one device doesn't affect other devices

#### Phase 2.4: Offline caching ✅

**Design:**
- Cache app shell (HTML, JS, CSS) for offline app loading
- Cache thumbnails as viewed (small, ~200KB each)
- Cache last ~20 full-size photos viewed (purges on quota error)
- Cache photo list API response for offline browsing
- Show "offline" indicator when no connection
- Sync gracefully when back online

**Frontend changes:**

- [x] Configure Workbox in Vite build:
  - Precache app shell (index.html, JS, CSS, fonts)
  - Runtime cache for thumbnails (cache-first, no expiry, token-stripped cache keys)
  - Runtime cache for full photos (cache-first, max 20 entries, purges on quota error)
  - Runtime cache for API responses (network-first for photo list and user data)
- [x] Add offline detection and indicator:
  - Use `useSyncExternalStore` with `navigator.onLine` and `online`/`offline` events
  - Show subtle banner when offline: "You're offline"
- [x] Handle offline gracefully in API calls (show cached data via service worker)

**No backend changes required.**

#### Testing

**Manual testing checklist:**
- [x] Offline banner appears when network is disabled
- [x] Offline banner disappears when network is restored
- [x] Previously viewed photos display when offline
- [x] App shell loads when offline (after initial visit)

### Phase 2.5: Reactions and comments

**Goal:** Allow users to engage with photos through emoji reactions and comments. Users start in "comments hidden" mode for distraction-free viewing, and can opt-in to see social interactions.

#### Comments hidden mode (default)

Users start with `commentsEnabled: false`:
- **Reaction counts visible** in feed (e.g., "❤️ 3 😂 2")
- **Cannot see who reacted** (hover/click does nothing)
- **Comment count hidden** in feed
- **Comments hidden** in lightbox
- **Lightbox shows prompt**: "Comments are hidden · Show"
- **Can still add/remove reactions** (personal interaction)
- **Cannot add comments** until enabling

When user clicks "Show":
- Preference saved to database (`commentsEnabled: true`)
- Applies globally to all photos in all groups
- Syncs across devices
- Easy toggle to hide again (button in lightbox)

#### Database changes

```sql
-- Comments table (author_name denormalized to preserve after user deletion)
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL,
  user_id TEXT,  -- NULL when user deleted
  author_name TEXT NOT NULL,  -- preserved when user deleted
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_comments_photo_id ON comments(photo_id);

-- User preference (add column to users table)
ALTER TABLE users ADD COLUMN comments_enabled INTEGER DEFAULT 0;
```

Note: `photo_reactions` table exists but needs schema change. Current PK is `(photo_id, user_id, emoji)` allowing multiple reactions per user. Change to `(photo_id, user_id)` for one reaction per user per photo:

```sql
-- Drop and recreate photo_reactions (one reaction per user per photo)
DROP TABLE IF EXISTS photo_reactions;
CREATE TABLE photo_reactions (
  photo_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (photo_id, user_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_photo_reactions_photo ON photo_reactions(photo_id);
```

#### Backend changes

**Reactions** (update existing):
- [x] Update `POST /photos/:id/reactions` - Add/update reaction (emoji in body)
- [x] Add `DELETE /photos/:id/reactions` - Remove user's reaction
- [x] Update photo list endpoint to include reaction summary (grouped counts)
- [x] Add `GET /photos/:id/reactions` - Get reactions with user details (for popover)

**Comments** (new):
- [x] `POST /photos/:id/comments` - Add comment (requires `commentsEnabled`)
- [x] `GET /photos/:id/comments` - Get comments for photo
- [x] `DELETE /photos/:id/comments/:commentId` - Delete comment (author or admin)
- [x] Update photo list endpoint to include comment count

**User preferences**:
- [x] Update `GET /users/me` - Include `commentsEnabled` in response
- [x] Add `PATCH /users/me/preferences` - Update own `commentsEnabled`
- [x] Update `PATCH /groups/:groupId/members/:userId` - Admin can update member's `commentsEnabled`

**Deleted user handling**:
- [x] When user deleted, comments preserved with `user_id = NULL`
- [x] `author_name` remains for display
- [x] Frontend shows "(deleted) AuthorName" greyed out

#### Frontend changes

**Photo feed**:
- [x] Reaction display below each photo: grouped emoji bubbles with counts
- [x] If `commentsEnabled`: show comment count badge (💬 5)
- [x] If `commentsEnabled`: click reactions → popover showing who reacted

**Lightbox**:
- [x] **Reaction bar**:
  - Emoji picker (fixed set: ❤️ 😂 😮 😢 👏 🔥)
  - Current reactions with counts
  - User's reaction highlighted
  - Tap to add/remove reaction
  - If `commentsEnabled`: tap reactions → popover with names
- [x] **Comments section**:
  - If hidden: subtle prompt "Comments are hidden · Show"
  - If enabled:
    - Comment list (author, timestamp, content)
    - Deleted user comments shown greyed with "(deleted)" prefix
    - Comment input field
    - "Hide comments" toggle
- [x] Delete button on own comments (and all comments for admin)

**Members list (admin)**:
- [x] Add toggle for each member's `commentsEnabled` preference
- [x] Shows current state, allows admin to enable/disable

**Preference management**:
- [x] Store in database (syncs across devices)
- [x] Cache in React context for immediate UI updates
- [x] "Show" in lightbox calls API to update preference

#### UI details

**Reaction picker**:
- Small set of emojis: ❤️ 😂 😮 😢 👏 🔥
- Tap to toggle your reaction
- One reaction per user per photo

**Reactions popover** (when `commentsEnabled`):
- Shows grouped by emoji: "❤️ Alice, Bob, Carol"
- Appears on hover (desktop) or tap (mobile)

**Comments list**:
- Chronological (oldest first)
- Author name + relative timestamp ("2h ago")
- Deleted users: "(deleted) OldName" in muted/grey text

**"Comments hidden" prompt**:
- Subtle, non-intrusive
- Muted text at bottom of lightbox
- "💬 Comments are hidden · Show"

#### Testing

**Unit tests (Vitest)**:
- [x] `createComment()` creates comment with author_name
- [x] `getCommentsByPhotoId()` returns comments for photo
- [x] `getCommentsByPhotoId()` returns empty array when none exist
- [x] `deleteComment()` removes comment
- [x] Comments preserved when user deleted (user_id NULL, author_name intact)
- [x] `getReactionsByPhotoId()` returns grouped reactions with user details
- [x] `addReaction()` creates new reaction
- [x] `addReaction()` updates existing reaction (change emoji)
- [x] `removeReaction()` deletes user's reaction
- [x] `updateUserPreferences()` updates `commentsEnabled`
- [x] Admin can update another user's `commentsEnabled`

**E2E tests (Playwright)**:
- [x] User can add emoji reaction to photo
- [x] User can change their reaction to different emoji
- [x] User can remove their reaction
- [x] Reaction counts appear in feed
- [x] Default mode: comments hidden in lightbox with "Show" prompt
- [x] Clicking "Show" enables comments globally
- [x] When enabled: comments visible in lightbox
- [x] User can add comment when comments enabled
- [x] User can delete their own comment
- [x] "Hide comments" returns to hidden mode
- [x] Preference persists across page refresh
- [x] Admin can toggle user's commentsEnabled in members list

### Phase 2.5.1: User profile colors

**Goal:** Add colored profile avatars with initials. Each user gets a random color on signup; they can change it via a menu in the header. Avatars appear in comments, reactions popovers, and member lists.

#### Color palette

20 colors that work in light/dark mode, fitting the warm/earthy theme:

**Warm**: terracotta, coral, amber, rust, clay, copper, sienna
**Greens**: sage, olive, forest, moss, jade
**Cool**: slate, ocean, teal, indigo
**Rich**: plum, wine, mauve, rose

Stored as identifier string (e.g., `"sage"`) with RGB values defined in CSS.

#### Database changes

```sql
-- Migration: Add profile_color column and assign random colors to existing users
ALTER TABLE users ADD COLUMN profile_color TEXT NOT NULL DEFAULT 'terracotta';

-- Randomly assign colors to existing users (run as part of migration)
-- Each user gets one of the 20 colors randomly distributed
```

The migration assigns random colors to all existing users so the column can be NOT NULL.

#### Backend changes

- [ ] Add migration for `profile_color` column with random assignment for existing users
- [ ] Define color palette constant (array of 20 color identifiers)
- [ ] Update `createUser()` to assign random color from palette
- [ ] Include `profileColor` in all user responses (`/users/me`, `/groups/:id/members`, comments)
- [ ] Add `PATCH /users/me/profile` endpoint to update own color
- [ ] Validate color is in allowed palette

#### Frontend changes

**New components:**

- [ ] `Avatar` component (reusable):
  - Props: `name: string`, `color: string`, `size?: 'sm' | 'md' | 'lg'`
  - Renders colored circle with up to 2 initials
  - Initials logic: first + last name initial (e.g., "Mary Jane Watson" → "MW")

- [ ] `UserMenu` component:
  - Renders avatar button in header (replaces username text + sign out button)
  - Dropdown using `useDropdown` hook (reuses existing pattern from ThemeToggle/GroupSwitcher)
  - Menu items: "Change color", "Sign out"
  - "Change color" opens `ColorPickerModal`

- [ ] `ColorPickerModal` component:
  - Uses existing `Modal` component
  - Grid of 20 color swatches
  - Current color highlighted
  - Click to select → API call → close modal

**Updates:**

- [ ] Replace username + sign out button in `App.tsx` header with `<UserMenu />`
- [ ] Update `MembersList` to use `Avatar` with member's color
- [ ] Update comments display in `PhotoFeed` to use `Avatar`
- [ ] Update reactions popover to show avatars
- [ ] Update `AuthContext` User type to include `profileColor`
- [ ] Update `MobileMenu` to use avatar and include color picker access

#### CSS changes

- [ ] Add profile color CSS variables to `index.css` (20 colors, light/dark mode compatible)

#### Testing

**Unit tests (Vitest)**:
- [ ] `createUser()` assigns random color from valid palette
- [ ] `updateUserProfile()` updates color
- [ ] `updateUserProfile()` rejects invalid color names
- [ ] User responses include `profileColor` field

**E2E tests (Playwright)**:
- [ ] Avatar appears in header with user's initials and color
- [ ] Clicking avatar opens menu with "Change color" and "Sign out"
- [ ] Color picker modal shows all colors with current highlighted
- [ ] Selecting new color updates avatar immediately
- [ ] Avatars appear in member list with correct colors
- [ ] Avatars appear in comments with correct colors
- [ ] New users get random color assigned on creation

### Phase 2.6: Production hardening

**Goal:** Add security hardening and monitoring. The app is deployed (Phase 2.1.5) with email working (Phase 2.2); this phase improves robustness.

#### Security hardening

- [ ] Add rate limiting:
  - Use Cloudflare's built-in rate limiting (via dashboard or Workers)
  - Limit auth endpoints (login, magic link) to prevent abuse
  - Limit photo upload to reasonable rate
- [ ] Configure CORS properly:
  - Allow only production frontend domain
  - Keep permissive for local dev
- [ ] Review CSP headers:
  - Add Content-Security-Policy header
  - Restrict script sources, frame ancestors

#### Monitoring and backups

**Documentation:**

- [ ] Document monitoring approach:
  - Cloudflare dashboard shows Workers analytics, errors, and logs
  - D1 metrics available in dashboard
  - Consider adding `/health` endpoint checks via external monitor (e.g., UptimeRobot free tier)
- [ ] Document backup/recovery:
  - D1 has automatic point-in-time recovery (last 30 days)
  - Document how to export/restore if needed
  - R2 has no auto-backup - consider versioning for critical data

#### Testing

- [ ] Test rate limiting doesn't block normal usage
- [ ] Verify CSP headers don't break functionality
- [ ] Test CORS rejects unauthorized origins

### Phase 3: Polish

- [x] Admin photo deletion UI
- [x] Admin user management UI (role promotion, user removal) - moved to Phase 1.7
- [x] Keyboard navigation (lightbox, group switcher, theme toggle, photo feed)
- [ ] Improve production setup and deployment flow - automate or improve things further
- [ ] Photo view tracking UI for admins (backend API already exists)
- [ ] Video upload
- [ ] Add emails as an alternative to notifications
- [ ] Make it harder for users to download or save images/videos
- [ ] Multi-device testing
- [ ] Accessibility review (screen readers, ARIA improvements)

### Phase 4: Launch

- [ ] Final documentation review (README, PLAN)
- [ ] Beta testing with 2-3 real users
- [ ] Collect feedback and fix critical issues
- [ ] Full launch

## Future enhancements

**Nice-to-haves:** Batch upload, albums, ownership transfer (allow owner to transfer ownership to another member)

**Technical:** Progressive image loading, CDN optimization, accessibility improvements

**Local dev:** Notifications working locally

**Note:** Photo view tracking has backend API support but no frontend UI yet. This is planned for Phase 3. Reactions UI is planned for Phase 2.5.

## Testing strategy

**Tools:** Vitest (unit), Playwright (E2E)

**Unit tests (Vitest):**
1. JWT generation/validation with group_id ✅
2. Crypto utilities ✅
3. Image compression utilities ✅
4. Membership DB functions ✅
5. Switch-group token validation ✅
6. Owner role protection ✅

**E2E tests (Playwright):**
1. Admin workflow (login, upload, delete, invite) ✅
2. Member workflow (view-only permissions) ✅
3. Tenant isolation (critical security tests) ✅
4. Auth edge cases (expiry, reuse, persistence) ✅
5. Multi-group membership (login flow, group switching, per-group roles) ✅
6. Owner role (immutable, cannot be removed/changed) ✅

**Running tests:**
```bash
nix run .#test           # Unit tests
nix run .#test-e2e       # E2E tests (starts servers automatically)
nix run .#test-e2e-ui    # E2E with Playwright UI
```

**Manual checklist:**
- [ ] Install PWA on iOS/Android
- [ ] Photo upload from both platforms
- [ ] Push notifications arrive
- [ ] Offline mode works
- [ ] Invite flow with non-technical user

## Database migrations

Schema is defined in `backend/migrations/0001_initial_schema.sql`. For schema changes, update this file and reset local dev DB with `nix run .#teardown-dev && nix run .#dev`.

## Monitoring

- Track R2 storage, Workers requests, D1 queries
- `/health` endpoint with external uptime monitor
- Monthly D1 export, R2 versioning enabled

## Security checklist

- [x] HTTPS enforced (Cloudflare automatic)
- [x] CORS configured (production domain only)
- [x] JWT with strong signing (HS256)
- [x] httpOnly cookies (refresh tokens)
- [ ] Rate limiting
- [ ] CSP headers
- [x] R2 bucket private
- [x] Signed URLs expire (1 hour)
- [x] Magic links single-use (15 min expiry)
- [x] Admin endpoints protected

## Troubleshooting

**Can't add to home screen:** iOS requires Safari; iOS 16.4+ required

**Notifications not working:** Check permissions, ensure PWA installed (not bookmarked), try test notification

**Photos won't upload:** Check connection, verify <10MB, check storage limits

**App logs out:** Check cookies not blocked, not incognito, refresh token may have expired

## Notes

- Keep complexity low - resist feature creep
- Prioritize reliability over features
- Document all Cloudflare setup steps
