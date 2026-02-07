# Mobile App Fixes - Phase 2

## Status Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | Header/safe area | ✅ Done |
| 2 | Hide install banner | ✅ Done |
| 3 | Images not loading | ✅ Done |
| 4 | Pull-to-refresh | ✅ Done |
| 5 | GitHub workflow PR builds | ✅ Done |
| 6 | Native push notifications | ✅ Code done (needs Firebase config) |

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

### 6. Native Push Notifications (FCM) ✅

**Status:** Code complete — requires Firebase configuration

**Problem:** Native apps need platform-specific push notifications, not web push.

**Solution implemented:**
- FCM HTTP v1 API client for sending notifications
- Device token storage and management in D1
- NotificationBell works for both web push and native push
- Automatic token cleanup when tokens become invalid
- Deep linking from notification taps

#### What's Done

**Frontend:**
- [x] `frontend/src/lib/nativePush.ts` - Full FCM registration and handling
- [x] `frontend/src/lib/api.ts` - Device registration endpoints
- [x] `frontend/src/components/NotificationBell.tsx` - Works on native and web
- [x] Notification taps deep link to photo/group
- [x] Unit tests for nativePush

**Backend:**
- [x] `backend/migrations/0010_device_tokens.sql` - Device token table
- [x] `backend/src/lib/db.ts` - Device token CRUD functions
- [x] `backend/src/routes/push.ts` - Device registration endpoints
- [x] `backend/src/lib/fcm.ts` - FCM HTTP v1 API client with token refresh
- [x] `backend/src/routes/photos.ts` - Sends FCM on photo upload
- [x] Invalid token cleanup (auto-removes unregistered tokens)
- [x] Rate limiting on device registration (10 per user per hour)
- [x] Unit tests for device token functions

#### Remaining Setup: Android (In Progress)

**Firebase Configuration:**

1. [x] Create Firebase project at https://console.firebase.google.com
2. [ ] Add Android app (package: `com.photodrop.app`)
3. [ ] Download `google-services.json` → `mobile/android/app/`

**Backend Secret:**

4. [ ] Generate Firebase service account key (Project settings → Service accounts)
5. [ ] Set `FIREBASE_SERVICE_ACCOUNT` secret in Cloudflare Workers

**Then rebuild:**
```bash
cd mobile && npx cap sync
```

#### Android Testing Checklist

- [ ] Permission prompt appears on first launch
- [ ] Token registered with backend after granting permission
- [ ] Push received when photo uploaded (app backgrounded)
- [ ] Notification tap opens app to correct group
- [ ] Token cleaned up on logout
- [ ] Token re-registered on group switch

#### Remaining Setup: iOS (Later)

Requires Apple Developer account ($99/year). Do this after Android is working.

1. [ ] Set up Apple Developer account
2. [ ] Add iOS app in Firebase (bundle ID: `com.photodrop.app`)
3. [ ] Download `GoogleService-Info.plist` → `mobile/ios/App/App/`
4. [ ] Create APNs key in Apple Developer portal
5. [ ] Upload APNs key to Firebase (Project settings → Cloud Messaging)
6. [ ] Run `cd mobile && npx cap sync`

**iOS Testing Checklist:**
- [ ] Same tests as Android

#### Future Considerations

- [ ] **Global rate limiting** - Add a global backstop (e.g., 1000 registrations/hour across all users) to protect against distributed attacks. Low priority for a family photo app, but good defense-in-depth.
- [ ] **Service account key rotation** - Set up periodic rotation of Firebase service account credentials.

---

## Other Mobile TODOs (from MOBILE_PLAN.md)

These are documented in `MOBILE_PLAN.md`:

- [x] **Screenshot protection** - `@capacitor-community/privacy-screen` plugin (configured in `capacitor.config.ts`)
- [ ] **iOS builds** - Requires Apple Developer account
- [ ] **App Store submission** - After testing complete
- [ ] **Play Store submission** - After testing complete

---

## Files Changed (feat/native-notifications)

```text
New:
- backend/migrations/0010_device_tokens.sql (device token table)
- backend/src/lib/fcm.ts (FCM HTTP v1 client)
- frontend/src/lib/nativePush.ts (native push registration)
- frontend/src/lib/nativePush.test.ts (tests)

Modified:
- .gitleaks.toml (allow fcm.ts patterns)
- MOBILE_FIXES.md (this file)
- README.md (FCM setup docs)
- backend/src/lib/db.ts (device token functions)
- backend/src/lib/db.test.ts (device token tests)
- backend/src/routes/photos.ts (send FCM on upload)
- backend/src/routes/push.ts (device registration endpoints)
- frontend/package.json (dependency update)
- frontend/src/components/NotificationBell.tsx (native push support)
- frontend/src/contexts/AuthContext.tsx (native push init)
- frontend/src/lib/api.ts (device registration methods)
```
