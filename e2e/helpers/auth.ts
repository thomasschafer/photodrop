import { Page, expect } from '@playwright/test';

const USER_MENU_BUTTON = 'button[aria-haspopup="menu"][aria-label$=" menu"]';

export async function loginWithMagicLink(
  page: Page,
  magicLink: string,
  name?: string
): Promise<void> {
  await page.goto(magicLink);

  const userMenu = page.locator(USER_MENU_BUTTON);
  const interstitial = page.getByText(/^You're signed in as /);
  const nameInput = page.getByPlaceholder('Jane Smith');

  // Verification ends in one of three places: signed in (user menu), the
  // name form for a new invitee, or — when another session is live — the
  // account-switch interstitial, which tests continue through.
  await expect(userMenu.or(interstitial).or(nameInput).first()).toBeVisible({ timeout: 30000 });
  if (await interstitial.isVisible()) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(userMenu.or(nameInput).first()).toBeVisible({ timeout: 30000 });
  }

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

/** Extract the user ID from the stored JWT access token. */
export async function getUserIdFromToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const id = payload.userId ?? payload.sub ?? payload.id ?? null;
      if (!id) throw new Error(`No user ID found in JWT payload: ${JSON.stringify(payload)}`);
      return id as string;
    } catch {
      return null;
    }
  });
}

export async function logout(page: Page): Promise<void> {
  // Open user menu, click sign out, and confirm
  await page.locator(USER_MENU_BUTTON).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out?' })
    .getByRole('button', { name: 'Sign out' })
    .click();

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
