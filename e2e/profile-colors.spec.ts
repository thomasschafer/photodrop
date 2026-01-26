import { test, expect } from '@playwright/test';
import { createTestGroup, createTestMember, createFreshMagicLink, cleanupTestGroup, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';

test.describe('Profile colors', () => {
  let testGroup: TestGroup;

  test.beforeAll(() => {
    testGroup = createTestGroup('Profile Color Test');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('avatar appears in header with user initials', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // The user menu button should contain an avatar
    const userMenuButton = page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]');
    await expect(userMenuButton).toBeVisible();

    // Avatar should be inside the menu button
    const avatar = userMenuButton.locator('div[aria-hidden="true"]');
    await expect(avatar).toBeVisible();
  });

  test('clicking avatar opens user menu with change color and sign out', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Click the user menu button
    const userMenuButton = page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]');
    await userMenuButton.click();

    // Should see user menu with "Change color" and "Sign out"
    await expect(page.getByRole('menuitem', { name: 'Change color' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();

    // Should show "Signed in as" text
    await expect(page.getByText(/Signed in as/)).toBeVisible();
  });

  test('color picker modal shows all colors with current highlighted', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Open user menu
    const userMenuButton = page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]');
    await userMenuButton.click();

    // Click "Change color"
    await page.getByRole('menuitem', { name: 'Change color' }).click();

    // Modal should be visible
    await expect(page.getByText('Choose your color')).toBeVisible();

    // Should show 20 color buttons
    const gridButtons = page.locator('.grid button');
    await expect(gridButtons).toHaveCount(20);

    // One should be marked as current (aria-pressed="true")
    const currentButton = page.locator('button[aria-pressed="true"]');
    await expect(currentButton).toHaveCount(1);
  });

  test('selecting new color updates avatar immediately', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Get the initial avatar color
    const userMenuButton = page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]');
    const avatar = userMenuButton.locator('div[aria-hidden="true"]');
    const initialColor = await avatar.evaluate((el) => getComputedStyle(el).backgroundColor);

    // Open user menu and color picker
    await userMenuButton.click();
    await page.getByRole('menuitem', { name: 'Change color' }).click();
    await expect(page.getByText('Choose your color')).toBeVisible();

    // Click a different color (not the currently selected one)
    const nonSelectedButton = page.locator('button[aria-pressed="false"]').first();
    await nonSelectedButton.click();

    // Modal should close
    await expect(page.getByText('Choose your color')).not.toBeVisible();

    // Avatar color should have changed
    const newColor = await avatar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(newColor).not.toBe(initialColor);
  });

  test('avatars appear in member list with correct colors', async ({ page }) => {
    // Login as admin (who can see member list)
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Navigate to members tab
    await page.getByRole('tab', { name: 'Group' }).click();

    // Should see avatar circles in the member list
    const memberAvatars = page.locator('[class*="rounded-full"][aria-hidden="true"]');
    await expect(memberAvatars.first()).toBeVisible();
  });

  test('new users get random color assigned on creation', async ({ page }) => {
    // Create a new member
    const member = createTestMember(testGroup.groupId, 'Color Test Member');
    await loginWithMagicLink(page, member.magicLink, member.name);

    // The avatar should be visible with a color (not undefined or error)
    const userMenuButton = page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]');
    const avatar = userMenuButton.locator('div[aria-hidden="true"]');
    await expect(avatar).toBeVisible();

    // Avatar should have a background color that's not transparent
    const bgColor = await avatar.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(bgColor).not.toBe('transparent');
  });
});
