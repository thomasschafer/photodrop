# Mobile App - Capacitor Implementation Plan

## Overview

Wrap the existing photodrop PWA in native iOS/Android shells using Capacitor to get:

- **Reliable push notifications** via FCM (Android) and APNs (iOS)
- **Screenshot protection** on both platforms (black screen)
- **App Store / Play Store distribution**

The web app remains unchanged and continues to work — Capacitor wraps it in a WebView with native bridges.

## Development Workflow

### Build & Test Loop

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Code Changes   │────▶│  GitHub Actions  │────▶│  Download APK/  │
│  (on server)    │     │  (build)         │     │  IPA & Install  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  Test on Real   │
                                                 │  Device         │
                                                 └─────────────────┘
```

**For most UI development:** Test in browser (90% of the app is WebView)

**For native features:** Build via GitHub Actions → Download artifact → Install on device

### Live Reload (Optional, Faster Iteration)

For faster development, Capacitor can connect to a live dev server. Since the server is remote, we need a secure tunnel:

**Option: Tailscale (Recommended)**

- Install Tailscale on server and phone
- Both join private mesh VPN
- Phone accesses dev server via private Tailscale IP
- Zero ports exposed to internet

**Setup:**

```bash
# On server (NixOS)
# Add to configuration: services.tailscale.enable = true;
sudo tailscale up

# On phone
# Install Tailscale app, sign in with same account

# In capacitor.config.ts (dev mode)
server: {
  url: 'http://100.x.x.x:5173',  // Tailscale IP
  cleartext: true
}
```

**TODO:** Set up Tailscale if live reload is desired

## Dependencies

### Official Capacitor Plugins

- `@capacitor/core` — Core Capacitor runtime
- `@capacitor/cli` — Build tooling
- `@capacitor/ios` — iOS platform
- `@capacitor/android` — Android platform
- `@capacitor/push-notifications` — Native push notifications (FCM/APNs)

### Community Plugin

- `@capacitor-community/privacy-screen` — Screenshot/screen recording prevention
  - Source: [capacitor-community/privacy-screen](https://github.com/capacitor-community/privacy-screen)
  - Maintainer: Robin Genz ([@robingenz](https://github.com/robingenz))
  - Status: Actively maintained (2025), part of official Capacitor Community org
  - Features:
    - Android: Uses `FLAG_SECURE` — screenshots show black
    - iOS: Hides WebView on app switch, prevents screenshots (black screen captured)
    - Events for screenshot/screen recording detection

## Implementation Phases

### Phase 0: CI/CD Setup ✅

**GitHub Actions workflows for automated builds:**

- [x] `.github/workflows/mobile-android.yml` — Build APK on push to mobile branch
- [x] `.github/workflows/mobile-ios.yml` — Build IPA on push to mobile branch (requires signing setup)

**Artifacts:**

- APK available for download from GitHub Actions
- IPA available for download (once signing is configured)

### Phase 1: Project Setup ✅

**Create Capacitor project structure:**

```
mobile/
├── capacitor.config.ts
├── package.json
├── android/                 # Generated
├── ios/                     # Generated
└── dist/                    # Frontend build copied here
```

**Tasks:**

- [x] Create `mobile/` directory in repo root
- [x] Initialize Capacitor project
- [x] Configure `capacitor.config.ts`:
  - App ID: `com.photodrop.app` (placeholder until Apple Developer account)
  - App name: `photodrop`
  - Web dir pointing to frontend build
  - Privacy screen plugin enabled
  - Push notification presentation options configured
- [x] Add iOS and Android platforms
- [x] Install plugins: `@capacitor/push-notifications`, `@capacitor-community/privacy-screen`
- [ ] Test that web app loads on real device (after first APK build)

**Commands:**

```bash
cd mobile
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init photodrop com.photodrop.app --web-dir=dist
npx cap add ios
npx cap add android
```

### Phase 2: Build Pipeline

**Connect frontend build to Capacitor:**

- [ ] Add build script to copy frontend dist to mobile
- [ ] Update `capacitor.config.ts` for production URLs
- [ ] Test full build → sync → run cycle
- [ ] Add nix commands to flake.nix:
  - `nix run .#mobile-build` — Build frontend, copy to mobile, sync
  - `nix run .#mobile-android-build` — Build Android APK locally (optional)

