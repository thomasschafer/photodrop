# Mobile App Fixes - Phase 2

## Status Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | Header/safe area | ✅ Done |
| 2 | Hide install banner | ✅ Done |
| 3 | Images not loading | ✅ Done |
| 4 | Pull-to-refresh | ✅ Done |
| 5 | GitHub workflow PR builds | ✅ Done |
| 6 | Native push notifications | 📋 Planned (see below) |

---

## Completed Fixes

### 1. Header Behind Status Bar / Camera Cutout ✅

**Problem:** App content overlapped with device status bar and camera notch.

**Solution implemented:**
- Added `viewport-fit=cover` to viewport meta tag
- Header extends into safe area with `pt-[env(safe-area-inset-top)]`
- Created CSS utilities: `.pt-safe`, `.top-safe`, `.top-4-safe`
- Applied to LoginPage, LandingPage, Lightbox close button

### 2. Hide Install Banner in Native App ✅

**Problem:** PWA install prompt showed inside the native Capacitor app.

**Solution implemented:**
- Added `Capacitor.isNativePlatform()` check to `useInstallPrompt.ts`
- Install prompt hidden in native apps, shown only on web browsers

### 3. Images Not Loading ✅

**Problem:** Photos didn't display in the native app.

**Root cause:** Backend only accepts tokens via Authorization header (security design), but `<img>` tags can't send headers.

**Solution implemented:**
- Created `useAuthenticatedImage` hook that fetches images via JS with proper auth
- Uses `CapacitorHttp` on native, regular fetch on web
- In-memory cache with cleanup on logout/group switch
- Updated `PhotoFeed.tsx` to use authenticated image loading

### 4. Pull-to-Refresh ✅

**Problem:** No way to refresh content in native app.

**Solution implemented:**
- Created `PullToRefresh` component (native-only)
- Uses document-level touch events for smooth UX
- Indicator positioned relative to content container
- Integrated into PhotoFeed

### 5. GitHub Workflow PR Builds ✅

**Problem:** Mobile builds only ran on hardcoded branches.

**Solution implemented:**
- Removed `feat/mobile-capacitor` from branch list
- Added `pull_request` trigger for PR builds

---

## Remaining Work

### 6. Native Push Notifications (FCM) 📋

**Status:** In progress on `feat/native-notifications`

**Problem:** Native apps need platform-specific push notifications, not web push.

**Current state:**
- Web push works via service worker + VAPID
- Notification bell hidden on native
- `@capacitor/push-notifications` plugin already installed ✅
- Plugin configured in `capacitor.config.ts` ✅
- No frontend integration or backend support yet

#### Implementation Plan

**Phase 1: External Setup (requires Tom)**

- [ ] Create Firebase project at https://console.firebase.google.com
- [ ] Add Android app to Firebase (package: `com.photodrop.app`)
- [ ] Download `google-services.json` → `mobile/android/app/`
- [ ] Add iOS app to Firebase (bundle ID: `com.photodrop.app`)
- [ ] Download `GoogleService-Info.plist` → `mobile/ios/App/App/`
- [ ] For iOS: Upload APNs key to Firebase (requires Apple Developer account)

**Phase 2: Frontend Integration**

- [ ] Create `frontend/src/lib/nativePush.ts`:
  - Check platform with `Capacitor.isNativePlatform()`
  - Request notification permission
  - Register with FCM and get device token
  - Listen for `registration`, `pushNotificationReceived`, `pushNotificationActionPerformed`
- [ ] Update `frontend/src/main.tsx`:
  - Initialize native push on app start (after auth)
  - Re-register token on group switch
- [ ] Update `frontend/src/lib/api.ts`:
  - Add `api.push.registerDevice(platform, token)`
  - Add `api.push.unregisterDevice(token)`
- [ ] Update `frontend/src/components/NotificationBell.tsx`:
  - Show bell on native (currently hidden)
  - Use native push flow instead of web push when on native
- [ ] Handle notification taps → deep link to photo/group

**Phase 3: Backend Changes**

- [ ] Create migration `0010_device_tokens.sql`:
  ```sql
  CREATE TABLE device_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, group_id, token),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_device_tokens_group ON device_tokens(group_id);
  ```
- [ ] Add to `backend/src/lib/db.ts`:
  - `createDeviceToken(db, userId, groupId, platform, token)`
  - `deleteDeviceToken(db, userId, groupId, token)`
  - `getDeviceTokensForGroup(db, groupId, excludeUserId)`
- [ ] Update `backend/src/routes/push.ts`:
  - `POST /push/device` - register device token (with auth)
  - `DELETE /push/device` - unregister device token
- [ ] Create `backend/src/lib/fcm.ts`:
  - Send notifications via FCM HTTP v1 API
  - Use service account credentials (env var: `FIREBASE_SERVICE_ACCOUNT`)
- [ ] Update `backend/src/routes/photos.ts`:
  - On photo upload, send to both web push AND FCM
  - Query `push_subscriptions` for web, `device_tokens` for mobile

**Phase 4: Testing**

- [ ] Android: Permission prompt appears on first launch
- [ ] Android: Token registered with backend after granting permission
- [ ] Android: Push received when photo uploaded (app backgrounded)
- [ ] Android: Notification tap opens app to correct group
- [ ] Token cleaned up on logout
- [ ] Token re-registered on group switch
- [ ] iOS: Same tests (after Apple Developer setup)

#### Files Summary

```text
NEW:
- frontend/src/lib/nativePush.ts
- backend/src/lib/fcm.ts
- backend/migrations/0010_device_tokens.sql
- mobile/android/app/google-services.json (from Firebase)
- mobile/ios/App/App/GoogleService-Info.plist (from Firebase)

MODIFY:
- frontend/src/main.tsx
- frontend/src/lib/api.ts
- frontend/src/components/NotificationBell.tsx
- backend/src/lib/db.ts
- backend/src/routes/push.ts
- backend/src/routes/photos.ts
```

---

## Other Mobile TODOs (from MOBILE_PLAN.md)

These are documented in `MOBILE_PLAN.md`:

- [x] **Screenshot protection** - `@capacitor-community/privacy-screen` plugin (configured in `capacitor.config.ts`)
- [ ] **iOS builds** - Requires Apple Developer account
- [ ] **App Store submission** - After testing complete
- [ ] **Play Store submission** - After testing complete

---

## Files Changed in This PR

```text
Modified:
- .github/workflows/mobile-android.yml (PR builds)
- frontend/index.html (viewport-fit)
- frontend/src/index.css (safe area utilities)
- frontend/src/App.tsx (header safe area)
- frontend/src/components/PhotoFeed.tsx (authenticated images, pull-to-refresh)
- frontend/src/components/NotificationBell.tsx (hide on native)
- frontend/src/lib/useInstallPrompt.ts (native check)
- frontend/src/lib/cache.ts (clear image cache)
- frontend/src/pages/LoginPage.tsx (safe area)
- frontend/src/pages/LandingPage.tsx (safe area)

New:
- frontend/src/lib/useAuthenticatedImage.ts
- frontend/src/components/PullToRefresh.tsx
- MOBILE_FIXES.md (this file)
```
