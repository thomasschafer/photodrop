# Deep Linking Setup

Magic links need to open in the app instead of the browser. This requires:

- **Android:** App Links with `assetlinks.json`
- **iOS:** Universal Links with `apple-app-site-association`

## Android App Links

### 1. Get SHA256 Fingerprint

For **debug** builds (testing):

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256
```

For **release** builds (production):

```bash
keytool -list -v -keystore your-release-key.keystore -alias your-alias | grep SHA256
```

### 2. Create assetlinks.json

Create `/.well-known/assetlinks.json` on your domain with:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.photodrop.app",
      "sha256_cert_fingerprints": ["YOUR_DEBUG_SHA256_HERE", "YOUR_RELEASE_SHA256_HERE"]
    }
  }
]
```

### 3. Deploy to Cloudflare

Since the site is on Cloudflare Pages, add the file to your frontend build:

- Create `frontend/public/.well-known/assetlinks.json`
- It will be deployed automatically with the frontend

### 4. Verify

Test with: https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://YOUR_DOMAIN&relation=delegate_permission/common.handle_all_urls

## iOS Universal Links

### 1. Create apple-app-site-association

Create `/.well-known/apple-app-site-association` (no file extension):

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "TEAM_ID.com.photodrop.app",
        "paths": ["/auth/*"]
      }
    ]
  }
}
```

Replace `TEAM_ID` with your Apple Developer Team ID.

### 2. Configure Xcode

In Xcode, add "Associated Domains" capability:

- `applinks:YOUR_DOMAIN`

### 3. Deploy

Add to `frontend/public/.well-known/apple-app-site-association`

## Testing

- Android: `adb shell am start -a android.intent.action.VIEW -d "https://YOUR_DOMAIN/auth/test"`
- iOS: Long-press link in Notes app, should show "Open in photodrop"
