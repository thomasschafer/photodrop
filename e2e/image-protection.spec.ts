import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  createFreshMagicLink,
  cleanupTestGroup,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi, makeDirectApiCall } from './helpers/api';

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
    const memberResponse = await request.post('http://localhost:8787/auth/verify-magic-link', {
      data: { token: memberInviteToken, name: member.name },
    });
    const memberAuth = await memberResponse.json();
    memberId = (memberAuth as { user: { id: string } }).user.id;

    // Upload a photo as admin
    const adminLoginToken = testGroup.magicLink.split('/auth/')[1];
    const adminLoginResponse = await request.post('http://localhost:8787/auth/verify-magic-link', {
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
    const userSelect = await img.evaluate((el) => getComputedStyle(el).userSelect);
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
});
