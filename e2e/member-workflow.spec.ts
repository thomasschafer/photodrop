import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  createFreshMagicLink,
  cleanupTestGroup,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi, createApiClient } from './helpers/api';

test.describe('Member workflow', () => {
  let testGroup: TestGroup;
  let memberEmail: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Member Test Group');

    // Create a member (this consumes the invite link and creates the user)
    const member = createTestMember(testGroup.groupId, 'Test Member');
    memberEmail = member.email;

    // Consume the member's invite link via API to create the user
    const memberInviteToken = member.magicLink.split('/auth/')[1];
    await request.post('http://localhost:8787/api/auth/verify-magic-link', {
      data: { token: memberInviteToken },
    });

    // Get admin token via API (consume the admin invite link)
    const adminInviteToken = testGroup.magicLink.split('/auth/')[1];
    const adminLoginResponse = await request.post('http://localhost:8787/api/auth/verify-magic-link', {
      data: { token: adminInviteToken },
    });
    const adminAuth = await adminLoginResponse.json();

    // Upload a photo as admin for the member to view
    await uploadPhotoViaApi(request, adminAuth.accessToken, 'Photo for member to see');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('member can login via magic link', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Verify we're on the main app (Sign out button is visible for all users)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('member can view all group photos', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Verify photos are visible
    await expect(page.getByText('Photo for member to see')).toBeVisible({ timeout: 5000 });
  });

  test('member cannot see upload tab', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Verify upload tab is not present
    await expect(page.getByRole('button', { name: /upload/i })).not.toBeVisible();
  });

  test('member cannot delete photos', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Wait for photos to load
    await expect(page.locator('article').first()).toBeVisible({ timeout: 5000 });

    // Verify no delete button is visible
    await expect(page.getByRole('button', { name: /delete/i })).not.toBeVisible();
  });

  test('member cannot upload photos via API', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Try to upload via API - should fail with 403
    try {
      await uploadPhotoViaApi(request, token!, 'Should fail');
      // If we get here, the test should fail
      expect(true).toBe(false);
    } catch (error) {
      // Expected - member cannot upload
      expect(String(error)).toContain('403');
    }
  });

  test('member cannot delete photos via API', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, memberEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Get photo list
    const api = createApiClient(request, token!);
    const { photos } = await api.getPhotos();
    expect(photos.length).toBeGreaterThan(0);

    // Try to delete via API - should fail with 403
    const photoId = (photos[0] as { id: string }).id;
    const deleteResponse = await api.deletePhoto(photoId);
    expect(deleteResponse.status()).toBe(403);
  });
});