### Phase 3: Push Notifications

**This is the main feature.** Two parts: native setup + backend changes.

#### 3a: Native Push Setup

- [ ] Install `@capacitor/push-notifications`
- [ ] iOS: Configure APNs in Xcode (requires Apple Developer account)
- [ ] Android: Set up Firebase project, add `google-services.json`
- [ ] Add notification permission request on app launch
- [ ] Handle notification registration → get device token
- [ ] Handle notification tap → deep link to photo

**Frontend changes (`frontend/src/lib/notifications-native.ts`):**

```typescript
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

export async function registerNativePush() {
  if (!Capacitor.isNativePlatform()) return null;

  const permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt') {
    const result = await PushNotifications.requestPermissions();
    if (result.receive !== 'granted') return null;
  }

  await PushNotifications.register();

  return new Promise((resolve) => {
    PushNotifications.addListener('registration', (token) => {
      resolve(token.value);
    });
  });
}
```

**Update existing notification flow:**

- [ ] Detect native vs web platform
- [ ] On native: register for FCM/APNs, send token to backend
- [ ] On web: use existing Web Push flow
- [ ] UI: Same bell icon works for both

#### 3b: Backend Changes

**New table: `device_tokens`**

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

**New endpoints:**

- [ ] `POST /push/register-device` — Register FCM/APNs token
  ```json
  { "platform": "ios", "token": "abc123..." }
  ```
- [ ] `DELETE /push/register-device` — Unregister on logout

**Update photo upload notification logic:**

- [ ] When sending notifications, query both:
  - `push_subscriptions` (web) → send via Web Push
  - `device_tokens` (mobile) → send via FCM/APNs
- [ ] Use Firebase Admin SDK (or direct HTTP) for FCM
- [ ] Use APNs HTTP/2 API for iOS (or Firebase for both)

**Recommendation:** Use Firebase Cloud Messaging for both platforms. iOS can receive FCM if configured properly, simplifying the backend to one notification path for mobile.

### Phase 4: Screenshot Protection

**Install and configure `@capacitor-community/privacy-screen`:**

- [ ] Install plugin: `npm install @capacitor-community/privacy-screen`
- [ ] Configure in `capacitor.config.ts`:
  ```typescript
  plugins: {
    PrivacyScreen: {
      enable: true,
      preventScreenshots: true
    }
  }
  ```

**Frontend integration (optional — plugin auto-enables):**

```typescript
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { Capacitor } from '@capacitor/core';

// Toggle protection when entering/leaving photo viewer (if desired)
async function onPhotoViewerOpen() {
  if (Capacitor.isNativePlatform()) {
    await PrivacyScreen.enable();
  }
}

// Optional: detect screenshot attempts
PrivacyScreen.addListener('screenshotTaken', () => {
  console.log('Screenshot detected');
  // Could notify other users or log this
});
```

**Behavior:**

- **Android:** Uses `FLAG_SECURE` — screenshots show black
- **iOS:** Hides WebView on app switch, screenshots capture black

### Phase 5: Deep Linking

**Handle magic links opening in the app:**

- [ ] Configure URL scheme: `photodrop://`
- [ ] Configure universal links (iOS) / app links (Android)
- [ ] Handle `/auth/:token` routes from email links

**capacitor.config.ts:**

```typescript
{
  appUrlOpen: {
    url: 'https://photos.example.com'; // Your domain
  }
}
```

**Frontend handler:**

```typescript
import { App } from '@capacitor/app';

App.addListener('appUrlOpen', ({ url }) => {
  const path = new URL(url).pathname;
  if (path.startsWith('/auth/')) {
    // Navigate to auth verification
    window.location.href = path;
  }
});
```

