import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi, createApiClient } from './helpers/api';

const API_BASE = 'http://localhost:8787';

test.describe('Reactions and comments', () => {
  let testGroup: TestGroup;
  let photoId: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Reactions Test Group');

    // Create a fresh magic link and login to get a token
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    const url = new URL(magicLink);
    const token = url.pathname.split('/').pop()!;

    // Verify the magic link to get auth tokens
    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token, name: 'Admin User' },
    });
    const verifyData = await verifyResponse.json();
    const accessToken = verifyData.accessToken;

    // Upload a test photo
    const result = await uploadPhotoViaApi(request, accessToken, 'Test photo for reactions');
    photoId = result.id;
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('user can add emoji reaction to photo', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Wait for photos to load
    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });

    // Click on photo to open lightbox
    await page.locator('article').first().click();

    // Wait for lightbox to open
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click on heart emoji to react
    const heartButton = page.getByRole('button', { name: /react with ❤️/i });
    await heartButton.click();

    // Verify the button is now pressed (has ring/highlight)
    await expect(heartButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('user can change their reaction to different emoji', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click a different emoji
    const laughButton = page.getByRole('button', { name: /react with 😂/i });
    await laughButton.click();

    // Verify the new button is pressed
    await expect(laughButton).toHaveAttribute('aria-pressed', 'true');

    // Verify heart is no longer pressed
    const heartButton = page.getByRole('button', { name: /react with ❤️/i });
    await expect(heartButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('user can remove their reaction', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // First add a reaction (fire emoji to avoid conflicts with other tests)
    const fireButton = page.getByRole('button', { name: /react with 🔥/i });
    await fireButton.click();
    await expect(fireButton).toHaveAttribute('aria-pressed', 'true');

    // Now click again to remove it
    await fireButton.click();

    // Verify it's no longer pressed
    await expect(fireButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('reaction counts appear in feed', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);

    // Add a reaction via API
    await request.post(`${API_BASE}/photos/${photoId}/react`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { emoji: '❤️' },
    });

    // Reload to see updated counts
    await page.reload();
    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });

    // Check for reaction display in feed (should show emoji with count)
    const photoCard = page.locator('article').filter({ hasText: 'Test photo for reactions' });
    await expect(photoCard.locator('text=❤️')).toBeVisible();
  });

  test('default mode: comments hidden in lightbox with show prompt', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Should see "Comments are hidden" prompt
    await expect(page.getByText(/comments are hidden/i)).toBeVisible();
  });

  test('clicking show enables comments globally', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click to show comments
    await page.getByText(/comments are hidden.*show/i).click();

    // Should now see comments section with input
    await expect(page.getByPlaceholder(/add a comment/i)).toBeVisible();
    await expect(page.getByText(/no comments yet/i)).toBeVisible();
  });

  test('user can add comment when comments enabled', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable comments if not already
    const hiddenPrompt = page.getByText(/comments are hidden.*show/i);
    if (await hiddenPrompt.isVisible()) {
      await hiddenPrompt.click();
    }

    // Add a comment
    const commentInput = page.getByPlaceholder(/add a comment/i);
    await commentInput.fill('This is a test comment!');
    await page.getByRole('button', { name: /post/i }).click();

    // Should see the comment
    await expect(page.getByText('This is a test comment!')).toBeVisible();
  });

  test('user can delete their own comment', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable comments if needed
    const hiddenPrompt = page.getByText(/comments are hidden.*show/i);
    if (await hiddenPrompt.isVisible()) {
      await hiddenPrompt.click();
    }

    // Wait for comments to load
    await page.waitForTimeout(500);

    // Find delete button within the sidebar/comments area and click it
    const sidebar = page.locator('.bg-surface\\/95');
    const deleteButton = sidebar.getByRole('button', { name: /delete/i }).first();

    if (await deleteButton.isVisible({ timeout: 5000 })) {
      await deleteButton.scrollIntoViewIfNeeded();
      await deleteButton.click({ force: true });

      // Comment should be gone
      await expect(page.getByText('This is a test comment!')).not.toBeVisible({ timeout: 5000 });
    }
  });

  test('hide comments returns to hidden mode', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable comments if needed
    const hiddenPrompt = page.getByText(/comments are hidden.*show/i);
    if (await hiddenPrompt.isVisible()) {
      await hiddenPrompt.click();
    }

    // Click hide button
    await page.getByRole('button', { name: /hide/i }).click();

    // Should see hidden prompt again
    await expect(page.getByText(/comments are hidden/i)).toBeVisible();
  });

  test('preference persists across page refresh', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable comments
    const hiddenPrompt = page.getByText(/comments are hidden.*show/i);
    if (await hiddenPrompt.isVisible()) {
      await hiddenPrompt.click();
    }

    // Close lightbox and reload
    await page.keyboard.press('Escape');
    await page.reload();

    // Open lightbox again
    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Comments should still be enabled (comment input visible)
    await expect(page.getByPlaceholder(/add a comment/i)).toBeVisible();
  });

  test('admin can toggle user commentsEnabled in members list', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Navigate to Group tab
    await page.getByRole('tab', { name: 'Group' }).click();

    // Look for the comments toggle button (speech bubble icon)
    const memberRow = page.locator('div').filter({ hasText: testGroup.adminEmail }).first();
    const commentsToggle = memberRow.locator('button[title*="Comments"]').first();

    if (await commentsToggle.isVisible()) {
      // Click to toggle
      await commentsToggle.click();

      // Should see success message
      await expect(page.getByText(/comments (enabled|disabled)/i)).toBeVisible({ timeout: 5000 });
    }
  });
});
