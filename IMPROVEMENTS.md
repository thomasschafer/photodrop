# Codebase Improvements Plan

## Items to implement (34 total)

### Security & Auth
1. Normalize emails everywhere — `.toLowerCase().trim()` on all email inputs
2. Use Hono's `getCookie()` for refresh token parsing
3. Change `SameSite: Strict` → `Lax` on all cookie-setting calls
4. Sanitize caption in push notifications
5. Add CSRF protection (custom header requirement on cookie-using endpoints)
6. Token revocation mechanism (token version in D1)

### Architecture & Code Quality
7. DRY up Bindings/Variables types — import from types.ts everywhere
8. Extract shared profile colors (or add test verifying FE↔BE match)
9. Split PhotoFeed.tsx into sub-components
10. Split NotificationBell.tsx into smaller modules
11. Refactor FCM/VAPID singletons to pass config as parameters
12. Consolidate error handling with Hono error middleware
13. Add request validation with Zod schemas

### Performance
14. Eliminate double image fetch
15. Batch R2 deletes on group deletion (parallel with batching)
16. Add Cache-Control headers to API responses
18. Lazy-load heavy components (React.lazy + Suspense)

### Testing
20. Backend unit tests for: photos routes, push, fcm, email, rateLimit, fileValidation, magic-links
21. Frontend unit tests for: AuthContext, PhotoFeed, MembersList, NotificationBell, useAuthenticatedImage, useVirtualCarousel
22. Integration test for token refresh flow
23. Test that profile colors match FE↔BE
24. E2e test for upload flow

### Mobile / PWA
25. Add aps-environment entitlement for iOS
26. Add Privacy Screen to iOS SPM deps
27. Auto-increment versionCode
28. Add proper iOS notification configuration
29. Handle notification deep-linking on cold start (getLaunchUrl)
30. Service worker update prompt instead of auto-update

### Misc
31. Add structured logging wrapper
32. Members list visible to all (emails hidden for non-admins)
34. Comment rate limiting
35. Soft-delete comments
36. Add Content-Security-Policy header
37. Email validation with proper regex
