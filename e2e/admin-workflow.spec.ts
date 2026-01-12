import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi, createApiClient } from './helpers/api';

test.describe('Admin workflow', () => {
  let testGroup: TestGroup;

  test.beforeAll(() => {
    testGroup = createTestGroup('Admin Test Group');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('admin can login via magic link', async ({ page }) => {
    // Create a fresh magic link to avoid issues with stale tokens from previous runs
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Verify we're on the main app
    await expect(page.getByRole('tab', { name: 'Photos' })).toBeVisible();

    // Verify admin sees the Upload button
    await expect(page.getByRole('button', { name: /upload/i })).toBeVisible();
  });

  test('admin can upload a photo with caption', async ({ page, request }) => {
    // First test already created the user, so use a login token
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Upload via API (UI upload requires actual file selection which is complex)
    const result = await uploadPhotoViaApi(request, token!, 'Test photo caption');
    expect(result.id).toBeTruthy();

    // Refresh and verify photo appears in feed
    await page.reload();
    await expect(page.getByText('Test photo caption')).toBeVisible({ timeout: 5000 });
  });

  test('admin can view uploaded photos', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    const api = createApiClient(request, token!);

    // Get photos via API
    const { photos } = await api.getPhotos();
    expect(photos.length).toBeGreaterThan(0);

    // Verify photos are visible in UI
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('admin can delete a photo', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Upload a photo to delete
    const result = await uploadPhotoViaApi(request, token!, 'Unique delete test photo');
    expect(result.id).toBeTruthy();

    // Refresh to see the photo
    await page.reload();
    await expect(page.getByText('Unique delete test photo')).toBeVisible({ timeout: 5000 });

    // Find the specific article with our photo and click its delete button
    const photoCard = page.locator('article').filter({ hasText: 'Unique delete test photo' });
    const deleteButton = photoCard.getByRole('button', { name: /delete/i });

    // Use force click to avoid event propagation issues
    await deleteButton.click({ force: true });

    // Confirm deletion in the modal
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // Wait for photo to be removed from DOM
    await expect(page.getByText('Unique delete test photo')).not.toBeVisible({ timeout: 10000 });
  });

  test('admin can invite a member via UI', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Navigate to Group tab
    await page.getByRole('tab', { name: 'Group' }).click();

    // Click the Invite button to open the modal
    await page.getByRole('button', { name: 'Invite' }).click();

    // Fill in invite form (only email and role, no name field)
    await page.getByLabel(/email/i).fill('newmember@test.local');

    // Submit the form
    await page.getByRole('button', { name: /send invite/i }).click();

    // Verify success message (magic link logged to console in dev)
    await expect(page.getByText(/invite sent/i)).toBeVisible({ timeout: 5000 });
  });
});
