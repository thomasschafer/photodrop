import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  cleanupTestGroup,
  createTestMember,
  createFreshMagicLink,
  TestGroup,
} from './helpers/setup';
import {
  loginWithMagicLink,
  loginWithMagicLinkExpectPicker,
  loginWithMagicLinkExpectEmpty,
  getAuthToken,
} from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

function addUserToGroup(
  userId: string,
  groupId: string,
  role: 'admin' | 'member'
): void {
  const now = Math.floor(Date.now() / 1000);
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO memberships (user_id, group_id, role, joined_at) VALUES ('${userId}', '${groupId}', '${role}', ${now});"`,
    { stdio: 'pipe' }
  );
}

function getUserIdByEmail(email: string): string | null {
  try {
    const result = execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --json --command "SELECT id FROM users WHERE email = '${email}';"`,
      { stdio: 'pipe' }
    );
    const parsed = JSON.parse(result.toString());
    return parsed[0]?.results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

test.describe('Multi-group login flow', () => {
  let groupA: TestGroup;

  test.beforeAll(() => {
    groupA = createTestGroup('Single Group Test');
  });

  test.afterAll(() => {
    cleanupTestGroup(groupA.groupId);
  });

  test('user with single group logs in directly to feed (no picker)', async ({ page }) => {
    await loginWithMagicLink(page, groupA.magicLink);

    // Should go directly to feed, not group picker
    await expect(page.getByRole('tab', { name: 'Photos' })).toBeVisible();

    // Should NOT see the group picker
    await expect(page.getByText('Choose a group')).not.toBeVisible();

    // Should see the group name in the group switcher button
    await expect(page.getByRole('button', { name: 'Single Group Test' })).toBeVisible();
  });
});

test.describe('Multi-group selection', () => {
  let groupA: TestGroup;
  let groupB: TestGroup;

  test.beforeAll(() => {
    groupA = createTestGroup('Group Alpha');
    groupB = createTestGroup('Group Beta');
  });

  test.afterAll(() => {
    cleanupTestGroup(groupA.groupId);
    cleanupTestGroup(groupB.groupId);
  });

  test('user with multiple groups sees group picker after login', async ({ page }) => {
    // First, login to group A to create the user
    const memberA = createTestMember(groupA.groupId, 'Picker Test User');
    await loginWithMagicLink(page, memberA.magicLink);

    // Get user ID and add to group B
    const userId = getUserIdByEmail(memberA.email);
    expect(userId).toBeTruthy();
    addUserToGroup(userId!, groupB.groupId, 'member');

    // Logout
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Login again - should see picker
    const loginLink = createFreshMagicLink(groupA.groupId, memberA.email, 'login');
    await loginWithMagicLinkExpectPicker(page, loginLink);

    // Should see both groups
    await expect(page.getByText('Group Alpha')).toBeVisible();
    await expect(page.getByText('Group Beta')).toBeVisible();
  });

  test('user can select group from picker and lands on correct feed', async ({ page }) => {
    // Create user in both groups
    const member = createTestMember(groupA.groupId, 'Selector Test User');
    await loginWithMagicLink(page, member.magicLink);

    const userId = getUserIdByEmail(member.email);
    expect(userId).toBeTruthy();
    addUserToGroup(userId!, groupB.groupId, 'member');

    // Logout and login again
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    const loginLink = createFreshMagicLink(groupA.groupId, member.email, 'login');
    await loginWithMagicLinkExpectPicker(page, loginLink);

    // Select Group Beta
    await page.getByRole('button', { name: /Group Beta/i }).click();

    // Should land on feed with Group Beta selected
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByText('Group Beta')).toBeVisible();
  });
});

test.describe('Group switcher', () => {
  let groupA: TestGroup;
  let groupB: TestGroup;

  test.beforeAll(async () => {
    groupA = createTestGroup('Switcher Alpha');
    groupB = createTestGroup('Switcher Beta');
  });

  test.afterAll(() => {
    cleanupTestGroup(groupA.groupId);
    cleanupTestGroup(groupB.groupId);
  });

  test('group switcher dropdown shows all user groups', async ({ page }) => {
    // Create user in group A
    const member = createTestMember(groupA.groupId, 'Switcher Test User');
    await loginWithMagicLink(page, member.magicLink);

    // Add user to group B
    const userId = getUserIdByEmail(member.email);
    expect(userId).toBeTruthy();
    addUserToGroup(userId!, groupB.groupId, 'member');

    // Refresh to get updated group list
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // Click the group switcher
    await page.getByRole('button', { name: /Switcher Alpha/i }).click();

    // Should see both groups in dropdown
    await expect(page.getByRole('option', { name: /Switcher Alpha/i })).toBeVisible();
    await expect(page.getByRole('option', { name: /Switcher Beta/i })).toBeVisible();
  });

  test('switching groups via dropdown loads new group photos', async ({ page, request }) => {
    // Create admin in group A and upload a photo
    await loginWithMagicLink(page, groupA.magicLink);

    const tokenA = await getAuthToken(page);
    await uploadPhotoViaApi(request, tokenA!, 'Alpha Photo');
    await page.reload();
    await expect(page.getByText('Alpha Photo')).toBeVisible();

    // Add this admin to group B
    const userId = getUserIdByEmail(groupA.adminEmail);
    expect(userId).toBeTruthy();
    addUserToGroup(userId!, groupB.groupId, 'admin');

    // Refresh and switch to group B
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('button', { name: /Switcher Alpha/i }).click();
    await page.getByRole('option', { name: /Switcher Beta/i }).click();

    // Wait for switch to complete
    await expect(page.getByRole('button', { name: /Switcher Beta/i })).toBeVisible();

    // Reload to ensure token is fully updated in localStorage
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // Upload photo to Beta
    const tokenB = await getAuthToken(page);
    await uploadPhotoViaApi(request, tokenB!, 'Beta Photo');
    await page.reload();
    await expect(page.getByText('Beta Photo')).toBeVisible();

    // Should NOT see Alpha's photo in Beta
    await expect(page.getByText('Alpha Photo')).not.toBeVisible();

    // Switch back to Alpha
    await page.getByRole('button', { name: /Switcher Beta/i }).click();
    await page.getByRole('option', { name: /Switcher Alpha/i }).click();
    await expect(page.getByText('Switcher Alpha')).toBeVisible();

    // Should see Alpha's photo, not Beta's
    await expect(page.getByText('Alpha Photo')).toBeVisible();
    await expect(page.getByText('Beta Photo')).not.toBeVisible();
  });
});

test.describe('Per-group roles', () => {
  let groupA: TestGroup;
  let groupB: TestGroup;

  test.beforeAll(() => {
    groupA = createTestGroup('Role Test Alpha');
    groupB = createTestGroup('Role Test Beta');
  });

  test.afterAll(() => {
    cleanupTestGroup(groupA.groupId);
    cleanupTestGroup(groupB.groupId);
  });

  test('user can be admin in one group and member in another', async ({ page }) => {
    // Create admin in group A
    await loginWithMagicLink(page, groupA.magicLink);

    // Add as member to group B
    const userId = getUserIdByEmail(groupA.adminEmail);
    expect(userId).toBeTruthy();
    addUserToGroup(userId!, groupB.groupId, 'member');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    // In group A (admin) - should see Upload tab
    await expect(page.getByRole('tab', { name: 'Upload' })).toBeVisible();

    // Switch to group B
    await page.getByRole('button', { name: /Role Test Alpha/i }).click();
    await page.getByRole('option', { name: /Role Test Beta/i }).click();
    await expect(page.getByText('Role Test Beta')).toBeVisible();

    // In group B (member) - should NOT see Upload tab
    await expect(page.getByRole('tab', { name: 'Upload' })).not.toBeVisible();
  });
});

test.describe('Member management', () => {
  let testGroup: TestGroup;

  test.beforeEach(() => {
    testGroup = createTestGroup('Member Mgmt Test');
  });

  test.afterEach(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('admin can view members list', async ({ page }) => {
    await loginWithMagicLink(page, testGroup.magicLink);

    // Navigate to members tab
    await page.getByRole('tab', { name: 'Members' }).click();

    // Should see the admin in the list
    await expect(page.getByText(testGroup.adminName)).toBeVisible();
    await expect(page.getByText(testGroup.adminEmail)).toBeVisible();
  });

  test('admin can promote member to admin', async ({ page }) => {
    // First, create the admin user by using the invite link
    await loginWithMagicLink(page, testGroup.magicLink);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Create a member
    const member = createTestMember(testGroup.groupId, 'Promotable Member');

    // Login as member to create the user
    await loginWithMagicLink(page, member.magicLink);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Login as admin (now user exists, so login link works)
    const adminLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');
    await loginWithMagicLink(page, adminLink);

    // Navigate to members
    await page.getByRole('tab', { name: 'Members' }).click();

    // Find the select that's a sibling of the remove button for this member
    // Each member has a unique remove button, and the select is in the same actions container
    const promotableSelect = page.getByRole('button', { name: 'Remove Promotable Member from group' }).locator('..').locator('select');
    await promotableSelect.selectOption('admin');

    // Confirm the role change
    await expect(page.getByText(/Change.*role to/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Verify success message
    await expect(page.getByText(/is now an admin/)).toBeVisible();
  });

  test('admin can demote another admin to member', async ({ page }) => {
    // First, create the admin user by using the invite link
    await loginWithMagicLink(page, testGroup.magicLink);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Create another admin
    const otherAdmin = createTestMember(testGroup.groupId, 'Other Admin');

    // Login as other admin to create user
    await loginWithMagicLink(page, otherAdmin.magicLink);

    // Promote to admin via direct DB (simulating the flow)
    const userId = getUserIdByEmail(otherAdmin.email);
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "UPDATE memberships SET role = 'admin' WHERE user_id = '${userId}' AND group_id = '${testGroup.groupId}';"`,
      { stdio: 'pipe' }
    );

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Login as original admin
    const adminLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');
    await loginWithMagicLink(page, adminLink);

    // Navigate to members
    await page.getByRole('tab', { name: 'Members' }).click();

    // Demote the other admin - find select via the unique remove button
    const otherAdminSelect = page.getByRole('button', { name: 'Remove Other Admin from group' }).locator('..').locator('select');
    await otherAdminSelect.selectOption('member');

    // Confirm the role change
    await expect(page.getByText(/Change.*role to/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Verify success message
    await expect(page.getByText(/is now a member/)).toBeVisible();
  });

  test('admin cannot demote themselves if last admin', async ({ page }) => {
    await loginWithMagicLink(page, testGroup.magicLink);

    // Navigate to members
    await page.getByRole('tab', { name: 'Members' }).click();

    // Find own row (marked with "(you)")
    const ownRow = page.locator('div').filter({ hasText: '(you)' }).first();
    const roleSelect = ownRow.locator('select');

    // Select should be disabled
    await expect(roleSelect).toBeDisabled();
  });

  test('admin can remove a member from the group', async ({ page }) => {
    // First, create the admin user by using the invite link
    await loginWithMagicLink(page, testGroup.magicLink);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Create a member
    const member = createTestMember(testGroup.groupId, 'Removable Member');

    // Login as member first to create user
    await loginWithMagicLink(page, member.magicLink);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Login as admin
    const adminLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');
    await loginWithMagicLink(page, adminLink);

    // Navigate to members
    await page.getByRole('tab', { name: 'Members' }).click();
    await expect(page.getByText('Removable Member')).toBeVisible();

    // Find and click remove button using aria-label which is unique per member
    await page.getByRole('button', { name: 'Remove Removable Member from group' }).click();

    // Confirm removal - use exact match to get the modal button, not member-specific remove buttons
    await page.getByRole('button', { name: 'Remove', exact: true }).click();

    // Member should be removed from list
    await expect(page.getByText('Removable Member')).not.toBeVisible({ timeout: 5000 });
  });

  test('admin cannot remove themselves if last admin', async ({ page }) => {
    await loginWithMagicLink(page, testGroup.magicLink);

    // Navigate to members
    await page.getByRole('tab', { name: 'Members' }).click();

    // Find own row - remove button should be disabled
    const ownRow = page.locator('div').filter({ hasText: '(you)' }).first();
    const removeButton = ownRow.getByRole('button', { name: /remove/i });

    await expect(removeButton).toBeDisabled();
  });

  test('removed user no longer sees group in their list', async ({ page }) => {
    // First, create the admin user by using the invite link
    await loginWithMagicLink(page, testGroup.magicLink);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Create a member in both this group and another
    const otherGroup = createTestGroup('Other Group For Removal Test');
    const member = createTestMember(testGroup.groupId, 'Member To Remove');

    // Login as member to create user
    await loginWithMagicLink(page, member.magicLink);

    // Add to other group
    const userId = getUserIdByEmail(member.email);
    expect(userId).toBeTruthy();
    addUserToGroup(userId!, otherGroup.groupId, 'member');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Login as admin and remove member
    const adminLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail, 'login');
    await loginWithMagicLink(page, adminLink);

    await page.getByRole('tab', { name: 'Members' }).click();
    await page.getByRole('button', { name: 'Remove Member To Remove from group' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('Member To Remove')).not.toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    // Login as member - should only see other group
    const memberLogin = createFreshMagicLink(otherGroup.groupId, member.email, 'login');
    await loginWithMagicLink(page, memberLogin);

    // Should be in other group, not the one they were removed from
    await expect(page.getByText('Other Group For Removal Test')).toBeVisible();

    // Click group switcher - should NOT see Member Mgmt Test
    await page.getByRole('button', { name: /Other Group/i }).click();
    await expect(page.getByRole('option', { name: /Member Mgmt Test/i })).not.toBeVisible();

    cleanupTestGroup(otherGroup.groupId);
  });
});

test.describe('Empty state', () => {
  test('user with zero groups sees empty state', async ({ page }) => {
    // Create a user with no groups
    const email = `orphan-${randomBytes(4).toString('hex')}@test.local`;
    const uniqueUserId = randomBytes(16).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    // Create user directly in DB
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO users (id, name, email, created_at) VALUES ('${uniqueUserId}', 'Orphan User', '${email}', ${now});"`,
      { stdio: 'pipe' }
    );

    // Create a dummy group just for the magic link (user won't be member)
    const dummyGroup = createTestGroup('Dummy Group');
    const loginLink = createFreshMagicLink(dummyGroup.groupId, email, 'login');

    await loginWithMagicLinkExpectEmpty(page, loginLink);

    // Verify the empty state content
    await expect(
      page.getByText("You're not a member of any groups yet")
    ).toBeVisible();

    cleanupTestGroup(dummyGroup.groupId);

    // Cleanup orphan user
    execSync(
      `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM users WHERE id = '${uniqueUserId}';"`,
      { stdio: 'pipe' }
    );
  });
});
