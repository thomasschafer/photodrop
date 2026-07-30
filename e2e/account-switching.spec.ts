import { test, expect } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  cleanupTestGroup,
  createFreshMagicLink,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink, logout, expectLoggedIn, expectLoggedOut } from './helpers/auth';
import { API_BASE } from './helpers/ports';

test.describe('Account switching and sign-out safety', () => {
  let testGroup: TestGroup;
  let memberEmail: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Switcheroo Group');
    const invite = createTestMember(testGroup.groupId, 'Second Account');
    await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: invite.magicLink.split('/auth/')[1], name: 'Second Account' },
    });
    memberEmail = invite.email;
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('opening a login link while signed in asks before switching', async ({ page }) => {
    const ownerLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, ownerLink);

    // Open a second account's link in the same session: no silent switch.
    const memberLink = createFreshMagicLink(testGroup.groupId, memberEmail);
    await page.goto(memberLink);
    await expect(page.getByText(`You're signed in as ${testGroup.ownerName}`)).toBeVisible();

    // Declining keeps the original session (and the unused link stays valid).
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expectLoggedIn(page);
    await expect(
      page.getByRole('button', { name: `${testGroup.ownerName} menu` })
    ).toBeVisible();

    // Going through it again and continuing performs the switch.
    await page.goto(memberLink);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Second Account menu' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('sign out asks for confirmation and cancel keeps the session', async ({ page }) => {
    const ownerLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, ownerLink);

    await page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expectLoggedIn(page);

    // The full flow signs out.
    await logout(page);
    await expectLoggedOut(page);
  });
});
