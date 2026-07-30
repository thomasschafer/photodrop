# Product testing report — 29 July 2026

Hands-on product testing of photodrop against the local dev stack (frontend :5173, API :8787, seeded "Test Family" group), driven in **real Chrome** (Claude in Chrome extension) and **real Safari 26.5.2** (safaridriver/WebDriver, desktop and 390px-wide window). Multi-user flows were exercised with concurrent sessions (owner in Chrome, members in Safari and via the API), plus direct API probing for permissions, validation and rate limits.

Everything below was observed live unless marked as code-verified.

## Bugs

### B1. Pagination race silently loses a page of photos (high)

Duplicate concurrent load-more fetches double-advance the pagination offset, permanently skipping a page for that session. Reproduced in Chrome with 53 photos: two racing `GET /photos?offset=20` requests each advanced `nextOffsetRef` by the raw page size (20 → 60); rows 41–59 were never requested, the `offset=60` page returned 0 rows, so `hasMore` became false and the feed ended at 40/53 photos — with no indication anything is missing.

Root cause: the in-flight guard `loadingMore` in `PhotoFeed.tsx` (`loadMorePhotos`, ~line 115) is React state, which commits asynchronously; two same-tick triggers (the scroll listener and the ResizeObserver both call `maybeLoadMore`) both pass `if (loadingMore) return`. Fix: make the single-flight guard a ref/promise, and advance the offset at most once per distinct offset served.

Related: there is no end-of-feed indicator ("You're all caught up"), so a silently truncated feed is indistinguishable from a complete one. Load-more also needed an extra scroll event to fire after the viewport had settled at the bottom.

### B2. Modal focus trap fails in real Safari (high, accessibility)

With Safari's default "Tab skips buttons" behaviour, `useFocusTrap` only intercepts Tab when the active element is the first/last entry of its focusable list — both buttons, which Safari's native tab order never focuses. Verified live in the Name settings dialog: Tab cycles [background feed card → Close → name input → display-name input]; focus escapes into content behind the dialog (which `aria-modal` tells AT does not exist), and Cancel/Save are unreachable by keyboard. Chrome cycles correctly (input → input → Cancel → Save → Close → wrap).

Fix: intercept every Tab while the trap is enabled and move focus manually through the trap's own focusable list. This is exactly the class of WebKit-only bug the opt-in WebKit e2e run exists for — worth adding a spec.

### B3. Reaction "who reacted" tooltip renders off-screen in the lightbox

Hovering a reaction pill in the lightbox renders the attribution tooltip above the pill, where it is clipped by the viewport top edge — unreadable in both browsers. Needs flip-to-below (or collision-aware) placement.

### B4. Invalid image file produces a broken preview and a generic error

A non-image file with a `.png` extension passes client-side validation, shows a broken preview thumbnail with Upload enabled, then fails with just "Upload failed". The server-side pipeline is solid (magic-byte validation, 20MB cap, MIME allowlist) — the client should decode-validate at selection time and say the file isn't a valid image. (`PhotoUpload.tsx` / `imageCompression.ts` validate by MIME/extension only.)

### B5. Tombstone-only comment threads look broken

