import { test, expect, type Page } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';

/**
 * Engine-agnostic containment invariants for modal dialogs:
 *
 *  1. Tab never moves focus outside the open dialog.
 *  2. One pass of Tab presses reaches every interactive control — including
 *     button-only controls, which Safari's native tab order skips entirely.
 *
 * Run under both the chromium config and playwright.webkit.config.ts. Under
 * WebKit these tests reproduce the real-Safari escape (the first Tab from the
 * dialog's initial input lands on <body>); under chromium the engine's native
 * tab cycle masks it. The unit tests in frontend/src/lib/useFocusTrap.test.tsx
 * additionally pin the per-press interception contract the fix relies on.
 */

interface FocusProbe {
  insideDialog: boolean;
  label: string;
}

async function pressTabAndProbe(page: Page): Promise<FocusProbe> {
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      insideDialog: !!el?.closest('[role="dialog"]'),
      label: el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 30) || el?.tagName || '',
    };
  });
}

async function assertContainment(page: Page, mustVisit: string[]): Promise<void> {
  const visited = new Set<string>();
  for (let i = 0; i < 14; i++) {
    const probe = await pressTabAndProbe(page);
    expect(probe.insideDialog, `Tab press ${i + 1} left the dialog (landed on "${probe.label}")`).toBe(
      true
    );
    visited.add(probe.label);
  }
  for (const label of mustVisit) {
    expect(Array.from(visited), `expected Tab cycle to reach "${label}"`).toContain(label);
  }
}

test.describe('Modal focus containment', () => {
  let testGroup: TestGroup;

  test.beforeAll(() => {
    testGroup = createTestGroup('Focus Trap Group');
  });

  test.afterAll(() => {
    cleanupTestGroup(testGroup.groupId);
  });

  test('name settings dialog contains Tab and reaches its buttons', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]').click();
    await page.getByRole('menuitem', { name: 'Change name' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await assertContainment(page, ['Cancel', 'Save']);
  });

  test('invite dialog contains Tab and reaches its controls', async ({ page }) => {
    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    await page.getByRole('tab', { name: 'Group' }).click();
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await assertContainment(page, ['Send invite']);
  });
});
