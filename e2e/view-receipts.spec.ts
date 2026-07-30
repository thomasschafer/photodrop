import { API_BASE } from './helpers/ports';
import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  cleanupTestGroup,
  createFreshMagicLink,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

test.describe('View receipts', () => {
  let testGroup: TestGroup;
  let memberEmail: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Receipts Group');

    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();
    await uploadPhotoViaApi(request, accessToken, 'Receipt photo');

    const invite = createTestMember(testGroup.groupId, 'Viewing Member');
    const memberVerify = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: invite.magicLink.split('/auth/')[1], name: 'Viewing Member' },
    });
    memberEmail = invite.email;
    void (await memberVerify.json());
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('a member opening a photo appears in the admin "Seen by" list', async ({ page }) => {
    // The member opens the photo — this records their view. Members see no
    // "Seen by" control themselves.
    const memberLink = createFreshMagicLink(testGroup.groupId, memberEmail);
    await loginWithMagicLink(page, memberLink);
    await page.locator('article img').first().click();
    await expect(page.getByRole('dialog', { name: /Photo 1 of/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Seen by' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The owner opens the same photo and checks receipts.
    const ownerLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, ownerLink);
    await page.locator('article img').first().click();

    const seenBy = page.getByRole('button', { name: 'Seen by' });
    await expect(seenBy).toBeVisible();
    await seenBy.click();

    const panel = page.getByRole('dialog', { name: 'Seen by' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Viewing Member')).toBeVisible();
  });
});
