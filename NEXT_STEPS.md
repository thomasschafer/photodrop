# Phase 1.5 Implementation Guide

This guide provides a step-by-step checklist for implementing email-based passwordless authentication.

## Overview

We're migrating from a token-based invite system to a full email-based passwordless authentication flow:

**Old system**: Shareable invite links → user clicks → gets access token
**New system**: Admin sends email → user clicks magic link → gets access token (self-service login for returning users)

## Prerequisites

### 1. Fresh Database Setup

If you have an existing dev database with the old schema:

```bash
nix run .#teardown-dev
nix run .#setup-dev
```

This applies the new schema with email-based authentication.

### 2. Verify Environment

```bash
nix develop
dev-kill  # Stop any running servers
```

## Implementation Checklist

### Backend: Email Integration

- [ ] **Add Cloudflare Email Workers binding**
  - Update `backend/wrangler.toml.template` to include email sending binding
  - Documentation: https://developers.cloudflare.com/email-routing/email-workers/

- [ ] **Create email service** (`backend/src/lib/email.ts`)
  - Function to send invite emails
  - Function to send login link emails
  - HTML email templates (inline CSS for compatibility)
  - Plain text fallback versions

- [ ] **Create magic link service** (`backend/src/lib/magic-links.ts`)
  - `generateMagicLinkToken()` - create cryptographically random token
  - `createMagicLink()` - insert token into database
  - `verifyMagicLink()` - validate token (not expired, not used)
  - `markTokenUsed()` - mark token as consumed
  - Token cleanup function (delete expired tokens)

### Backend: Database Layer

- [ ] **Update User interface** (`backend/src/lib/db.ts`)
  - Change `phone: string | null` to `email: string`
  - Remove `invite_token` and `invite_role` fields
  - Update all references

- [ ] **Add MagicLinkToken interface** (`backend/src/lib/db.ts`)
  ```typescript
  export interface MagicLinkToken {
    token: string;
    email: string;
    type: 'invite' | 'login';
    invite_role: 'admin' | 'viewer' | null;
    created_at: number;
    expires_at: number;
    used_at: number | null;
  }
  ```

- [ ] **Replace old invite functions** (`backend/src/lib/db.ts`)
  - Remove: `createInvite()`, `getUserByInviteToken()`, `acceptInvite()`, `isFirstUserInSystem()`
  - Add: `createUser()`, `getUserByEmail()`, `updateUserLastSeen()`

### Backend: API Endpoints

- [ ] **Remove old endpoints** (`backend/src/routes/auth.ts`)
  - Delete: `/create-invite`, `/accept-invite`

- [ ] **Add new endpoints** (`backend/src/routes/auth.ts`)
  - `POST /send-invite` (admin only)
    - Body: `{ name, email, role }`
    - Creates magic link token (type='invite')
    - Sends invite email
  - `POST /send-login-link` (public)
    - Body: `{ email }`
    - Validates user exists
    - Creates magic link token (type='login')
    - Sends login email
  - `POST /verify-magic-link` (public)
    - Body: `{ token }`
    - Validates token
    - For invite: creates user account
    - For login: validates user exists
    - Issues JWT tokens
    - Returns user data

### Backend: Tests

- [ ] **Rewrite database tests** (`backend/src/lib/db.test.ts`)
  - Remove old invite token tests
  - Add email-based user tests
  - Test magic link token creation/validation

- [ ] **Add email service tests** (`backend/src/lib/email.test.ts`)
  - Mock Cloudflare Email Workers
  - Test email content generation

- [ ] **Add magic link tests** (`backend/src/lib/magic-links.test.ts`)
  - Test token generation (randomness, uniqueness)
  - Test expiry validation
  - Test single-use enforcement

### Frontend: Pages

- [ ] **Create login page** (`frontend/src/pages/Login.tsx`)
  - Email input form
  - "Send login link" button
  - Success message: "Check your email!"
  - Error handling

- [ ] **Create magic link verification page** (`frontend/src/pages/MagicLinkVerify.tsx`)
  - Route: `/auth/:token`
  - Auto-verifies token on mount
  - Shows loading state
  - Success: redirect to main app
  - Error: show error message with retry option

