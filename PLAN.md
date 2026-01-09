# photodrop - Project plan

## Status

**Current implementation:**
- ✅ Phase 1 (Foundation): Complete - photo upload/feed, JWT auth, user management
- ✅ Phase 1.5 (Email Auth): Complete - frontend done, magic links working, mock email for local dev
- ✅ Phase 1.6 (UI Polish): Complete - warm terracotta design, responsive layout, admin features
- ❌ Phase 1.7 (Multi-group): Not started - users can belong to multiple groups
- ❌ Phase 1.8 (Owner role): Not started - immutable owner role per group
- ❌ Phase 2+ (PWA, Notifications): Not started

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
-- Groups
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
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
CREATE TABLE memberships (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'admin' or 'member'
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

-- Plus: push_subscriptions, photo_views, photo_reactions tables
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

### Phase 1.7: Multi-group membership

**Goal:** Allow users to belong to multiple groups with different roles in each. One login grants access to all groups; users switch between groups via a header dropdown.

**Database migration (`migrations/0002_multi_group_membership.sql`):**
```sql
-- Create memberships junction table
CREATE TABLE memberships (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Migrate existing data from users table
INSERT INTO memberships (user_id, group_id, role, joined_at)
SELECT id, group_id, role, COALESCE(invite_accepted_at, created_at) FROM users;

-- Create new users table without group_id/role
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

INSERT INTO users_new (id, name, email, created_at, last_seen_at)
SELECT id, name, email, created_at, last_seen_at FROM users;

-- Swap tables
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Indexes
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_group ON memberships(group_id);
CREATE INDEX idx_users_email ON users(email);
```

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
- [ ] New `MembersPage` or `MembersList` component (admin only):
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
- [ ] `getUserMemberships()` returns all memberships for a user
- [ ] `getUserMemberships()` returns empty array for user with no groups
- [ ] `getMembership()` returns correct role for user+group
- [ ] `createMembership()` handles new membership creation
- [ ] `createMembership()` fails gracefully for duplicate membership
- [ ] `deleteMembership()` removes membership but keeps user account
- [ ] `updateMembershipRole()` changes role correctly
- [ ] Switch-group token generation includes correct groupId
- [ ] Switch-group rejects if user not a member of group

E2E tests (Playwright):
- [ ] User with single group logs in directly to feed (no picker)
- [ ] User with multiple groups sees group picker after login
- [ ] User can select group from picker and lands on correct feed
- [ ] User with zero groups sees empty state after login
- [ ] Group switcher dropdown shows all user's groups
- [ ] Switching groups via dropdown loads new group's photos
- [ ] User invited to second group can access both groups
- [ ] Admin of group A cannot see photos from group B
- [ ] Role is correct per-group (admin in A, member in B)
- [ ] Admin can remove a member from the group
- [ ] Removed user no longer sees that group in their list
- [ ] Admin cannot remove themselves if they're the last admin
- [ ] Admin can promote member to admin
- [ ] Admin can demote another admin to member
- [ ] Admin cannot demote themselves if they're the last admin

### Phase 1.8: Owner role

**Goal:** Add an "owner" role distinct from admin. Each group has exactly one owner who is responsible for payments (if ever enabled) and ultimately owns the group. Owners have all admin permissions, but their role is immutable - it cannot be changed by anyone except via an explicit ownership transfer.

**Database migration (`migrations/0003_owner_role.sql`):**
```sql
-- SQLite doesn't support ALTER TABLE to modify CHECK constraints, so we need to recreate the table
CREATE TABLE memberships_new (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- Migrate data: group creators become owners, others keep their role
INSERT INTO memberships_new (user_id, group_id, role, joined_at)
SELECT
  m.user_id,
  m.group_id,
  CASE WHEN m.user_id = g.created_by AND m.role = 'admin' THEN 'owner' ELSE m.role END,
  m.joined_at
FROM memberships m
JOIN groups g ON m.group_id = g.id;

-- Swap tables
DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;

-- Recreate indexes
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_group ON memberships(group_id);
```

**Backend changes:**

- [ ] Update `Membership` type to include `'owner'` in role union type
- [ ] Add `getGroupOwner(db, groupId): Membership | null` function
- [ ] Update `updateMembershipRole()`:
  - Reject attempts to change an owner's role (return 403)
  - Reject attempts to promote someone to owner (must use transfer)
- [ ] Update `deleteMembership()`:
  - Reject attempts to remove an owner (return 403 with message to transfer first)
- [ ] New endpoint `POST /api/groups/:groupId/transfer-ownership`:
  - Owner only - returns 403 for non-owners
  - Request body: `{ targetUserId: string }`
  - Validates target user is a member of the group
  - Atomic transaction: promotes target to owner, demotes caller to admin
  - Returns updated membership list
- [ ] Update `requireAdmin` middleware to also allow owners (or create `requireAdminOrOwner`)
- [ ] Update `create-group` CLI script:
  - Create initial user with `role='owner'` instead of `role='admin'`

**Frontend changes:**

- [ ] Update role type to include `'owner'`
- [ ] Update `MembersList` component:
  - Display "Owner" badge with distinct styling (different color from admin)
  - Hide role dropdown/toggle for owner (role is immutable)
  - Hide remove button for owner
  - Show "Transfer Ownership" button next to non-owner members (visible to owner only)
- [ ] Add transfer ownership confirmation dialog:
  - "Transfer ownership to [name]? You will become an admin."
  - Confirm/Cancel buttons
  - Calls transfer-ownership endpoint on confirm
  - Refreshes member list after success
- [ ] Update `GroupSwitcher` to show owner badge where applicable

**Testing:**

Unit tests (Vitest):
- [ ] `getGroupOwner()` returns owner membership for group
- [ ] `getGroupOwner()` returns null for group with no owner (edge case)
- [ ] `updateMembershipRole()` rejects changing owner's role
- [ ] `updateMembershipRole()` rejects promoting to owner
- [ ] `deleteMembership()` rejects removing owner
- [ ] Transfer ownership promotes target and demotes caller atomically
- [ ] Transfer ownership rejects if caller is not owner
- [ ] Transfer ownership rejects if target is not a member

E2E tests (Playwright):
- [ ] Group creator has owner role after creation
- [ ] Owner badge displays with distinct styling in members list
- [ ] Owner role dropdown is not shown (immutable)
- [ ] Owner has no remove button
- [ ] Owner can see "Transfer Ownership" button for other members
- [ ] Non-owner cannot see "Transfer Ownership" button
- [ ] Owner can transfer ownership to a member
- [ ] After transfer: old owner is admin, new member is owner
- [ ] Transfer requires confirmation dialog
- [ ] Admin cannot change owner's role via API (403)
- [ ] Admin cannot remove owner via API (403)

### Phase 2: PWA features

- [ ] Service worker with Workbox (offline caching)
- [ ] Push notifications (VAPID, subscription storage)
- [ ] Installation instructions UI (platform-specific)

### Phase 3: Polish

- [x] Admin photo deletion UI
- [x] Admin user management UI (role promotion, user removal) - moved to Phase 1.7
- [ ] UX improvements (gallery navigation, reactions UI)
- [ ] Domain setup and production deployment
- [ ] Multi-device testing

### Phase 4: Launch

- [ ] Documentation
- [ ] Beta testing (2-3 users)
- [ ] Full launch

## Future enhancements

**Nice-to-haves:** Batch upload, video support, albums, comments

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

- Store in `migrations/` as numbered SQL files
- Track in `schema_migrations` table
- Run via Wrangler CLI
- Always test locally first
- Backup before major changes

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
