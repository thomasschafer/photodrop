import { execSync } from 'child_process';
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

test.describe('Downloads and export', () => {
  let testGroup: TestGroup;
  let freeEmail: string;
  let protectedEmail: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Keepsakes');

    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();
    await uploadPhotoViaApi(request, accessToken, 'Keeper photo');

    const freeInvite = createTestMember(testGroup.groupId, 'Free Member');
    const freeVerify = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: freeInvite.magicLink.split('/auth/')[1], name: 'Free Member' },
    });
    const { user: freeUser } = await freeVerify.json();
    freeEmail = freeInvite.email;
    // Admin has switched image protection off for this member.
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "UPDATE memberships SET image_protection = 0 WHERE user_id = '${freeUser.id}' AND group_id = '${testGroup.groupId}';"`,
      { stdio: 'pipe' }
    );

    const protectedInvite = createTestMember(testGroup.groupId, 'Protected Member');
    await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: protectedInvite.magicLink.split('/auth/')[1], name: 'Protected Member' },
    });
    protectedEmail = protectedInvite.email;
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('an unprotected member gets a real download button in the lightbox', async ({ page }) => {
    const link = createFreshMagicLink(testGroup.groupId, freeEmail);
    await loginWithMagicLink(page, link);

    await page.locator('article img').first().click();
    const downloadButton = page.getByRole('button', { name: 'Download photo' });
    await expect(downloadButton).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^photodrop-.+\.(jpg|png|webp)$/);
  });

  test('a protected member sees no download button', async ({ page }) => {
    const link = createFreshMagicLink(testGroup.groupId, protectedEmail);
    await loginWithMagicLink(page, link);

    await page.locator('article img').first().click();
    await expect(page.getByRole('dialog', { name: /Photo 1 of/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download photo' })).toHaveCount(0);
  });

  test('the owner can export every photo as a zip', async ({ page }) => {
    const link = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, link);

    await page.getByRole('tab', { name: 'Group' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export photos' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Keepsakes photos.zip');
    await expect(page.getByText('Export ready — check your downloads')).toBeVisible();
  });
});