### Phase 6: Testing & Polish

- [ ] Test on physical Android device
- [ ] Test on physical iOS device (requires TestFlight)
- [ ] Test push notifications end-to-end
- [ ] Test screenshot blocking
- [ ] Test magic link → app open flow
- [ ] Test offline behavior
- [ ] Add app icons (1024x1024 source)
- [ ] Add splash screen
- [ ] Review and fix any WebView quirks

### Phase 7: App Store Submission

**Prerequisites:**

- [ ] Apple Developer account ($99/year) — **TODO: Set up when ready for iOS testing**
- [ ] Google Play Developer account ($25 one-time) — **TODO: Set up when ready for Android release**

**iOS (TestFlight first):**

- [ ] Configure signing in Xcode
- [ ] Set up GitHub Actions secrets for iOS signing
- [ ] Archive and upload to App Store Connect
- [ ] Submit for TestFlight review
- [ ] Test via TestFlight
- [ ] Submit for App Store review

**Android (Internal Testing first):**

- [ ] Generate signing keystore
- [ ] Set up GitHub Actions secrets for Android signing
- [ ] Generate signed APK/AAB
- [ ] Create Play Store listing
- [ ] Upload to Internal Testing track
- [ ] Test via Play Store
- [ ] Promote to Production

## File Structure

```
photodrop/
├── frontend/              # Existing PWA (unchanged)
├── backend/               # Existing API (minor additions)
├── mobile/
│   ├── capacitor.config.ts
│   ├── package.json
│   ├── ios/
│   │   └── App/
│   │       ├── App.xcodeproj
│   │       └── GoogleService-Info.plist  # Firebase config
│   ├── android/
│   │   └── app/
│   │       ├── build.gradle
│   │       └── google-services.json      # Firebase config
│   └── dist/              # Frontend build copied here
├── .github/
│   └── workflows/
│       ├── mobile-android.yml
│       └── mobile-ios.yml
├── PLAN.md
└── MOBILE_PLAN.md         # This file
```

## Backend Changes Summary

Minimal changes — existing API stays the same:

1. **New migration:** `device_tokens` table
2. **New endpoints:**
   - `POST /push/register-device`
   - `DELETE /push/register-device`
3. **Updated logic:** Photo upload sends to both web push + FCM/APNs

## Frontend Changes Summary

Also minimal — existing code stays the same:

1. **New file:** `notifications-native.ts` — Capacitor push registration
2. **Update:** `NotificationBell.tsx` — detect platform, use native or web push
3. **Update:** Photo viewer — optionally toggle privacy screen

## Open Questions

1. **Firebase vs direct APNs:** Use Firebase for both platforms (simpler) or direct APNs for iOS (more control)?
   - **Recommendation:** Firebase for both — one backend path

2. **Screenshot protection scope:** Whole app or photo viewer only?
   - **Recommendation:** Whole app — simpler and users expect privacy throughout

3. **Deep linking domain:** Need to verify domain ownership for universal links
   - Requires `apple-app-site-association` file on server
   - Can defer if magic links work via URL scheme fallback

## TODOs

- [ ] Set up Tailscale for live reload (optional, for faster iteration)
- [ ] Set up Apple Developer account ($99/year) when ready for iOS
- [ ] Set up Google Play Developer account ($25) when ready for Android release
- [ ] Set up Firebase project for FCM
- [ ] Configure iOS signing certificates and provisioning profiles
- [ ] Configure Android signing keystore
- [ ] Add GitHub Actions secrets for signing

## Definition of Done

- [ ] Android APK downloadable from GitHub Actions
- [ ] iOS IPA downloadable from GitHub Actions (after signing setup)
- [ ] Push notifications work reliably on both platforms
- [ ] Screenshots show black screen on both platforms
- [ ] Magic links open the app correctly
- [ ] All existing PWA features working in native shell
- [ ] Web PWA continues to work independently
