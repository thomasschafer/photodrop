import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { createTestGroup, createFreshMagicLink, cleanupTestGroup, TestGroup } from './helpers/setup';
import { loginWithMagicLink, logout, expectLoggedIn, expectLoggedOut } from './helpers/auth';

test.describe('Auth edge cases', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Auth Edge Case Group');

    // Consume the admin invite link via API to create the user
    const inviteToken = testGroup.magicLink.split('/auth/')[1];
    await request.post('http://localhost:8787/auth/verify-magic-link', {
      data: { token: inviteToken },
    });
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('expired magic link shows error', async ({ page }) => {
    // Create an expired token directly in DB
    const token = randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);
    const expiredAt = now - 60; // Expired 1 minute ago

    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO magic_link_tokens (token, group_id, email, type, invite_role, created_at, expires_at) VALUES ('${token}', '${testGroup.groupId}', '${testGroup.adminEmail}', 'login', NULL, ${now - 1000}, ${expiredAt});"`,
      { stdio: 'pipe' }
    );

    // Try to use expired token
    await page.goto(`http://localhost:5173/auth/${token}`);

    // Should show error message
    await expect(page.getByText(/expired|invalid/i)).toBeVisible({ timeout: 5000 });

    // Should not be logged in (no Photos button visible)
    await expect(page.getByRole('button', { name: 'Photos' })).not.toBeVisible();
  });

  test('reused magic link shows error', async ({ page }) => {
    // Create a fresh magic link for this test
    const freshLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');

    // First, use the magic link
    await loginWithMagicLink(page, freshLink);
    await expectLoggedIn(page);

    // Clear cookies/storage to simulate new browser
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Try to use the same magic link again
    await page.goto(freshLink);

    // Should show error (token already used) - checking for the error heading
    await expect(page.getByText('Link not valid')).toBeVisible({ timeout: 5000 });
  });

  test('invalid token redirects or shows error', async ({ page }) => {
    const invalidToken = randomBytes(32).toString('hex');

    await page.goto(`http://localhost:5173/auth/${invalidToken}`);

    // Should show error message
    await expect(page.getByText(/invalid|not found|expired/i)).toBeVisible({ timeout: 5000 });

    // Should not show logged-in UI
    await expect(page.getByRole('button', { name: 'Photos' })).not.toBeVisible();
  });

  test('session persists across page reload', async ({ page }) => {
    // Create a fresh login link
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');

    // Login
    await loginWithMagicLink(page, magicLink);
    await expectLoggedIn(page);

    // Reload the page
    await page.reload();

    // Should still be logged in
    await expectLoggedIn(page);

    // Navigate away and back
    await page.goto('http://localhost:5173/login');
    await page.goto('http://localhost:5173/');

    // Should still be logged in
    await expectLoggedIn(page);
  });

  test('logout clears session', async ({ page }) => {
    // Create a fresh login link
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');

    // Login
    await loginWithMagicLink(page, magicLink);
    await expectLoggedIn(page);

    // Sign out via user menu
    await logout(page);

    // Refresh should still be logged out
    await page.reload();
    await expectLoggedOut(page);
  });

  test('API request with invalid token returns 401', async ({ request }) => {
    const response = await request.get('http://localhost:8787/photos', {
      headers: {
        Authorization: 'Bearer invalid-token-here',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('API request without token returns 401', async ({ request }) => {
    const response = await request.get('http://localhost:8787/photos');

    expect(response.status()).toBe(401);
  });

  test('user with no groups sees "No groups yet" page', async ({ page }) => {
    // Create a group and user, then remove their membership
    const noGroupsTestGroup = createTestGroup('No Groups Test');
    const userId = noGroupsTestGroup.ownerId;
    const userEmail = noGroupsTestGroup.ownerEmail;

    try {
      // Remove the user's membership from the group
      execSync(
        `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM memberships WHERE user_id = '${userId}';"`,
        { stdio: 'pipe' }
      );

      // Create a login magic link for this user (link is for the group, but user has no membership)
      const magicLink = createFreshMagicLink(noGroupsTestGroup.groupId, userEmail, 'login');

      // Login - this should work but user won't have access to the group
      await page.goto(magicLink);

      // Should see "No groups yet" page
      await expect(page.getByText('No groups yet')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/not a member of any groups/i)).toBeVisible();

      // Should show sign out option
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

      // Should NOT show landing page "Sign in" link
      await expect(page.getByRole('link', { name: 'Sign in' })).not.toBeVisible();

      // Clicking sign out should work
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expectLoggedOut(page);
    } finally {
      cleanupTestGroup(noGroupsTestGroup.groupId);
    }
  });

  test('user with multiple groups but none selected sees group picker', async ({ page }) => {
    // Create two groups with the same user as a member of both
    const group1 = createTestGroup('Multi Group Test 1');
    const group2Id = randomBytes(16).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    // Create second group with a different owner
    const group2OwnerId = randomBytes(16).toString('hex');
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO users (id, name, email, profile_color, created_at) VALUES ('${group2OwnerId}', 'Group 2 Owner', 'owner-${group2Id.slice(0, 8)}@test.local', 'terracotta', ${now});"`,
      { stdio: 'pipe' }
    );
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO groups (id, name, owner_id, created_at) VALUES ('${group2Id}', 'Multi Group Test 2', '${group2OwnerId}', ${now});"`,
      { stdio: 'pipe' }
    );
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO memberships (user_id, group_id, role, joined_at) VALUES ('${group2OwnerId}', '${group2Id}', 'admin', ${now});"`,
      { stdio: 'pipe' }
    );

    // Add group1's owner to group2 as a member
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO memberships (user_id, group_id, role, joined_at) VALUES ('${group1.ownerId}', '${group2Id}', 'member', ${now});"`,
      { stdio: 'pipe' }
    );

    try {
      // Create a fresh login link for the user
      const magicLink = createFreshMagicLink(group1.groupId, group1.ownerEmail, 'login');

      // Login
      await page.goto(magicLink);

      // Should see group picker with both groups
      await expect(page.getByText('Choose a group')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Multi Group Test 1')).toBeVisible();
      await expect(page.getByText('Multi Group Test 2')).toBeVisible();

      // Should NOT show "No groups yet"
      await expect(page.getByText('No groups yet')).not.toBeVisible();

      // Should have sign out option
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

      // Selecting a group should take us to the main app
      await page.getByRole('button', { name: /Multi Group Test 1/i }).click();
      await expectLoggedIn(page);
    } finally {
      cleanupTestGroup(group1.groupId);
      cleanupTestGroup(group2Id);
    }
  });
});
