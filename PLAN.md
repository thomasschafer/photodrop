# photodrop - Project plan

## Status

**Current implementation:**
- ✅ Phase 1 (Foundation): Complete - photo upload/feed, JWT auth, user management
- ✅ Phase 1.5 (Email Auth): Complete - frontend done, magic links working, mock email for local dev
- ✅ Phase 1.6 (UI Polish): Complete - warm terracotta design, responsive layout, admin features
- ❌ Phase 2+ (PWA, Notifications): Not started

---

## Overview

A PWA for privately sharing photos within isolated groups. Each group has its own admins and members with complete data isolation. Group admins upload photos with one tap; members receive instant push notifications. Built on Cloudflare's free tier.

**Use cases:** Family photos, travel photos, event photos - each in separate isolated groups.

**Multi-tenancy:** Each group is completely isolated. Users in one group can never see photos or data from another group.

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
- Complete isolation between groups
- Users belong to exactly one group
- All queries scoped by group_id

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

-- Users (group_id required for isolation)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,  -- 'admin' or 'member'
  invite_accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
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

**Critical:** All queries MUST filter by group_id to prevent cross-group access.

### API endpoints

**Authentication:**
- `POST /api/auth/send-invite` - Send invite email (admin only, scoped to admin's group)
- `POST /api/auth/send-login-link` - Send login link (public, looks up user's group)
- `POST /api/auth/verify-magic-link` - Verify token and issue JWT
- `POST /api/auth/refresh` - Refresh JWT
- `POST /api/auth/logout` - Invalidate refresh token

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

### Phase 2: PWA features

- [ ] Service worker with Workbox (offline caching)
- [ ] Push notifications (VAPID, subscription storage)
- [ ] Installation instructions UI (platform-specific)

### Phase 3: Polish

- [x] Admin photo deletion UI
- [ ] Admin user management UI (role promotion, user removal)
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

**E2E tests (Playwright):**
1. Admin workflow (login, upload, delete, invite) ✅
2. Member workflow (view-only permissions) ✅
3. Tenant isolation (critical security tests) ✅
4. Auth edge cases (expiry, reuse, persistence) ✅

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
