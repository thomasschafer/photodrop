import { Page, expect } from '@playwright/test';

const USER_MENU_BUTTON = 'button[aria-haspopup="menu"][aria-label$=" menu"]';

export async function loginWithMagicLink(
  page: Page,
  magicLink: string,
  name?: string
): Promise<void> {
  await page.goto(magicLink);

  // Wait for verification to complete - the "Verifying your link..." spinner will disappear
  await expect(page.getByText('Verifying your link')).not.toBeVisible({ timeout: 15000 });

  const nameInput = page.getByPlaceholder('Jane Smith');

  // Check if name input appeared (new user via invite link)
  if (await nameInput.isVisible()) {
    if (!name) {
      throw new Error('Name is required for new user invite links');
    }
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  // Wait for user menu button - the definitive indicator of being logged in
  await expect(page.locator(USER_MENU_BUTTON)).toBeVisible({ timeout: 30000 });
}

export async function loginWithMagicLinkExpectPicker(page: Page, magicLink: string): Promise<void> {
  await page.goto(magicLink);

  // Wait for group picker
  await expect(page.getByText('Choose a group')).toBeVisible({ timeout: 30000 });
}

export async function loginWithMagicLinkExpectEmpty(page: Page, magicLink: string): Promise<void> {
  await page.goto(magicLink);

  // Wait for empty state
  await expect(page.getByText('No groups yet')).toBeVisible({ timeout: 30000 });
}

export async function getAuthToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    return localStorage.getItem('accessToken');
  });
}

export async function logout(page: Page): Promise<void> {
  // Open user menu and click sign out
  await page.locator(USER_MENU_BUTTON).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // Wait for redirect to landing page
  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}

export async function expectLoggedIn(page: Page): Promise<void> {
  await expect(page.locator(USER_MENU_BUTTON)).toBeVisible();
}

export async function expectLoggedOut(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}
