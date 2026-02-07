# photodrop

A web app for privately sharing photos.

See [PLAN.md](PLAN.md) for architecture details and implementation status.

## Local development

```bash
# Enter nix shell (or use direnv)
nix develop

# Start development servers (auto-configures on first run)
nix run .#dev
```

Visit http://localhost:5173. No Cloudflare account needed - D1 and R2 are simulated locally.

**Note:** Push notifications don't work in local development yet (although we could change this in future).

### Creating a group

Groups are created via CLI (there's no public signup):

```bash
nix run .#create-group -- "Family Photos" "Tom" "tom@example.com"
```

This outputs a magic link. Click it to log in as the group owner.

### Testing with seed data

For quick testing, seed the database with test users:

```bash
nix run .#db-seed
```

Then go to http://localhost:5173/login, enter `admin@test.com`, and copy the magic link from the backend console.

## Available commands

| Command | Description |
|---------|-------------|
| `nix run .#dev` | Start development servers |
| `nix run .#create-group -- <name> <owner> <email>` | Create a new group |
| `nix run .#db-seed` | Seed local DB with test users |
| `nix run .#test` | Run unit tests |
| `nix run .#test-e2e` | Run end-to-end tests |
| `nix run .#setup-prod` | Create production Cloudflare resources |
| `nix run .#deploy` | Deploy to production |
| `nix run .#teardown-dev` | Clean local dev files |
| `nix run .#teardown-prod` | Delete production Cloudflare resources |

## Production deployment

### Prerequisites

- Cloudflare account with Workers & Pages, D1 and R2 enabled
- Domain already added to Cloudflare (can be apex like `example.com` or subdomain like `photos.example.com`)
- `wrangler` CLI authenticated (`wrangler login`)

### One-time setup

```bash
nix run .#setup-prod
```

The script will:
1. Prompt for your domain (e.g., `photos.example.com`)
2. Create D1 database and R2 bucket
3. Generate secrets (JWT, VAPID keys)
4. Create Pages project
5. Run database migrations

Your app will be available at:
- Frontend: `https://your-domain.com`
- API: `https://api.your-domain.com`

### Deploy

```bash
nix run .#deploy
```

After the first deploy, set up DNS and custom domains:

1. **Add API subdomain DNS record** (required for Worker routes):
   - Go to Cloudflare dashboard → your domain → DNS
   - Add record: Type `AAAA`, Name `api`, IPv6 address `100::`, Proxy status: Proxied (orange cloud)
   - The actual IP doesn't matter - Cloudflare routes traffic to your Worker

2. **Add Pages custom domain**:
   - Go to Cloudflare dashboard → Workers & Pages → photodrop → Custom domains
   - Add your domain (e.g., `photos.example.com`)

3. **Optional: Set up www redirect**:
   - Go to Workers & Pages → photodrop → Custom domains → Add `www.your-domain.com`
   - Add the CNAME record it prompts for (www → your-pages-project.pages.dev)
   - Go to Rules → Redirect Rules → Create rule using "Redirect from WWW to root" template
   - Set Request URL to `https://www.your-domain.com/*`
   - Set Target URL to `https://your-domain.com/${1}` with status 301
   - Check "Preserve query string"

### CI/CD setup (optional)

For automatic deployments on push to `main`:

1. Add **secrets** to GitHub (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` - Create at https://dash.cloudflare.com/profile/api-tokens with permissions:
      - Account / Workers Scripts: Edit
      - Account / D1: Edit
      - Account / Cloudflare Pages: Edit
      - Account / Account Settings: Read
   - `CLOUDFLARE_ACCOUNT_ID` - From `backend/.prod.vars`
   - `D1_DATABASE_ID` - From `backend/.prod.vars`
   - `JWT_SECRET` - From `backend/.prod.vars`
   - `VAPID_PUBLIC_KEY` - From `backend/.prod.vars`
   - `VAPID_PRIVATE_KEY` - From `backend/.prod.vars`
   - `RESEND_API_KEY` - (Optional) Only needed if you want CI to manage this secret

2. Add **variables** to GitHub (Settings → Secrets and variables → Actions → Variables):
   - `DOMAIN` - Your frontend domain (e.g., `photos.example.com`)
   - `API_DOMAIN` - Your API domain (e.g., `api.photos.example.com`)
   - `PAGES_PROJECT` - `photodrop` (optional, defaults to `photodrop`)

### Creating groups in production

**Note:** Email must be configured before creating groups. See "Email setup" below.

```bash
nix run .#create-group -- "Family Photos" "Tom" "tom@example.com" --prod
```

The magic link will be sent to the email address provided.

### Email setup (Resend)

Email is required for magic link authentication. We use [Resend](https://resend.com) (3,000 emails/month free).

1. **Sign up** at https://resend.com

2. **Add your domain**:
   - Go to Resend dashboard → Domains → Add Domain
   - Enter your domain (e.g., `example.com`)
   - Follow the automated flow to add DNS records to Cloudflare
   - Wait for verification (usually instant, can take up to 48h)

3. **Create API key**:
   - Go to Resend dashboard → API Keys → Create API Key
   - Give it a name and "Sending access" permission
   - Copy the key (you won't see it again)

4. **Add to production**:
   ```bash
   # Add to your local .prod.vars
   echo 'RESEND_API_KEY="re_xxxxx"' >> backend/.prod.vars

   # Deploy the secret to Cloudflare (persists across deploys)
   echo "re_xxxxx" | wrangler secret put RESEND_API_KEY --name photodrop-api
   ```

5. **Test**: Create a group with your real email address and verify the invite email arrives.

Emails are sent from `noreply@your-domain.com` (configured automatically from your `DOMAIN` setting).

## Mobile app (Capacitor)

The mobile app wraps the PWA for native iOS/Android with reliable push notifications and screenshot protection.

See [MOBILE_PLAN.md](MOBILE_PLAN.md) for detailed implementation status.

### One-time setup (Android signing + deep links)

> **Different domain?** Update these files before building:
> - `mobile/android/app/src/main/AndroidManifest.xml` (intent filter host)
> - `mobile/capacitor.config.ts` (allowNavigation)
> - `frontend/public/.well-known/assetlinks.json` (after generating keystore)
> - `frontend/public/.well-known/apple-app-site-association` (with your Team ID)

**1. Generate release keystore** (run once, keep safe forever):
```bash
./scripts/generate-android-keystore.sh
```

**2. Add GitHub secrets** (Settings → Secrets → Actions):
| Secret | Value |
|--------|-------|
| `ANDROID_KEYSTORE` | Base64-encoded keystore: `base64 -w 0 photodrop-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | The password you chose |
| `ANDROID_KEY_ALIAS` | `photodrop` |
| `ANDROID_KEY_PASSWORD` | Same as keystore password |

**3. Update deep linking config** with SHA256 from script output:
```bash
# Edit frontend/public/.well-known/assetlinks.json
# Replace SHA256_FINGERPRINT_PLACEHOLDER with your fingerprint
```

**4. Deploy frontend** to publish the assetlinks.json file.

**5. (iOS only)** When you have an Apple Developer account:
- Get your Team ID from developer.apple.com
- Edit `frontend/public/.well-known/apple-app-site-association`
- Replace `TEAM_ID` with your actual Team ID

### Native push notifications (FCM)

Native apps use Firebase Cloud Messaging for push notifications. Without this setup, the app works but users won't receive notifications when photos are shared.

**1. Create Firebase project**:
- Go to https://console.firebase.google.com → Create project (or use existing)
- Project name can be anything (e.g., "photodrop")

**2. Add Android app**:
- In Firebase Console → Project settings → General → Add app → Android
- Package name: `com.photodrop.app`
- Download `google-services.json`
- Copy to `mobile/android/app/google-services.json`

**3. Add iOS app**:
- In Firebase Console → Project settings → General → Add app → iOS
- Bundle ID: `com.photodrop.app`
- Download `GoogleService-Info.plist`
- Copy to `mobile/ios/App/App/GoogleService-Info.plist`

**4. iOS APNs setup** (required for iOS push — needs Apple Developer account):
- Go to developer.apple.com → Certificates, Identifiers & Profiles → Keys
- Create new key with "Apple Push Notifications service (APNs)" enabled
- Download the `.p8` file and note the Key ID
- In Firebase Console → Project settings → Cloud Messaging → Apple app configuration
- Upload the APNs key, enter Key ID and Team ID

**5. Backend configuration**:
```bash
# Generate service account key:
# Firebase Console → Project settings → Service accounts → Generate new private key
#
# Security: The default "Firebase Admin SDK" role is fine for a personal project.
# For tighter security, create a custom service account in Google Cloud Console
# (IAM & Admin → Service Accounts) with only the "Firebase Cloud Messaging API Admin" role.

# Add to Cloudflare Workers (production) - pipe from downloaded file:
cat ~/Downloads/your-firebase-key.json | wrangler secret put FIREBASE_SERVICE_ACCOUNT --name photodrop-api

# For local development, add to backend/.dev.vars:
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
```

**6. Rebuild mobile app** after adding config files:
```bash
cd mobile && npx cap sync
```

**Testing**: Upload a photo from one device — other group members with the app installed should receive a push notification.

### Building

**Android APK** (via GitHub Actions):
- Push to `main` branch (or `feat/mobile-capacitor`)
- Download APK from Actions artifacts
- With signing configured: release APK ready for Play Store
- Without signing: debug APK for testing

**Local Android build** (requires Java 21 + Android SDK):
```bash
cd frontend && npm run build
cd ../mobile && npm install
cp -r ../frontend/dist ./dist
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

**iOS** (requires Mac + Xcode + Apple Developer account):
```bash
cd mobile && npx cap open ios
# Build and sign in Xcode
```

## Architecture

- **Frontend**: React + Vite PWA
- **Backend**: Cloudflare Workers + Hono
- **Database**: D1 (SQLite)
- **Storage**: R2 (S3-compatible)
- **Auth**: Passwordless magic links
- **Mobile**: Capacitor (iOS/Android wrapper)
