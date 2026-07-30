import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';

test.describe('Pending invites', () => {
  let testGroup: TestGroup;

  test.beforeAll(() => {
    testGroup = createTestGroup('Waitlist Crew');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('sent invites are listed, resendable and revocable', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await page.getByRole('tab', { name: 'Group' }).click();
    await page.getByRole('button', { name: 'Invite', exact: true }).click();

    const inviteDialog = page.getByRole('dialog', { name: 'Invite someone' });
    await inviteDialog.getByLabel('Email').fill('pending-person@test.local');
    await inviteDialog.getByRole('button', { name: 'Send invite' }).click();

    // The invite lands in the pending section, unexpired.
    await expect(page.getByText('Pending invites')).toBeVisible();
    await expect(page.getByText('pending-person@test.local', { exact: true })).toBeVisible();
    await expect(page.getByText('· expired')).toHaveCount(0);

    // Resend keeps it pending and confirms.
    await page.getByRole('button', { name: 'Resend' }).click();
    await expect(page.getByText('Invite re-sent to pending-person@test.local')).toBeVisible();
    await expect(page.getByText('pending-person@test.local', { exact: true })).toBeVisible();

    // Revoke removes it (and the whole section, as it was the only one).
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Invite for pending-person@test.local revoked')).toBeVisible();
    await expect(page.getByText('Pending invites')).toHaveCount(0);
  });
});
