import { API_BASE } from './helpers/ports';
import { test, expect, type Page } from '@playwright/test';
import {
  createTestGroup,
  cleanupTestGroup,
  createFreshMagicLink,
  TestGroup,
} from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { uploadPhotoViaApi } from './helpers/api';

const PHOTO_COUNT = 45; // three pages: 20 + 20 + 5

/**
 * Scrolls to the bottom until the feed stops growing for a few consecutive
 * attempts. Unlike scroll-until-count helpers, this makes no assumption about
 * how many photos should appear — the assertions afterwards do that — so it
 * terminates the same way for a healthy feed and a stranded one.
 */
async function scrollToExhaustion(page: Page): Promise<void> {
  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const count = await page.locator('article').count();
    stable = count === previous ? stable + 1 : 0;
    previous = count;
  }
}

async function collectCaptions(page: Page): Promise<string[]> {
  return page.locator('article').evaluateAll((articles) =>
    articles.map((a) => {
      const caption = Array.from(a.querySelectorAll('p')).find((p) =>
        p.textContent?.startsWith('Photo ')
      );
      return caption?.textContent ?? '(no caption)';
    })
  );
}

test.describe('Pagination exhaustion', () => {
  let testGroup: TestGroup;

  test.beforeAll(async ({ request }) => {
    testGroup = createTestGroup('Pagination Exhaustion Group');

    const verifyResponse = await request.post(`${API_BASE}/auth/verify-magic-link`, {
      data: { token: testGroup.magicLink.split('/auth/')[1], name: testGroup.ownerName },
    });
    const { accessToken } = await verifyResponse.json();

    for (let i = 1; i <= PHOTO_COUNT; i++) {
      await uploadPhotoViaApi(request, accessToken, `Photo ${i}`);
    }
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('every photo appears exactly once when scrolling to the end', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    await expect(page.locator('article').first()).toBeVisible({ timeout: 10000 });

    await scrollToExhaustion(page);

    const captions = await collectCaptions(page);
    expect(new Set(captions).size).toBe(captions.length); // no duplicates
    expect(captions.length).toBe(PHOTO_COUNT); // no silent gaps
  });

  test('survives two load-more triggers firing in the same tick', async ({ page }) => {
    // The feed consults its sentinel from several event sources (scroll,
    // resize, a ResizeObserver on the list). Real usage can deliver two of
    // those in one tick, which must produce at most one page fetch — a pair
    // of concurrent fetches for the same page double-advances the offset and
    // silently skips the page after it. Reproduced deterministically here.
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    await expect(page.locator('article').first()).toBeVisible({ timeout: 10000 });

    // Bring the sentinel into view so load-more is armed, then fire two
    // trigger events synchronously in the same task.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });

    await scrollToExhaustion(page);

    const captions = await collectCaptions(page);
    expect(new Set(captions).size).toBe(captions.length);
    expect(captions.length).toBe(PHOTO_COUNT);
  });

  test('shows an explicit end-of-feed marker once everything is loaded', async ({ page }) => {
    // Without a terminal marker, a feed truncated by a paging bug is
    // indistinguishable from one that simply ended.
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);
    await expect(page.locator('article').first()).toBeVisible({ timeout: 10000 });

    await scrollToExhaustion(page);

    await expect(page.getByText(/all caught up/i)).toBeVisible();
  });
});
