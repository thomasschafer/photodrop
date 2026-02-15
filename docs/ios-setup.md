# iOS Setup Guide

## Prerequisites

- Apple Developer account (Individual, $99/yr)
- Firebase project (already set up for Android)

## 1. Apple Developer Portal Setup

### Register App ID

1. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
2. Click **+** → **App IDs** → **App**
3. Description: `photodrop`
4. Bundle ID: **Explicit** → `com.photodrop.app`
5. Enable capabilities:
   - **Associated Domains** (for deep links)
   - **Push Notifications**
6. Click **Continue** → **Register**

### Create APNs Key (for Firebase)

1. Go to [Keys](https://developer.apple.com/account/resources/authkeys/list)
2. Click **+** → Name: `photodrop APNs`
3. Enable **Apple Push Notifications service (APNs)**
4. Click **Continue** → **Register** → **Download** the `.p8` file
5. Note the **Key ID** (shown on the key page)
6. Note your **Team ID** (top right of developer portal, or Account → Membership)

### Add APNs Key to Firebase

1. Go to [Firebase Console](https://console.firebase.google.com) → your project
2. Project Settings → Cloud Messaging → **Apple app configuration**
3. Click **Upload** under APNs Authentication Key
4. Upload the `.p8` file, enter Key ID and Team ID

### Register iOS App in Firebase

1. Firebase Console → Project Settings → General → **Add app** → iOS
2. Bundle ID: `com.photodrop.app`
3. App nickname: `photodrop iOS`
4. Download `GoogleService-Info.plist`
5. Place it at `mobile/ios/App/App/GoogleService-Info.plist`

### Create Distribution Certificate

1. Go to [Certificates](https://developer.apple.com/account/resources/certificates/list)
2. Click **+** → **Apple Distribution**
3. You'll need a Certificate Signing Request (CSR):
   - On a Mac: Keychain Access → Certificate Assistant → Request a Certificate from a CA
   - Or generate via CLI: `openssl req -new -key key.pem -out CertificateSigningRequest.certSigningRequest`
4. Upload CSR → Download certificate → Double-click to install in Keychain
5. Export as .p12 from Keychain Access (right-click → Export)

### Create Provisioning Profile

1. Go to [Profiles](https://developer.apple.com/account/resources/profiles/list)
2. Click **+** → **App Store Connect** (for distribution)
3. Select App ID: `com.photodrop.app`
4. Select the distribution certificate you just created
5. Name: `photodrop AppStore`
6. Download the `.mobileprovision` file

For development/testing, also create a **Development** profile:
1. Click **+** → **iOS App Development**
2. Select App ID, certificate, and test devices
3. Name: `photodrop Development`

## 2. GitHub Secrets

Add these to the repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `APPLE_TEAM_ID` | Your 10-character Team ID |
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64` | `base64 -i certificate.p12` output |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | Password set when exporting .p12 |
| `IOS_PROVISIONING_PROFILE_BASE64` | `base64 -i profile.mobileprovision` output |
| `IOS_KEYCHAIN_PASSWORD` | Any random string (temp keychain on CI) |

For TestFlight auto-upload (optional, can add later):

| Secret | Value |
|--------|-------|
| `APP_STORE_CONNECT_API_KEY_ID` | API key ID from App Store Connect |
| `APP_STORE_CONNECT_API_ISSUER_ID` | Issuer ID from App Store Connect → Users → Keys |
| `APP_STORE_CONNECT_API_KEY_BASE64` | `base64 -i AuthKey_XXXXXX.p8` output |

## 3. App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. My Apps → **+** → **New App**
   - Platform: iOS
   - Name: `photodrop`
   - Primary language: English (UK)
   - Bundle ID: `com.photodrop.app`
   - SKU: `photodrop`
3. Fill in app information (description, screenshots, etc.)
4. TestFlight builds will appear automatically after CI uploads

## 4. GoogleService-Info.plist

The iOS Firebase config file needs to be in the Xcode project. Two options:

### Option A: CI via GitHub Secret (recommended)
```bash
# Encode the file
base64 -i GoogleService-Info.plist | pbcopy
```
Add as secret `IOS_GOOGLE_SERVICE_INFO_BASE64`. The CI workflow decodes it during build.

### Option B: Commit to repo
If the project is private, you can just commit `mobile/ios/App/App/GoogleService-Info.plist` directly. It contains no sensitive secrets (Firebase API keys are meant to be client-side).

## 5. Testing

### TestFlight (recommended for beta)
- After CI builds and uploads, go to App Store Connect → TestFlight
- Add internal testers (your Apple ID, wife's Apple ID)
- Testers get notified and can install via TestFlight app

### Ad Hoc (alternative)
- Create an Ad Hoc provisioning profile instead of App Store
- Requires registering device UDIDs in the developer portal
- IPA can be installed directly via Apple Configurator or Finder

## 6. Universal Links (AASA)

The file `frontend/public/.well-known/apple-app-site-association` contains `TEAM_ID` as a placeholder. This needs to be replaced with your actual Team ID before deploying the frontend.

The iOS CI workflow does this automatically. For manual deploys or the regular frontend deploy, either:
- Replace `TEAM_ID` in the file permanently (it's not sensitive), or
- Add the substitution to your deploy script

## Checklist

- [ ] Apple Developer account approved
- [ ] App ID registered with Push + Associated Domains
- [ ] APNs key created and uploaded to Firebase
- [ ] iOS app added to Firebase, `GoogleService-Info.plist` obtained
- [ ] Distribution certificate created and exported as .p12
- [ ] App Store provisioning profile created
- [ ] GitHub secrets configured
- [ ] First CI build succeeds
- [ ] App appears in TestFlight
- [ ] Push notifications work on iOS device
