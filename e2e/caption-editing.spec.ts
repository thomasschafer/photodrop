import { API_BASE } from './helpers/ports';
import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

test.describe('Caption editing', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Caption Crew');
    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();
    await uploadPhotoViaApi(request, accessToken, 'Original caption');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('an admin edits a caption in place and it shows an edited marker', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    await expect(page.getByText('Original caption')).toBeVisible();

    await page.getByRole('button', { name: 'Edit caption' }).click();
    const input = page.getByLabel('Edit caption');
    await input.fill('Corrected caption');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Corrected caption')).toBeVisible();
    await expect(page.getByText('(edited)')).toBeVisible();
    await expect(page.getByText('Original caption')).toHaveCount(0);

    // The edit survives a reload — it was persisted, not just local state.
    await page.reload();
    await expect(page.getByText('Corrected caption')).toBeVisible();
    await expect(page.getByText('(edited)')).toBeVisible();
  });

  test('an admin can also edit the caption from inside the lightbox', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await page.locator('article img').first().click();
    const lightbox = page.getByRole('dialog', { name: /^Photo 1 of/ });
    await expect(lightbox).toBeVisible();

    await lightbox.getByRole('button', { name: 'Edit caption' }).click();
    await lightbox.getByLabel('Edit caption').fill('Edited in the lightbox');
    await lightbox.getByRole('button', { name: 'Save' }).click();

    await expect(lightbox.getByText('Edited in the lightbox')).toBeVisible();

    // Closing back to the feed shows the same value — the feed row was
    // updated through onPhotoUpdate, not left stale.
    await page.keyboard.press('Escape');
    await expect(
      page.getByLabel('Photo feed').getByText('Edited in the lightbox')
    ).toBeVisible();
  });
});
