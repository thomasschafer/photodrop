# photodrop - Project plan

## Status

**Current implementation:**
- ✅ Phase 1 (Foundation): Complete - photo upload/feed, JWT auth, user management
- ✅ Phase 1.5 (Email Auth): Complete - magic links working, mock email for local dev
- ✅ Phase 1.6 (UI Polish): Complete - warm terracotta design, responsive layout
- ✅ Phase 1.7 (Multi-group): Complete - users can belong to multiple groups
- ✅ Phase 1.8 (Owner role): Complete - immutable owner role per group
- ❌ Phase 2 (PWA): Not started - install prompts, push notifications, offline caching
- ❌ Phase 2.5 (Production): Not started - email delivery, domains, security hardening
- ❌ Phase 3 (Polish): Not started - UX improvements, accessibility
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
- `POST /api/auth/send-invite` - Send invite email (admin only, scoped to admin's group)
- `POST /api/auth/send-login-link` - Send login link (public, looks up user by email)
- `POST /api/auth/verify-magic-link` - Verify token and issue JWT
- `POST /api/auth/refresh` - Refresh JWT
- `POST /api/auth/logout` - Invalidate refresh token
- `POST /api/auth/switch-group` - Switch to different group (issues new tokens)
- `POST /api/auth/select-group` - Initial group selection for multi-group users (after login)

**Groups:**
- `GET /api/groups` - List groups current user is a member of (with roles)
- `GET /api/groups/:groupId/members` - List members of a group (admin only)
- `PATCH /api/groups/:groupId/members/:userId` - Update member role (admin only)
- `DELETE /api/groups/:groupId/members/:userId` - Remove user from group (admin only)

**Group + admin creation:** CLI script only (no public endpoint)
```bash
nix run .#create-group -- "Group Name" "Admin Name" "admin@example.com"
```

**Photos:** All endpoints validate group_id
- `GET /api/photos` - List photos (paginated)
- `POST /api/photos` - Upload (admin only)
- `DELETE /api/photos/:id` - Delete (admin only)
- `POST /api/photos/:id/view` - Mark viewed
- `POST /api/photos/:id/react` - Add reaction
- `GET /api/photos/:id/url` - Get signed URL

**Users:** All endpoints validate group_id
- `GET /api/users` - List users (admin only)
- `GET /api/users/me` - Current user
- `PATCH /api/users/:id/role` - Update role (admin only)
- `DELETE /api/users/:id` - Remove user (admin only)

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
- [x] Infrastructure automation (Nix, GitHub Actions, migrations)

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

**Remaining for production:**
- [ ] Cloudflare Email Workers setup (dashboard + DNS)
- [ ] Implement actual email sending (MailChannels API)

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
- [x] New auth endpoint `POST /api/auth/switch-group`:
  - Verify user has membership in requested group
  - Issue new access/refresh tokens with that groupId
  - Return new tokens + group info
- [x] New endpoint `GET /api/groups`:
  - Return all groups the current user is a member of
  - Include role for each group
- [x] New endpoint `GET /api/groups/:groupId/members`:
  - Admin only - list all members of a group with their roles
- [x] New endpoint `PATCH /api/groups/:groupId/members/:userId`:
  - Admin only - update member role
  - Cannot demote yourself if you're the last admin
- [x] New endpoint `DELETE /api/groups/:groupId/members/:userId`:
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

#### Phase 2.2: Push notifications

**Design:**
- Notification bell icon in header (next to theme toggle)
- Bell states: enabled (filled), disabled (outline), unsupported (hidden)
- Click bell when disabled → browser permission prompt → if granted, subscribe
- Click bell when enabled → confirmation modal → if confirmed, unsubscribe
- Notifications sent when admin uploads a new photo
- Each user can have multiple subscriptions (multiple devices)

**Database changes:**

- [ ] Add `push_subscriptions` table:
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

- [ ] Add subscription endpoints:
  - `POST /api/push/subscribe` - Save subscription for current user+group
  - `DELETE /api/push/subscribe` - Remove subscription by endpoint
  - `GET /api/push/status` - Check if current device is subscribed
- [ ] Add notification sending on photo upload:
  - After successful photo upload, fetch all subscriptions for the group (excluding uploader)
  - Send push notification with photo caption (or "New photo") and thumbnail
  - Handle failed deliveries (remove invalid subscriptions)
- [ ] Use web-push library for sending notifications

**Frontend changes:**

- [ ] Create `NotificationBell` component:
  - Check notification permission state and subscription status
  - Three states: subscribed (filled bell), not subscribed (outline bell), unsupported (hidden)
  - On click when not subscribed: request permission → if granted, call subscribe API
  - On click when subscribed: show ConfirmModal → if confirmed, call unsubscribe API
- [ ] Add service worker push event handler:
  - Display notification with photo info
  - On notification click, open app to the group's photo feed
- [ ] Register service worker on app load
- [ ] Add VAPID public key to frontend config

#### Phase 2.3: Offline caching

**Design:**
- Cache app shell (HTML, JS, CSS) for offline app loading
- Cache thumbnails as viewed (small, ~200KB each)
- Cache last ~20 full-size photos viewed, with ~100MB total cap
- Cache photo list API response for offline browsing
- Show "offline" indicator when no connection
- Sync gracefully when back online

**Frontend changes:**

- [ ] Configure Workbox in Vite build:
  - Precache app shell (index.html, JS, CSS, fonts)
  - Runtime cache for thumbnails (cache-first, no expiry)
  - Runtime cache for full photos (cache-first, max 20 entries, 100MB cap)
  - Runtime cache for API responses (network-first, 24h fallback)
- [ ] Add offline detection and indicator:
  - Use `navigator.onLine` and `online`/`offline` events
  - Show subtle banner when offline: "You're offline - showing cached photos"
- [ ] Handle offline gracefully in API calls (show cached data, queue actions)

**No backend changes required.**

#### Testing

**Unit tests (Vitest):**
- [ ] Push subscription CRUD operations
- [ ] Notification payload generation

**E2E tests (Playwright):**
- [ ] Install prompt appears for new users (can mock `beforeinstallprompt`)
- [ ] Install prompt can be dismissed
- [ ] Notification bell toggles subscription state
- [ ] Unsubscribe shows confirmation modal
- [ ] Photo upload triggers notification to other group members
- [ ] App loads offline with cached shell
- [ ] Cached photos display when offline

**Manual testing checklist:**
- [ ] iOS/iPad Safari: Install flow works with share sheet
- [ ] Android Chrome: Native install prompt works
- [ ] macOS Safari: Add to Dock works
- [ ] Desktop Chrome/Edge: Install prompt works
- [ ] Firefox: "Continue in browser" works, notifications work without install
- [ ] Push notification received on mobile and desktop
- [ ] Notification click opens correct group
- [ ] Offline mode shows cached content
- [ ] Multiple devices can subscribe independently

### Phase 2.5: Production readiness

**Goal:** Get the app deployable to production with real email delivery, custom domains, and proper security hardening.

#### Email delivery

**Design:**
- Replace mock email with real delivery
- Use **Resend** (simple API, good free tier, easy setup) or **MailChannels** (free with Workers but complex DNS setup)
- Recommend Resend for simplicity

**Backend changes:**

- [ ] Add email provider integration:
  - Sign up for Resend (or alternative)
  - Add `RESEND_API_KEY` to secrets
  - Update `sendEmail()` to call Resend API in production
  - Keep mock mode for local dev (when `RESEND_API_KEY` not set)
- [ ] Configure sender domain:
  - Add DNS records (SPF, DKIM) for sender domain
  - Verify domain in email provider dashboard

#### Cloudflare Pages setup

**Design:**
- Frontend deployed to Cloudflare Pages
- Can use `wrangler pages` CLI or connect GitHub for auto-deploy

**Setup steps:**

- [ ] Create Pages project:
  - `wrangler pages project create photodrop`
  - Or create via Cloudflare dashboard
- [ ] Configure build settings:
  - Build command: `npm run build`
  - Output directory: `dist`
  - Root directory: `frontend`
- [ ] Update `setup-prod` script to create Pages project if missing
- [ ] Update `deploy.sh` to handle first-time Pages deployment

#### Custom domain configuration

**Design:**
- Assumes domain is already in Cloudflare (simplifies everything)
- HTTPS automatic via Cloudflare
- Two options:

**Option A: Dedicated domain** (domain IS the product)
- Frontend: `yourdomain.com` (apex domain)
- API: `api.yourdomain.com`

**Option B: Subdomain** (photodrop is part of a larger domain)
- Frontend: `photos.yourdomain.com`
- API: `api.photos.yourdomain.com`

**Setup steps:**

- [ ] Configure Pages custom domain:
  - Pages project → Custom domains → Add domain (apex or subdomain)
  - DNS record added automatically
- [ ] Configure Workers custom domain:
  - Workers → Settings → Domains → Add custom domain
- [ ] Update `FRONTEND_URL` in production config to match chosen domain
- [ ] Update CORS to allow production domain

#### Security hardening

**Backend changes:**

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

- [ ] Deploy to production with test group
- [ ] Verify email delivery works end-to-end
- [ ] Verify custom domain and HTTPS work
- [ ] Test rate limiting doesn't block normal usage

### Phase 3: Polish

- [x] Admin photo deletion UI
- [x] Admin user management UI (role promotion, user removal) - moved to Phase 1.7
- [ ] UX improvements (gallery navigation, reactions UI)
- [ ] Multi-device testing
- [ ] Accessibility review (screen readers, keyboard navigation)

### Phase 4: Launch

- [ ] Final documentation review (README, PLAN)
- [ ] Beta testing with 2-3 real users
- [ ] Collect feedback and fix critical issues
- [ ] Full launch

## Future enhancements

**Nice-to-haves:** Batch upload, video support, albums, comments, ownership transfer (allow owner to transfer ownership to another member)

**Technical:** Progressive image loading, CDN optimization, accessibility improvements

## Testing strategy

**Tools:** Vitest (unit), Playwright (E2E)

**Unit tests (Vitest):**
1. JWT generation/validation with group_id ✅
2. Crypto utilities ✅
3. Image compression utilities ✅
4. Membership DB functions (Phase 1.7)
5. Switch-group token validation (Phase 1.7)

**E2E tests (Playwright):**
1. Admin workflow (login, upload, delete, invite) ✅
2. Member workflow (view-only permissions) ✅
3. Tenant isolation (critical security tests) ✅
4. Auth edge cases (expiry, reuse, persistence) ✅
5. Multi-group membership (login flow, group switching, per-group roles) (Phase 1.7)

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

- [ ] HTTPS enforced
- [ ] CORS configured
- [ ] JWT with strong signing
- [ ] httpOnly cookies
- [ ] Rate limiting
- [ ] CSP headers
- [ ] R2 bucket private
- [ ] Signed URLs expire
- [ ] Magic links single-use
- [ ] Admin endpoints protected

## Troubleshooting

**Can't add to home screen:** iOS requires Safari; iOS 16.4+ required

**Notifications not working:** Check permissions, ensure PWA installed (not bookmarked), try test notification

**Photos won't upload:** Check connection, verify <10MB, check storage limits

**App logs out:** Check cookies not blocked, not incognito, refresh token may have expired

## Notes

- Keep complexity low - resist feature creep
- Prioritize reliability over features
- Document all Cloudflare setup steps
