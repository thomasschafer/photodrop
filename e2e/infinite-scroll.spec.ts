import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

test.describe('Infinite scroll pagination', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Infinite Scroll Test Group');

    // Login to get token for uploading
    const verifyResponse = await request.post('http://localhost:8787/auth/verify-magic-link', {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();

    // Upload 25 photos (more than the default page size of 20)
    for (let i = 1; i <= 25; i++) {
      await uploadPhotoViaApi(request, accessToken, `Photo ${i}`);
    }
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('loads more photos when scrolling to bottom', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Wait for initial photos to load
    await expect(page.locator('article').first()).toBeVisible({ timeout: 10000 });

    // Initially should have at most 20 photos (the default page size)
    const initialCount = await page.locator('article').count();
    expect(initialCount).toBeLessThanOrEqual(20);

    // Scroll to bottom to trigger infinite scroll
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for more photos to load
    await page.waitForFunction(
      (prevCount) => document.querySelectorAll('article').length > prevCount,
      initialCount,
      { timeout: 10000 }
    );

    // Should now have more than initial count
    const newCount = await page.locator('article').count();
    expect(newCount).toBeGreaterThan(initialCount);

    // Should have all 25 photos
    expect(newCount).toBe(25);
  });

  test('photos loaded via infinite scroll are clickable', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Wait for initial photos to load
    await expect(page.locator('article').first()).toBeVisible({ timeout: 10000 });

    // Scroll to bottom to load all photos
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(
      () => document.querySelectorAll('article').length >= 25,
      undefined,
      { timeout: 10000 }
    );

    // Click on the last article (a photo that was loaded via infinite scroll)
    const lastPhoto = page.locator('article').last();
    await lastPhoto.click();

    // Verify lightbox opens - this confirms photos loaded via infinite scroll are functional
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
