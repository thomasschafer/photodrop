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
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Open reaction picker (in the lightbox dialog)
    const addReactionButton = dialog.getByRole('button', { name: 'Add reaction' });
    await addReactionButton.click();

    // Click on heart emoji to react
    const heartOption = dialog.getByRole('option', { name: /react with ❤️/i });
    await heartOption.click();

    // Verify the add reaction button now shows the heart (user's selection)
    await expect(addReactionButton).toContainText('❤️');
  });

  test('user can change their reaction to different emoji', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Open reaction picker and click a different emoji
    const addReactionButton = dialog.getByRole('button', { name: 'Add reaction' });
    await addReactionButton.click();
    const laughOption = dialog.getByRole('option', { name: /react with 😂/i });
    await laughOption.click();

    // Verify the add reaction button now shows the laugh emoji
    await expect(addReactionButton).toContainText('😂');
  });

  test('user can remove their reaction', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const addReactionButton = dialog.getByRole('button', { name: 'Add reaction' });

    // First add a reaction (fire emoji to avoid conflicts with other tests)
    await addReactionButton.click();
    const fireOption = dialog.getByRole('option', { name: /react with 🔥/i });
    await fireOption.click();

    // Verify the add reaction button now shows the fire emoji
    await expect(addReactionButton).toContainText('🔥');

    // Now click fire again to remove it (need to reopen picker)
    await addReactionButton.click();
    await dialog.getByRole('option', { name: /react with 🔥/i }).click();

    // Verify the add reaction button shows "+" again (no reaction)
    await expect(addReactionButton).toContainText('+');
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
    // Look for the reaction count display (contains emoji and count number)
    await expect(photoCard.locator('text=❤️').first()).toBeVisible();
  });

  test('default mode: comments hidden in lightbox with show prompt', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Should see "Comments hidden" prompt
    await expect(page.getByText(/comments hidden/i)).toBeVisible();
  });

  test('clicking show enables comments globally', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click to show comments
    await page.getByRole('button', { name: 'Show', exact: true }).click();

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
    const showButton = page.getByRole('button', { name: 'Show', exact: true });
    if (await showButton.isVisible()) {
      await showButton.click();
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
    const showButton = page.getByRole('button', { name: 'Show', exact: true });
    if (await showButton.isVisible()) {
      await showButton.click();
    }

    // Use a unique comment text to avoid interference from other tests
    const uniqueCommentText = `Delete test comment ${Date.now()}`;

    // Add a comment so we have something to delete
    const commentInput = page.getByPlaceholder(/add a comment/i);
    await expect(commentInput).toBeVisible();
    await commentInput.fill(uniqueCommentText);
    await page.getByRole('button', { name: /post/i }).click();

    // Verify comment appears
    const commentParagraph = page.locator('p.text-text-secondary', { hasText: uniqueCommentText });
    await expect(commentParagraph).toBeVisible({ timeout: 5000 });

    // Find the delete button within the same comment container (parent div of the paragraph)
    const commentContainer = commentParagraph.locator('..');
    const deleteButton = commentContainer.getByRole('button', { name: /delete/i });

    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Wait for confirm modal to appear - find it by the heading text
    const confirmModalHeading = page.getByRole('heading', { name: 'Delete comment' });
    await expect(confirmModalHeading).toBeVisible({ timeout: 5000 });

    // Find the confirm button in the modal
    const confirmModal = page.locator('[role="dialog"][aria-labelledby="confirm-modal-title"]');
    await confirmModal.getByRole('button', { name: 'Delete' }).click();

    // Comment should be gone
    await expect(page.getByText(uniqueCommentText)).not.toBeVisible({ timeout: 5000 });
  });

  test('hide comments returns to hidden mode', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable comments if needed
    const showButton = page.getByRole('button', { name: 'Show', exact: true });
    if (await showButton.isVisible()) {
      await showButton.click();
    }

    // Click hide button
    await page.getByRole('button', { name: /hide/i }).click();

    // Should see hidden prompt again
    await expect(page.getByText(/comments hidden/i)).toBeVisible();
  });

  test('preference persists across page refresh', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Enable comments
    const showButton = page.getByRole('button', { name: 'Show', exact: true });
    if (await showButton.isVisible()) {
      await showButton.click();
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

    // Assert the toggle is visible
    await expect(commentsToggle).toBeVisible({ timeout: 5000 });

    // Click to toggle
    await commentsToggle.click();

    // Should see success message
    await expect(page.getByText(/comments (enabled|disabled)/i)).toBeVisible({ timeout: 5000 });
  });
});
