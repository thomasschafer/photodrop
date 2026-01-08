import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { createTestGroup, createFreshMagicLink, cleanupTestGroup, TestGroup } from './helpers/setup';
import { loginWithMagicLink, expectLoggedIn, expectLoggedOut } from './helpers/auth';

test.describe('Auth edge cases', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Auth Edge Case Group');

    // Consume the admin invite link via API to create the user
    const inviteToken = testGroup.magicLink.split('/auth/')[1];
    await request.post('http://localhost:8787/api/auth/verify-magic-link', {
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

    // Click sign out
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Should be on landing page
    await expectLoggedOut(page);

    // Refresh should still be logged out
    await page.reload();
    await expectLoggedOut(page);
  });

  test('API request with invalid token returns 401', async ({ request }) => {
    const response = await request.get('http://localhost:8787/api/photos', {
      headers: {
        Authorization: 'Bearer invalid-token-here',
      },
    });

    expect(response.status()).toBe(401);
  });

  test('API request without token returns 401', async ({ request }) => {
    const response = await request.get('http://localhost:8787/api/photos');

    expect(response.status()).toBe(401);
  });
});
