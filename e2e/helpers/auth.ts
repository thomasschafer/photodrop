import { Page, expect } from '@playwright/test';

export async function loginWithMagicLink(
  page: Page,
  magicLink: string,
  name?: string
): Promise<void> {
  await page.goto(magicLink);

  const nameInput = page.getByPlaceholder('Jane Smith');
  const appLoaded = page
    .getByRole('tab', { name: 'Photos' })
    .or(page.getByRole('button', { name: 'Sign out' }))
    .or(page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]'));

  // Wait for the auth flow to complete: either the name input appears
  // (new user via invite link) or the main app loads after redirect
  await expect(nameInput.or(appLoaded)).toBeVisible({ timeout: 30000 });

  // If name input appeared (new user via invite link), fill and submit
  if (await nameInput.isVisible()) {
    if (!name) {
      throw new Error('Name is required for new user invite links');
    }
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  // Wait for the main app to load (Photos tab or Sign out button)
  await expect(appLoaded).toBeVisible({ timeout: 30000 });
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
  const directSignOut = page.getByRole('button', { name: 'Sign out' });
  const isDirectlyVisible = await directSignOut.isVisible().catch(() => false);

  if (isDirectlyVisible) {
    await directSignOut.click();
  } else {
    // On the main app, Sign out is inside the user menu dropdown
    await page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
  }

  // Wait for redirect to landing page
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}

export async function expectLoggedIn(page: Page): Promise<void> {
  await expect(
    page
      .getByRole('tab', { name: 'Photos' })
      .or(page.getByRole('button', { name: 'Sign out' }))
      .or(page.locator('button[aria-haspopup="menu"][aria-label$=" menu"]'))
  ).toBeVisible();
}

export async function expectLoggedOut(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
}
