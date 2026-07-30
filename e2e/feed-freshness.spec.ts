import { API_BASE } from './helpers/ports';
import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

test.describe('Feed freshness', () => {
  let testGroup: TestGroup;
  let accessToken: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Freshness Group');

    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    ({ accessToken } = await verifyResponse.json());
    await uploadPhotoViaApi(request, accessToken, 'First photo');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('a photo uploaded elsewhere appears after a focus freshness check', async ({
    page,
    request,
  }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    await expect(page.locator('article')).toHaveCount(1);

    // Another session uploads while this feed sits open.
    await uploadPhotoViaApi(request, accessToken, 'Second photo');

    // Returning focus to the tab triggers a freshness check; at the top of
    // the feed the new photo slides straight in.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page.locator('article')).toHaveCount(2);
    await expect(page.locator('article').first()).toContainText('Second photo');
  });

  test('reaction counts on visible photos update after a freshness check', async ({
    page,
    request,
  }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    await expect(page.locator('article').first()).toBeVisible();

    const { photos } = await request
      .get(`${API_BASE}/photos?limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      .then((r) => r.json());
    await request.post(`${API_BASE}/photos/${photos[0].id}/react`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      data: { emoji: '🔥' },
    });

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(
      page.locator('article').first().getByRole('button', { name: /🔥 reaction/ })
    ).toContainText('1');
  });
});
