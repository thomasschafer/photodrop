import { API_BASE } from './helpers/ports';
import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

// 1x1 opaque PNG — small, but decodes as a real image everywhere.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Multi-photo upload', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Batch Group');

    // Seed one photo so the feed renders its header Upload button (an empty
    // feed shows the uploader inline instead of the modal).
    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();
    await uploadPhotoViaApi(request, accessToken, 'Seed photo');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('uploads several photos in one batch with per-photo captions', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type="file"]').setInputFiles([
      { name: 'beach.png', mimeType: 'image/png', buffer: TINY_PNG },
      { name: 'sunset.png', mimeType: 'image/png', buffer: TINY_PNG },
    ]);

    await dialog.getByLabel('Caption for beach.png').fill('At the beach');
    await dialog.getByLabel('Caption for sunset.png').fill('Sunset after');

    await dialog.getByRole('button', { name: 'Upload 2 photos' }).click();

    // Modal closes, batch banner shows, and both photos land in the feed
    // with their own captions.
    await expect(page.getByText('2 photos uploaded')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('At the beach')).toBeVisible();
    await expect(page.getByText('Sunset after')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(3);
  });
});