A photo whose only comment was deleted shows badge count 0, but opening the panel renders a lone "This comment has been deleted." row. Tombstones make sense between surviving comments; with no context they read as a glitch. Hide tombstones that have no adjacent visible comments (and keep the count consistent with what's shown).

### B6. Reaction pills re-sort under the cursor

Pills reorder by count immediately on click, so the "+" button and other pills shift position mid-interaction — I toggled 😮 on while aiming at "+". Keep ordering stable while the pointer is over the pill row (re-sort on close/blur).

## Product gaps

### G1. The feed never updates on desktop (major)

There is no polling, no visibilitychange/focus refetch, no refresh button; `PullToRefresh` is a mobile touch gesture. Verified live: a member reacting and commenting from a second session never appeared in the owner's open feed — only a full page reload showed it. Display-name changes similarly don't propagate to the already-rendered feed. For a group photo-sharing product the shared feed feeling dead is the single biggest product issue. Even a cheap interval/on-focus refetch of counts would transform it; SSE/websockets can come later.

### G2. Single-photo upload only

The file input lacks `multiple`, there's no drag-and-drop and no paste-from-clipboard. Batch upload is table stakes for photo sharing — after an event, an admin uploads dozens of photos one at a time, re-opening the modal each time.

### G3. View receipts are dead code

Backend has `POST /photos/:id/view` and admin-only `GET /photos/:id/viewers`; `api.ts` has `recordView`/`getViewers`; no UI code calls either. Views are never recorded and the planned "Seen by" surface doesn't exist. Ship it or delete it.

### G4. No in-app activity surface

The bell icon is actually a push-notification on/off toggle (its highlighted state means "enabled"; clicking it while enabled offers to disable). There is no notification inbox / "what happened since I last looked" view — reactions and comments on your photos are discoverable only by scrolling. Combined with G1, returning users see nothing new without work.

### G5. Invites are fire-and-forget

After "Invite sent", the pending invite appears nowhere: no pending row in the members list, no resend, no revoke, no way to spot a typo'd email. Admins can't tell whether an invite was accepted.

### G6. No caption/photo editing

Captions can't be edited (or removed) after upload, and there's no photo replacement. Typos are permanent unless the photo is deleted and re-uploaded (losing reactions/comments).

### G7. No sanctioned download/export

`/photos/:id/download` is only the lightbox's full-size fetch; there is no download button for anyone, and originals are recompressed client-side before storage. If that's the privacy posture, fine — but consider a per-group "allow downloads" policy, and an owner-level export (e.g. before deleting a group; "Delete group" currently destroys all photos with no export path).

## UX and polish

- **U1. Caption missing in lightbox** — the feed card shows the caption, the lightbox shows only uploader + time. Opening a photo loses its story; captions belong in the lightbox (e.g. in the comment panel header). Also no position indicator ("14 of 53").
- **U2. Silent account switching** — opening an invite/login magic link while signed in as someone else silently replaces the session, with no "you're switching accounts" acknowledgement. Also sign-out is a single un-confirmed click, which is expensive to undo with email-loop auth.
- **U3. Header icon ambiguity** — the PWA install button uses a download glyph (looks like "download photos"); the bell reads as an inbox (see G4). Aria labels are right; the visual affordances aren't.
- **U4. Two identities on one screen** — after setting a per-group display name, feed bylines show "Tom the Tester"/TT while the header avatar still shows canonical initials TO.
- **U5. Install prompt timing** — Safari shows the install modal on first visit before any engagement, and its copy says "Add to your home screen" on macOS where the affordance is Add to Dock.
- **U6. Image loading feel** — every thumbnail is an authenticated fetch → blob (no native caching); photos pop in after a couple of seconds on a plain dark placeholder. A skeleton shimmer/blurhash and stronger client caching would noticeably improve perceived speed.
- **U7. No upload progress** — large uploads show only "Uploading…"; no percentage/progress bar.

## Accessibility

Overall genuinely strong — credit where due: descriptive labels on nearly every control ("Add ❤️ reaction", "Set Ravi's display name in Test Family", "Expand comments (1 comment)", "Owners cannot be removed"), skip-to-content link, correct tab/tabpanel roles, arrow-key photo navigation, Escape closing the lightbox with focus restored to the originating card, and a correct focus cycle in Chrome modals.

- **A1.** Safari focus trap escape — see B2 (the one serious a11y defect found).
- **A2.** The comment-sort dropdown button exposes no accessible name in the member lightbox (announced as unnamed; sighted users see "Oldest").
- **A3.** Reaction attribution is hover-tooltip-only (and clipped, B3) — there's no keyboard/AT path to find out who reacted. A click-to-open list would fix both.

## What's working well

Worth stating, because a lot of this is genuinely solid: magic links are single-use with non-enumerating copy and good expired/invalid recovery pages; permission boundaries held up under adversarial API probing (member upload/delete/list-users all correctly rejected; CSRF `X-Requested-With` required on writes; server-side emoji allowlist and comment length/emptiness validation; short-lived access tokens); upload hardening server-side is thorough (magic bytes, size caps); deep-linkable `/photo/:id` and `?comments=open` URLs; comment prefetch for adjacent photos; HEIC conversion; theme system; role gating in the UI is exact; the invite onboarding is clean; delete flows have clear, well-copied confirm modals; light/dark themes both render well; the 390px layout is tidy with a complete hamburger menu.

## Test coverage suggestions

1. WebKit e2e spec: Tab-cycle containment in each modal (would have caught B2).
2. E2e: paginate a 45+ photo feed to exhaustion and assert every photo id present exactly once (would have caught B1, including under simulated double-trigger).
3. E2e: corrupt-image selection shows a specific error before upload (B4).

## Environment notes

- Dev servers were left running (`nix run .#dev`, background task). DB currently holds the 50-photo seed plus test reactions/comments from this session (including 12 "rate probe" comments on the newest seeded photo); `nix run .#db-seed` resets the seeded content. A "Ninà O'Brien-Test" user (newperson@test.com) was created via the invite flow.
- Real-Safari automation is now available on this machine (Remote Automation enabled); quirks documented in project memory.
