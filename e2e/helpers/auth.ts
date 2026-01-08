import { Page, expect } from '@playwright/test';

export async function loginWithMagicLink(page: Page, magicLink: string): Promise<void> {
  await page.goto(magicLink);

  // Wait for verification to complete and redirect to main app
  await expect(page).toHaveURL('/', { timeout: 10000 });

  // Verify we're logged in by checking for the Sign out button (present for all users)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 5000 });
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
