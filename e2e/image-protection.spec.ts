import { API_BASE } from './helpers/ports';
import { test, expect, type Locator } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  createFreshMagicLink,
  cleanupTestGroup,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink, getAuthToken, getUserIdFromToken } from './helpers/auth';
import { uploadPhotoViaApi, makeDirectApiCall } from './helpers/api';

/**
 * WebKit does not implement the unprefixed `user-select`, so there the computed
 * style carries the effective value only under the `-webkit-` prefix. Reading
 * both keeps these assertions about what the browser actually renders rather
 * than about one engine's property naming.
 */
async function effectiveUserSelect(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.getPropertyValue('user-select') || style.getPropertyValue('-webkit-user-select');
  });
}

test.describe('Image protection', () => {
  let testGroup: TestGroup;
  let memberEmail: string;
  let memberId: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Image Protection Test Group');

    // Create a member
    const member = createTestMember(testGroup.groupId, 'Protected Member');
    memberEmail = member.email;

    // Consume the member's invite link to create the user
    const memberInviteToken = member.magicLink.split('/auth/')[1];
    const memberResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: memberInviteToken, name: member.name },
    });
    const memberAuth = await memberResponse.json();
    memberId = (memberAuth as { user: { id: string } }).user.id;

    // Upload a photo as admin
    const adminLoginToken = testGroup.magicLink.split('/auth/')[1];
    const adminLoginResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: adminLoginToken },
    });
    const adminAuth = await adminLoginResponse.json();
    await uploadPhotoViaApi(
      request,
      (adminAuth as { accessToken: string }).accessToken,
      'Protected photo'
    );
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('new members have image protection enabled by default', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Wait for photo to load
    await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });

    // Images should have oncontextmenu protection (rendered by ProtectedImage)
    const img = page.locator('article img').first();
    await expect(img).toBeVisible();

    // The image should have inline styles for protection
    const userSelect = await effectiveUserSelect(img);
    expect(userSelect).toBe('none');
  });

  test('admin can toggle image protection via API', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Disable image protection for member
    const disableResult = await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${memberId}/image-protection`,
      token!,
      { enabled: false }
    );
    expect(disableResult.status).toBe(200);

    // Re-enable image protection for member
    const enableResult = await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${memberId}/image-protection`,
      token!,
      { enabled: true }
    );
    expect(enableResult.status).toBe(200);
  });

  test('non-admin cannot toggle image protection via API', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Member trying to change their own protection should fail
    const result = await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${memberId}/image-protection`,
      token!,
      { enabled: false }
    );
    expect(result.status).toBe(403);
  });

  test('disabling own image protection removes CSS protection from images', async ({
    page,
    request,
  }) => {
    // Login as admin (who has protection enabled by default)
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Wait for photo to load
    await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });

    // Verify images ARE protected initially
    const img = page.locator('article img').first();
    await expect(img).toBeVisible();
    let userSelect = await effectiveUserSelect(img);
    expect(userSelect).toBe('none');

    // Disable image protection for admin (self) via API
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();
    const adminId = await getUserIdFromToken(page);
    expect(adminId).toBeTruthy();

    const disableResult = await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${adminId}/image-protection`,
      token!,
      { enabled: false }
    );
    expect(disableResult.status).toBe(200);

    try {
      // Refresh the page to pick up the new protection state via auth
      await page.reload();
      await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });

      // Verify images are NO LONGER protected
      const imgAfter = page.locator('article img').first();
      await expect(imgAfter).toBeVisible();
      userSelect = await effectiveUserSelect(imgAfter);
      expect(userSelect).not.toBe('none');
    } finally {
      // Restore protection state for subsequent tests
      await makeDirectApiCall(
        request,
        'PATCH',
        `/groups/${testGroup.groupId}/members/${adminId}/image-protection`,
        token!,
        { enabled: true }
      );
    }
  });

  test('admin can see and toggle image protection in members list', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Navigate to Group tab (contains members list, admin only)
    await page.getByRole('tab', { name: 'Group' }).click();

    // Wait for members to load
    await expect(page.getByText('Protected Member')).toBeVisible({ timeout: 5000 });

    // Find the image protection toggle button for the member
    const protectionButton = page.getByRole('button', {
      name: /image protection for Protected Member/i,
    });
    await expect(protectionButton).toBeVisible();

    // Click to toggle (disable protection)
    await protectionButton.click();

    // Should show success message
    await expect(page.getByText(/image protection disabled/i)).toBeVisible({ timeout: 5000 });
  });

  test('toggling own protection via UI updates images live without reload', async ({
    page,
    request,
  }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Ensure admin's own protection is enabled first
    const token = await getAuthToken(page);
    const adminId = await getUserIdFromToken(page);
    expect(token).toBeTruthy();
    expect(adminId).toBeTruthy();
    await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${adminId}/image-protection`,
      token!,
      { enabled: true }
    );
    await page.reload();

    // Wait for photo and verify protection is on
    await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });
    const img = page.locator('article img').first();
    await expect(img).toBeVisible();
    expect(await effectiveUserSelect(img)).toBe('none');

    // Navigate to Group tab and toggle own protection off via UI
    await page.getByRole('tab', { name: 'Group' }).click();
    const adminButton = page.getByRole('button', {
      name: /image protection for.*Owner/i,
    });
    await expect(adminButton).toBeVisible({ timeout: 5000 });
    await adminButton.click();
    await expect(page.getByText(/image protection disabled/i)).toBeVisible({ timeout: 5000 });

    // Navigate back to Photos — images should be unprotected without reload
    await page.getByRole('tab', { name: 'Photos' }).click();
    await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });
    const imgAfter = page.locator('article img').first();
    await expect(imgAfter).toBeVisible();
    expect(await effectiveUserSelect(imgAfter)).not.toBe('none');

    // Re-enable via UI and verify protection is restored
    await page.getByRole('tab', { name: 'Group' }).click();
    const enableButton = page.getByRole('button', {
      name: /image protection for.*Owner/i,
    });
    await expect(enableButton).toBeVisible({ timeout: 5000 });
    await enableButton.click();
    await expect(page.getByText(/image protection enabled/i)).toBeVisible({ timeout: 5000 });

    await page.getByRole('tab', { name: 'Photos' }).click();
    await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });
    const imgRestored = page.locator('article img').first();
    await expect(imgRestored).toBeVisible();
    expect(await effectiveUserSelect(imgRestored)).toBe('none');
  });

  test('lightbox images respect protection toggle', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Ensure protection is on
    const token = await getAuthToken(page);
    const adminId = await getUserIdFromToken(page);
    expect(token).toBeTruthy();
    expect(adminId).toBeTruthy();
    await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${adminId}/image-protection`,
      token!,
      { enabled: true }
    );
    await page.reload();

    // Wait for photo and open lightbox
    await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });
    await page.locator('article').first().click();

    // Lightbox should open — check protection on lightbox images
    const lightboxImg = page.locator('[role="dialog"] img').first();
    await expect(lightboxImg).toBeVisible({ timeout: 5000 });
    expect(await effectiveUserSelect(lightboxImg)).toBe('none');

    // Close lightbox, disable protection, reopen
    await page.getByRole('button', { name: 'Close' }).click();

    await makeDirectApiCall(
      request,
      'PATCH',
      `/groups/${testGroup.groupId}/members/${adminId}/image-protection`,
      token!,
      { enabled: false }
    );

    try {
      await page.reload();
      await expect(page.getByText('Protected photo')).toBeVisible({ timeout: 5000 });
      await page.locator('article').first().click();

      const lightboxImgAfter = page.locator('[role="dialog"] img').first();
      await expect(lightboxImgAfter).toBeVisible({ timeout: 5000 });
      expect(await effectiveUserSelect(lightboxImgAfter)).not.toBe(
        'none'
      );
    } finally {
      // Restore
      await makeDirectApiCall(
        request,
        'PATCH',
        `/groups/${testGroup.groupId}/members/${adminId}/image-protection`,
        token!,
        { enabled: true }
      );
    }
  });
});
