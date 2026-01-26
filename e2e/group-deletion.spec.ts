import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  cleanupTestGroup,
  createFreshMagicLink,
  createTestAdmin,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink, getAuthToken } from './helpers/auth';
import { uploadPhotoViaApi, createApiClient } from './helpers/api';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

test.describe('Group deletion', () => {
  let testGroup: TestGroup;

  test.beforeAll(() => {
    testGroup = createTestGroup('Delete Test Group');
  });

  test.afterAll(() => {
    // Cleanup only if group still exists (won't exist if deletion test passed)
    try {
      cleanupTestGroup(testGroup.groupId);
    } catch {
      // Group was already deleted by the test
    }
  });

  test('only owner sees delete group button', async ({ page }) => {
    // Login as owner
    await loginWithMagicLink(page, testGroup.magicLink);

    // Navigate to group page (contains members list)
    await page.getByRole('tab', { name: /group/i }).click();

    // Owner should see the danger zone with delete button
    await expect(page.getByText('Danger zone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete group' })).toBeVisible();
  });

  test('non-owner admin does not see delete group button', async ({ page }) => {
    // Create a non-owner admin
    const admin = createTestAdmin(testGroup.groupId, 'Test Admin');

    // Login as the non-owner admin
    await loginWithMagicLink(page, admin.magicLink, admin.name);

    // Navigate to group page
    await page.getByRole('tab', { name: /group/i }).click();

    // Non-owner admin should NOT see the danger zone
    await expect(page.getByText('Danger zone')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete group' })).not.toBeVisible();
  });

  test('delete button is disabled until "delete" is typed', async ({ page }) => {
    // Login as owner
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.ownerEmail);
    await loginWithMagicLink(page, magicLink);

    // Navigate to group page
    await page.getByRole('tab', { name: /group/i }).click();

    // Click delete group button
    await page.getByRole('button', { name: 'Delete group' }).click();

    // Modal should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Confirm button should be disabled initially
    const confirmButton = dialog.getByRole('button', { name: 'Delete group' });
    await expect(confirmButton).toBeDisabled();

    // Type something other than "delete"
    await dialog.getByPlaceholder('Type "delete" to confirm').fill('wrong');
    await expect(confirmButton).toBeDisabled();

    // Type "delete" (case insensitive)
    await dialog.getByPlaceholder('Type "delete" to confirm').fill('DELETE');
    await expect(confirmButton).toBeEnabled();

    // Cancel to avoid actually deleting
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('owner can delete group and sees empty state when no other groups', async ({ page, request }) => {
    // Create a fresh group specifically for this deletion test
    const deleteTestGroup = createTestGroup('To Be Deleted Group');

    // Login as owner and upload a photo first
    await loginWithMagicLink(page, deleteTestGroup.magicLink);

    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Upload a photo via API
    const photoResult = await uploadPhotoViaApi(request, token!, 'Photo to be deleted');
    expect(photoResult.id).toBeTruthy();

    // Verify photo exists
    await page.reload();
    await expect(page.getByText('Photo to be deleted')).toBeVisible({ timeout: 5000 });

    // Navigate to group page
    await page.getByRole('tab', { name: /group/i }).click();

    // Click delete group button
    await page.getByRole('button', { name: 'Delete group' }).click();

    // Modal should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Type "delete" and confirm
    await dialog.getByPlaceholder('Type "delete" to confirm').fill('delete');
    await dialog.getByRole('button', { name: 'Delete group' }).click();

    // User has no other groups, should see "No groups yet" page (still logged in)
    await expect(page.getByText('No groups yet')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // Verify the group no longer exists via API
    const api = createApiClient(request, token!);
    try {
      await api.getPhotos();
      expect(true).toBe(false); // Force failure - should not succeed
    } catch {
      // Expected: API call should fail since group is deleted
    }
  });

  test('owner sees group picker after deleting when they have other groups', async ({ page }) => {
    // Create first group (will be deleted)
    const groupToDelete = createTestGroup('Group To Delete');

    // Create second group and add the same user to it
    const secondGroupId = randomBytes(16).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    // Create second group with a different owner first, then add our user
    const secondOwnerId = randomBytes(16).toString('hex');
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO users (id, name, email, profile_color, created_at) VALUES ('${secondOwnerId}', 'Second Owner', 'second-owner-${secondGroupId.slice(0, 8)}@test.local', 'terracotta', ${now});"`,
      { stdio: 'pipe' }
    );
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO groups (id, name, owner_id, created_at) VALUES ('${secondGroupId}', 'Second Group', '${secondOwnerId}', ${now});"`,
      { stdio: 'pipe' }
    );
    // Add our test user to the second group as a member
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO memberships (user_id, group_id, role, joined_at) VALUES ('${groupToDelete.ownerId}', '${secondGroupId}', 'member', ${now});"`,
      { stdio: 'pipe' }
    );

    try {
      // Login as owner of first group
      await loginWithMagicLink(page, groupToDelete.magicLink);

      // User belongs to multiple groups, so they see the group picker
      // Select the group to delete
      await page.getByRole('button', { name: /Group To Delete/i }).click();

      // Navigate to group page
      await page.getByRole('tab', { name: /group/i }).click();

      // Click delete group button
      await page.getByRole('button', { name: 'Delete group' }).click();

      // Modal should appear
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Type "delete" and confirm
      await dialog.getByPlaceholder('Type "delete" to confirm').fill('delete');
      await dialog.getByRole('button', { name: 'Delete group' }).click();

      // User has another group, should see group picker
      await expect(page.getByText('Choose a group')).toBeVisible({ timeout: 10000 });

      // The second group should be visible
      await expect(page.getByText('Second Group')).toBeVisible();

      // The deleted group should NOT be visible
      await expect(page.getByText('Group To Delete')).not.toBeVisible();
    } finally {
      // Cleanup second group
      cleanupTestGroup(secondGroupId);
    }
  });
});
