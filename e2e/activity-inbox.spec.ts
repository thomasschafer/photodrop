import { API_BASE } from './helpers/ports';
import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  createTestGroup,
  createTestMember,
  cleanupTestGroup,
  createFreshMagicLink,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

async function verifyToken(request: APIRequestContext, magicLink: string, name?: string) {
  const response = await request.post(`${API_BASE}/auth/verify-magic-link`, {
    data: { token: magicLink.split('/auth/')[1], ...(name ? { name } : {}) },
  });
  return (await response.json()) as { accessToken: string };
}

test.describe('Activity inbox', () => {
  let testGroup: TestGroup;
  let photoId: string;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Inbox Group');

    const owner = await verifyToken(request, testGroup.magicLink, testGroup.ownerName);
    ({ id: photoId } = await uploadPhotoViaApi(request, owner.accessToken, 'Owner photo'));

    // A member joins, reacts to and comments on the owner's photo — all
    // before the owner next opens the app.
    const memberInvite = createTestMember(testGroup.groupId, 'Activity Member');
    const member = await verifyToken(request, memberInvite.magicLink, 'Activity Member');
    const headers = {
      Authorization: `Bearer ${member.accessToken}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    await request.post(`${API_BASE}/photos/${photoId}/react`, {
      headers,
      data: { emoji: '❤️' },
    });
    await request.post(`${API_BASE}/photos/${photoId}/comments`, {
      headers,
      data: { content: 'So pretty!' },
    });
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('shows unread activity, deep-links into it, and clears on open', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Everything the member did while the owner was away is unread.
    const bell = page.getByRole('button', { name: /^Activity \(\d+ unread\)$/ });
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.getByRole('dialog', { name: 'Activity' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Activity Member reacted ❤️ to your photo')).toBeVisible();
    await expect(panel.getByText('Activity Member commented: “So pretty!”')).toBeVisible();
    await expect(panel.getByText('Activity Member joined the group')).toBeVisible();

    // A comment row deep-links into the lightbox with comments open.
    await panel.getByText('Activity Member commented: “So pretty!”').click();
    await expect(page).toHaveURL(new RegExp(`/photo/${photoId}\\?comments=open`));
    await expect(page.getByText('So pretty!')).toBeVisible();

    // Opening the panel marked everything seen: back on the feed, the badge
    // is gone.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
  });
});
