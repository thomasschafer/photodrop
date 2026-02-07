# Mobile App Fixes - Phase 2

## Status Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | Header/safe area | ✅ Done |
| 2 | Hide install banner | ✅ Done |
| 3 | Images not loading | ✅ Done |
| 4 | Pull-to-refresh | ✅ Done |
| 5 | GitHub workflow PR builds | ✅ Done |
| 6 | Native push notifications | ✅ Done (testing in progress) |

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

#### Setup: Android ✅

**Firebase Configuration:**

1. [x] Create Firebase project at https://console.firebase.google.com
2. [x] Add Android app (package: `com.photodrop.app`)
3. [x] Add `GOOGLE_SERVICES_JSON` GitHub secret (CI injects it during build)

**Backend Secret:**

4. [x] Generate Firebase service account key (Project settings → Service accounts)
5. [x] Set `FIREBASE_SERVICE_ACCOUNT` secret in Cloudflare Workers

#### Android Testing Checklist (In Progress)

- [x] Permission prompt appears on first login (confirmed - user granted permission)
- [x] Token obtained from FCM (confirmed - "Token: Ready" in debug modal)
- [x] Token registered with backend (confirmed - state changed to "subscribed" after bell tap)
- [ ] Push received when photo uploaded (app backgrounded) - **NOT WORKING YET**
- [ ] Notification tap opens app to correct group
- [ ] Token cleaned up on logout
- [ ] Token re-registered on group switch

---

## Known Bugs & Unverified Fixes

These issues were discovered during testing. Fixes have been implemented but not yet verified (pending backend deployment).

### 1. Push notifications not being received

**Symptom:** User grants permission, token is registered, but no push notifications arrive when photos are uploaded.

**Root cause:** Backend changes (FCM sending, test endpoint) not deployed yet - only the APK (frontend) was updated.

**Fix:** Merge branch and deploy backend to Cloudflare Workers.

**To verify:** After deployment, use the test notification button (long-press bell) to confirm FCM is working end-to-end.

### 2. HEIC uploads failing on web

**Symptom:** HEIC images from iPhone fail to upload on web. Preview doesn't work either.

**Root cause:** Browsers don't support HEIC natively - `browser-image-compression` can't process it, `<img>` can't display it.

**Fix implemented:** Added `heic2any` library to convert HEIC → JPEG before compression.

**To verify:** Upload a HEIC image from iPhone on web browser.

### 3. Native uploads were failing

**Symptom:** "Failed to fetch" error when uploading photos from native app.

**Root cause:** Regular `fetch` doesn't work well for cross-origin multipart uploads on native Android.

**Fix implemented:** Enabled `CapacitorHttp.enabled: true` in capacitor.config.ts to patch fetch globally.

**Verified:** PNG uploads work. HEIC not tested yet.

### 4. Notification bell was hidden

**Symptom:** Bell icon not visible in header on native app.

**Root cause:** Component returned `null` during loading state, and the status check was failing/hanging.

**Fix implemented:** 
- Bell now always renders (shows spinner during loading)
- Added error state handling
- Tap bell in loading/error state shows debug info
- Long-press bell opens test notification modal

**Verified:** Bell now visible.

### 5. Auto-registration not working on first login

**Symptom:** User had to manually tap bell to register for notifications after granting permission.

**Root cause:** `initializeNativePush()` runs when user logs in, but if permission wasn't granted yet, it doesn't retry after permission is granted in settings.

**Current behavior:** User must tap bell to register after enabling notifications in Android settings.

**To investigate:** Check if auto-init works when permission is granted via the native prompt (not retroactively via settings).

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
- .github/workflows/mobile-android.yml (GOOGLE_SERVICES_JSON secret)
- MOBILE_FIXES.md (this file)
- PLAN.md (updated phase status)
- README.md (FCM setup docs, CI-first workflow)
- backend/src/lib/db.ts (device token functions)
- backend/src/lib/db.test.ts (device token tests)
- backend/src/routes/photos.ts (send FCM on upload)
- backend/src/routes/push.ts (device registration + test endpoint)
- frontend/package.json (heic2any dependency)
- frontend/src/components/NotificationBell.tsx (native push, debug modal, test button)
- frontend/src/contexts/AuthContext.tsx (native push init)
- frontend/src/lib/api.ts (device registration + test methods)
- frontend/src/lib/imageCompression.ts (HEIC conversion)
- mobile/capacitor.config.ts (CapacitorHttp global patching)
```
