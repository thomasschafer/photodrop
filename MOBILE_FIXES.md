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

### 6. Native Push Notifications (FCM/APNs) 📋

**Status:** Planned for next PR

**Problem:** Native apps need platform-specific push notifications (FCM for Android, APNs for iOS), not web push.

**Current state:**
- Web push works via service worker + VAPID
- Notification bell hidden on native (implemented in this PR)
- Native apps have no push notification support yet

#### Implementation Plan

**External Setup Required:**
- [ ] Firebase project created (Android)
- [ ] `google-services.json` added to project
- [ ] Apple Developer account ($99/year) for iOS
- [ ] APNs push certificate/key created

**Frontend Changes:**
- [ ] Install `@capacitor/push-notifications` plugin
- [ ] Create `frontend/src/lib/nativePush.ts`
- [ ] Request permission on app launch
- [ ] Register device token with backend
- [ ] Handle incoming notifications
- [ ] Handle notification taps (navigate to photo)

**Backend Changes:**
- [ ] Add `device_tokens` table (migration)
- [ ] `POST /push/device-token` - register device token
- [ ] `DELETE /push/device-token` - unregister device token
- [ ] Integrate FCM sending in photo upload flow
- [ ] Handle both web push AND native push

**Files to create/modify:**
```text
NEW:
- frontend/src/lib/nativePush.ts
- backend/src/lib/fcm.ts
- backend/migrations/XXXX_device_tokens.sql
- mobile/android/app/google-services.json

MODIFY:
- frontend/src/main.tsx (init native push)
- frontend/src/lib/api.ts (device token endpoints)
- backend/src/routes/push.ts (device token routes)
- backend/src/routes/photos.ts (send native push on upload)
```

**Testing Checklist:**
- [ ] Firebase project created
- [ ] google-services.json added
- [ ] Permission requested on app start
- [ ] Token registered with backend
- [ ] Push received when photo uploaded (app backgrounded)
- [ ] Notification tap opens correct photo
- [ ] Token cleaned up on logout/group switch

---

## Other Mobile TODOs (from MOBILE_PLAN.md)

These are documented in `MOBILE_PLAN.md`:

- [ ] **Screenshot protection** - `@capacitor-community/privacy-screen` plugin
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
