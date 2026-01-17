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

    // Verify a reaction pill appears with the heart emoji (user's selection is highlighted)
    const heartReactionPill = dialog.getByRole('button', { name: /remove ❤️ reaction/i });
    await expect(heartReactionPill).toBeVisible();
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

    // Verify a reaction pill appears with the laugh emoji (user's selection is highlighted)
    const laughReactionPill = dialog.getByRole('button', { name: /remove 😂 reaction/i });
    await expect(laughReactionPill).toBeVisible();
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

    // Verify a reaction pill appears with the fire emoji
    const fireReactionPill = dialog.getByRole('button', { name: /remove 🔥 reaction/i });
    await expect(fireReactionPill).toBeVisible();

    // Click the fire pill directly to remove the reaction (new UI allows clicking pills)
    await fireReactionPill.click();

    // Verify the fire reaction pill is no longer visible (reaction removed)
    await expect(fireReactionPill).not.toBeVisible();
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

  test('comments start collapsed in lightbox with expand button visible', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Expand button should be visible (comments collapsed by default)
    const expandButton = dialog.getByRole('button', { name: /expand comments/i });
    await expect(expandButton).toBeVisible();

    // Comment input should NOT be visible when collapsed
    await expect(dialog.getByPlaceholder(/add a comment/i)).not.toBeVisible();
  });

  test('clicking expand shows comments section', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Click to expand comments
    const expandButton = dialog.getByRole('button', { name: /expand comments/i });
    await expandButton.click();

    // Should now see comments section with input
    await expect(dialog.getByPlaceholder(/add a comment/i)).toBeVisible();
  });

  test('user can add comment', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Expand comments
    const expandButton = dialog.getByRole('button', { name: /expand comments/i });
    await expandButton.click();

    // Add a comment
    const commentInput = dialog.getByPlaceholder(/add a comment/i);
    await commentInput.fill('This is a test comment!');
    await dialog.getByRole('button', { name: /post/i }).click();

    // Should see the comment
    await expect(dialog.getByText('This is a test comment!')).toBeVisible();
  });

  test('user can delete their own comment', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Expand comments
    const expandButton = dialog.getByRole('button', { name: /expand comments/i });
    await expandButton.click();

    // Use a unique comment text to avoid interference from other tests
    const uniqueCommentText = `Delete test comment ${Date.now()}`;

    // Add a comment so we have something to delete
    const commentInput = dialog.getByPlaceholder(/add a comment/i);
    await expect(commentInput).toBeVisible();
    await commentInput.fill(uniqueCommentText);
    await dialog.getByRole('button', { name: /post/i }).click();

    // Verify comment appears
    const commentParagraph = dialog.locator('p.text-text-secondary', { hasText: uniqueCommentText });
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
    await expect(dialog.getByText(uniqueCommentText)).not.toBeVisible({ timeout: 5000 });
  });

  test('collapse button returns to collapsed mode', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Expand comments
    const expandButton = dialog.getByRole('button', { name: /expand comments/i });
    await expandButton.click();

    // Verify expanded
    await expect(dialog.getByPlaceholder(/add a comment/i)).toBeVisible();

    // Click collapse button
    const collapseButton = dialog.getByRole('button', { name: /collapse comments/i });
    await collapseButton.click();

    // Comment input should be hidden again
    await expect(dialog.getByPlaceholder(/add a comment/i)).not.toBeVisible();
  });

  test('expanded state resets when lightbox closes', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Expand comments
    const expandButton = dialog.getByRole('button', { name: /expand comments/i });
    await expandButton.click();
    await expect(dialog.getByPlaceholder(/add a comment/i)).toBeVisible();

    // Close lightbox
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reopen lightbox
    await page.locator('article').first().click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Comments should be collapsed again (expand button visible, input not visible)
    await expect(dialog.getByRole('button', { name: /expand comments/i })).toBeVisible();
    await expect(dialog.getByPlaceholder(/add a comment/i)).not.toBeVisible();
  });

  test('reaction tooltip shows names on hover in feed', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);

    // Add a reaction via API so there's something to hover over
    await request.post(`${API_BASE}/photos/${photoId}/react`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { emoji: '❤️' },
    });

    await page.reload();
    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });

    // Find and hover over the reaction pill in the feed (not lightbox)
    const photoCard = page.locator('article').filter({ hasText: 'Test photo for reactions' });
    const heartPill = photoCard.getByRole('button', { name: /❤️ reaction/i });
    await expect(heartPill).toBeVisible();
    await heartPill.hover();

    // Wait for tooltip to appear
    await page.waitForTimeout(300);

    // The tooltip should show "You"
    const tooltip = photoCard.locator('.absolute.whitespace-nowrap');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('You');
  });

  test('reaction tooltip shows names on hover in lightbox', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);

    // Add a reaction via API so there's something to hover over
    await request.post(`${API_BASE}/photos/${photoId}/react`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { emoji: '❤️' },
    });

    await page.reload();
    await expect(page.getByText('Test photo for reactions')).toBeVisible({ timeout: 10000 });
    await page.locator('article').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Find and hover over the reaction pill
    const heartPill = dialog.getByRole('button', { name: /❤️ reaction/i });
    await expect(heartPill).toBeVisible();
    await heartPill.hover();

    // Wait for tooltip to appear
    await page.waitForTimeout(300);

    // The tooltip should show "You"
    const tooltip = dialog.locator('.absolute.whitespace-nowrap');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('You');
  });
});
