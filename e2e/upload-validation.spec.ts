import { API_BASE } from './helpers/ports';
import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

test.describe('Upload file validation', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    // "Upload" must not appear in the group name — it would collide with the
    // Upload button locator via the group switcher and user menu labels.
    testGroup = createTestGroup('File Check Group');

    // Seed one photo so the feed renders its header Upload button (an empty
    // feed shows the upload card inline instead of the modal under test).
    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();
    await uploadPhotoViaApi(request, accessToken, 'Seed photo');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('rejects a non-image file with an image extension at selection time', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink, testGroup.ownerName);

    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // A text file wearing a .png extension: passes any extension/MIME check,
    // fails any attempt to decode it as an image.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'not-really-a-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not an image at all'),
    });

    // The failure must be explained at selection time, before any Upload
    // attempt — not with a broken preview and a generic "Upload failed".
    await expect(dialog.getByRole('alert')).toContainText(/valid image/i);

    // No broken preview image and no armed Upload button for a file that can
    // never succeed.
    await expect(dialog.locator('img')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Upload' })).toHaveCount(0);

    // The picker is still there so the user can try another file.
    await expect(dialog.locator('input[type="file"]')).toBeVisible();
  });
});