### Frontend: Components

- [ ] **Create invite form** (`frontend/src/components/InviteForm.tsx`)
  - Name input
  - Email input
  - Role selector (admin/viewer)
  - "Send invite" button
  - Success/error messages

- [ ] **Update App.tsx**
  - Add React Router (BrowserRouter, Routes, Route)
  - Route `/` → Login page (if not authenticated) OR Main app (if authenticated)
  - Route `/auth/:token` → MagicLinkVerify page
  - Remove old invite UI

### Frontend: Auth Context

- [ ] **Update AuthContext** (`frontend/src/contexts/AuthContext.tsx`)
  - Update to handle email-based flow
  - Remove any references to invite tokens
  - Add `sendLoginLink()` function

### CLI Script

- [ ] **Create admin invite script** (`scripts/create-admin-invite.sh`)
  - Takes arguments: name, email
  - Uses wrangler to insert user directly into D1
  - Creates magic link token
  - Sends email via Cloudflare Email Workers
  - Prints success message with instructions

- [ ] **Add to flake.nix**
  - Create `create-admin-invite` script wrapper
  - Add to `apps.create-admin-invite`
  - Add to dev shell `nativeBuildInputs`

### Cloudflare Configuration

- [ ] **Set up Cloudflare Email Routing**
  - Configure email routing in Cloudflare dashboard
  - Verify domain for email sending
  - Set up SPF/DKIM records
  - Test email delivery

- [ ] **Update wrangler.toml.template**
  - Add email sending bindings
  - Update environment variables list

### Environment Variables

- [ ] **Add to setup.sh**
  - No new secrets needed for Cloudflare Email Workers (uses account)
  - Possibly add `FROM_EMAIL` if customizable sender

### Testing Plan

#### Manual Testing

- [ ] **Test first admin creation**
  ```bash
  nix run .#create-admin-invite -- "Your Name" "your@email.com"
  # Check email
  # Click magic link
  # Verify logged in as admin
  ```

- [ ] **Test admin creates invite**
  - Log in as admin
  - Go to Invite tab
  - Enter name and email
  - Verify email sent
  - Check email in test inbox
  - Click link
  - Verify new user created

- [ ] **Test returning user login**
  - Logout
  - Go to homepage
  - Enter email
  - Click "Send login link"
  - Check email
  - Click link
  - Verify logged in

- [ ] **Test token expiry**
  - Send login link
  - Wait 16 minutes
  - Click link
  - Verify error message

- [ ] **Test token single-use**
  - Send login link
  - Click link (success)
  - Click same link again
  - Verify error message

#### Automated Testing

- [ ] All backend tests pass
- [ ] All frontend tests pass (if any)

### Documentation Updates

- [ ] Update README.md with new authentication flow
- [ ] Update PLAN.md Phase 1.5 status to complete
- [ ] Remove migration notice from README (once complete)
- [ ] Add example .env variables to documentation

## Common Issues & Solutions

### Email Not Sending

- Check Cloudflare Email Routing is enabled
- Verify domain has SPF/DKIM configured
- Check wrangler.toml has email bindings
- Look at Cloudflare dashboard logs

### Magic Link Not Working

- Check token hasn't expired (15 min limit)
- Verify token hasn't been used already
- Check database for token record
- Ensure frontend extracts token correctly from URL

### Database Errors

- Ensure migrations ran successfully: `cd backend && npx wrangler d1 migrations list photodrop-db-dev --remote`
- Check users table has email column
- Verify magic_link_tokens table exists

## Definition of Done

Phase 1.5 is complete when:

- [ ] Admin can be created via CLI script
- [ ] Admin receives email with magic link
- [ ] Admin can click link and log in
- [ ] Admin can send invites via email
- [ ] New users receive emails and can join
- [ ] Users can request login links on new devices
- [ ] All tests pass
- [ ] Documentation updated
- [ ] No security vulnerabilities (run `nix run .#secrets-scan`)

## Next Phase

Once Phase 1.5 is complete, we move to **Phase 2: PWA Features** (service worker, push notifications, install prompts).
