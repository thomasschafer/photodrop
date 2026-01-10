import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  createFreshMagicLink,
  cleanupTestGroup,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi, createApiClient, makeDirectApiCall } from './helpers/api';

test.describe('Tenant isolation', () => {
  let groupA: TestGroup;
  let groupB: TestGroup;
  let groupAPhotoId: string;
  let groupBPhotoId: string;

  test.beforeAll(async ({ request }) => {
    // Create two separate groups
    groupA = createTestGroup('Group A - Tenant Isolation');
    groupB = createTestGroup('Group B - Tenant Isolation');

    // Consume invite links via API to create users and get tokens
    const groupALoginResponse = await request.post('http://localhost:8787/api/auth/verify-magic-link', {
      data: { token: groupA.magicLink.split('/auth/')[1] },
    });
    const groupAAuth = await groupALoginResponse.json();

    const groupBLoginResponse = await request.post('http://localhost:8787/api/auth/verify-magic-link', {
      data: { token: groupB.magicLink.split('/auth/')[1] },
    });
    const groupBAuth = await groupBLoginResponse.json();

    // Upload photos in each group
    const photoA = await uploadPhotoViaApi(request, groupAAuth.accessToken, 'Group A secret photo');
    groupAPhotoId = photoA.id;

    const photoB = await uploadPhotoViaApi(request, groupBAuth.accessToken, 'Group B secret photo');
    groupBPhotoId = photoB.id;
  });

  test.afterAll(() => {
    cleanupTestGroup(groupA.groupId);
    cleanupTestGroup(groupB.groupId);
  });

  test('Group A admin cannot see Group B photos in UI', async ({ page }) => {
    const magicLink = createFreshMagicLink(groupA.groupId, groupA.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Should see Group A's photo
    await expect(page.getByText('Group A secret photo')).toBeVisible({ timeout: 5000 });

    // Should NOT see Group B's photo
    await expect(page.getByText('Group B secret photo')).not.toBeVisible();
  });

  test('Group B admin cannot see Group A photos in UI', async ({ page }) => {
    const magicLink = createFreshMagicLink(groupB.groupId, groupB.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    // Should see Group B's photo
    await expect(page.getByText('Group B secret photo')).toBeVisible({ timeout: 5000 });

    // Should NOT see Group A's photo
    await expect(page.getByText('Group A secret photo')).not.toBeVisible();
  });

  test('Group A token cannot access Group B photos via API', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(groupA.groupId, groupA.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Try to get Group B's photo - should return 404 (not 403 to avoid leaking existence)
    const response = await makeDirectApiCall(request, 'GET', `/api/photos/${groupBPhotoId}`, token!);
    expect(response.status).toBe(404);
  });

  test('Group B token cannot access Group A photos via API', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(groupB.groupId, groupB.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Try to get Group A's photo - should return 404
    const response = await makeDirectApiCall(request, 'GET', `/api/photos/${groupAPhotoId}`, token!);
    expect(response.status).toBe(404);
  });

  test('Group A token cannot delete Group B photos', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(groupA.groupId, groupA.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Try to delete Group B's photo - should return 404
    const response = await makeDirectApiCall(request, 'DELETE', `/api/photos/${groupBPhotoId}`, token!);
    expect(response.status).toBe(404);
  });

  test('Cross-group user listing returns only own group users', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(groupA.groupId, groupA.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const api = createApiClient(request, token!);
    const response = (await api.getUsers()) as { users: { email: string }[] };

    // Should only see Group A users
    const userEmails = response.users.map((u) => u.email);
    expect(userEmails).toContain(groupA.adminEmail);
    expect(userEmails).not.toContain(groupB.adminEmail);
  });

  test('Photo list only returns photos from own group', async ({ page, request }) => {
    const magicLink = createFreshMagicLink(groupA.groupId, groupA.adminEmail, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    const api = createApiClient(request, token!);
    const { photos } = await api.getPhotos();

    // All photos should belong to Group A (check by caption since we know it)
    const captions = (photos as { caption: string }[]).map((p) => p.caption);
    expect(captions).toContain('Group A secret photo');
    expect(captions).not.toContain('Group B secret photo');
  });

  test('Member in Group A cannot access Group B resources', async ({ page, request }) => {
    // Create a member in Group A
    const member = createTestMember(groupA.groupId, 'Group A Member');

    // Consume the invite link to create the member user (with name)
    await request.post('http://localhost:8787/api/auth/verify-magic-link', {
      data: { token: member.magicLink.split('/auth/')[1], name: member.name },
    });

    // Now login with a fresh login link
    const magicLink = createFreshMagicLink(groupA.groupId, member.email, 'login');
    await loginWithMagicLink(page, magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Try to access Group B photo - should fail
    const response = await makeDirectApiCall(request, 'GET', `/api/photos/${groupBPhotoId}`, token!);
    expect(response.status).toBe(404);
  });
});
