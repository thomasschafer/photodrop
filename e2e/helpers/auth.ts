import { Page, expect } from '@playwright/test';

export async function loginWithMagicLink(
  page: Page,
  magicLink: string,
  name?: string
): Promise<void> {
  await page.goto(magicLink);

  // Wait for verification to complete - could land on name input, group picker, or main app
  // First wait for the "Verifying your link..." to disappear
  await expect(page.locator('text=Verifying your link')).not.toBeVisible({ timeout: 15000 });

  // Check if we need to enter a name (new user via invite link)
  const nameInput = page.getByPlaceholder('Jane Smith');
  const needsName = await nameInput.isVisible({ timeout: 2000 }).catch(() => false);

  if (needsName) {
    if (!name) {
      throw new Error('Name is required for new user invite links');
    }
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  // Wait for sign out button to appear (present in main app, group picker, and no-groups page)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15000 });
}

export async function loginWithMagicLinkExpectPicker(page: Page, magicLink: string): Promise<void> {
  await page.goto(magicLink);

  // Wait for group picker
  await expect(page.getByText('Choose a group')).toBeVisible({ timeout: 15000 });
}

export async function loginWithMagicLinkExpectEmpty(page: Page, magicLink: string): Promise<void> {
  await page.goto(magicLink);

  // Wait for empty state
  await expect(page.getByText('No groups yet')).toBeVisible({ timeout: 15000 });
}

export async function getAuthToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    return localStorage.getItem('accessToken');
  });
}

export async function logout(page: Page): Promise<void> {
  // Click the sign out button
  await page.getByRole('button', { name: 'Sign out' }).click();

  // Wait for redirect to landing page
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}

export async function expectLoggedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export async function expectLoggedOut(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}
