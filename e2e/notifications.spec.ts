import { test, expect } from '@playwright/test';
import { createTestGroup, cleanupTestGroup, createFreshMagicLink, TestGroup } from './helpers/setup';
import { loginWithMagicLink } from './helpers/auth';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';

function generateId(): string {
  return randomBytes(16).toString('hex');
}

// Mock push subscription data
const mockSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/mock-endpoint-123',
  expirationTime: null,
  keys: {
    p256dh: 'mock-p256dh-key',
    auth: 'mock-auth-key',
  },
};

// Helper to inject push notification mocks into page
async function mockPushSupported(page: import('@playwright/test').Page, permission: 'granted' | 'denied' | 'default' = 'default') {
  await page.addInitScript(({ permission, subscription }) => {
    // Mock Notification API
    Object.defineProperty(window, 'Notification', {
      value: {
        permission,
        requestPermission: async () => 'granted',
      },
      writable: true,
    });

    // Mock PushManager
    const mockPushManager = {
      getSubscription: async () => null,
      subscribe: async () => ({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        getKey: (name: string) => {
          const keys: Record<string, ArrayBuffer> = {
            p256dh: new TextEncoder().encode(subscription.keys.p256dh).buffer,
            auth: new TextEncoder().encode(subscription.keys.auth).buffer,
          };
          return keys[name] || null;
        },
        toJSON: () => subscription,
        unsubscribe: async () => true,
      }),
    };

    // Mock ServiceWorkerRegistration
    const mockRegistration = {
      pushManager: mockPushManager,
      active: { state: 'activated' },
      installing: null,
      waiting: null,
      scope: '/',
      updateViaCache: 'imports',
      onupdatefound: null,
      getNotifications: async () => [],
      showNotification: async () => undefined,
      update: async () => undefined,
      unregister: async () => true,
    };

    // Mock navigator.serviceWorker
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(mockRegistration),
        controller: { state: 'activated' },
        register: async () => mockRegistration,
        getRegistration: async () => mockRegistration,
        getRegistrations: async () => [mockRegistration],
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      writable: true,
    });

    // Mock PushManager on window for feature detection
    Object.defineProperty(window, 'PushManager', {
      value: class PushManager {},
      writable: true,
    });
  }, { permission, subscription: mockSubscription });
}

// Helper to mock push as unsupported
async function mockPushUnsupported(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    // Remove PushManager to simulate unsupported browser
    Object.defineProperty(window, 'PushManager', {
      value: undefined,
      writable: true,
    });

    // Remove serviceWorker to simulate unsupported
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      writable: true,
    });
  });
}

// Helper to mock an existing subscription
async function mockPushSubscribed(page: import('@playwright/test').Page, endpoint: string) {
  await page.addInitScript(({ endpoint, subscription }) => {
    // Mock Notification API with granted permission
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'granted',
        requestPermission: async () => 'granted',
      },
      writable: true,
    });

    const existingSubscription = {
      ...subscription,
      endpoint,
      toJSON: () => ({ ...subscription, endpoint }),
      unsubscribe: async () => true,
    };

    // Mock PushManager with existing subscription
    const mockPushManager = {
      getSubscription: async () => existingSubscription,
      subscribe: async () => existingSubscription,
    };

    // Mock ServiceWorkerRegistration
    const mockRegistration = {
      pushManager: mockPushManager,
      active: { state: 'activated' },
    };

    // Mock navigator.serviceWorker
    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        ready: Promise.resolve(mockRegistration),
        controller: { state: 'activated' },
      },
      writable: true,
    });

    Object.defineProperty(window, 'PushManager', {
      value: class PushManager {},
      writable: true,
    });
  }, { endpoint, subscription: mockSubscription });
}

// Helper to create a push subscription in the database
function createPushSubscription(userId: string, groupId: string, endpoint: string): void {
  const id = generateId();
  const deletionToken = generateId();
  const now = Math.floor(Date.now() / 1000);

  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO push_subscriptions (id, user_id, group_id, endpoint, p256dh, auth, deletion_token, created_at) VALUES ('${id}', '${userId}', '${groupId}', '${endpoint}', 'mock-p256dh', 'mock-auth', '${deletionToken}', ${now});"`,
    { stdio: 'pipe' }
  );
}

// Helper to clean up push subscriptions
function cleanupPushSubscriptions(groupId: string): void {
  execSync(
    `cd backend && npx wrangler d1 execute photodrop-db --local --command "DELETE FROM push_subscriptions WHERE group_id = '${groupId}';"`,
    { stdio: 'pipe' }
  );
}

test.describe('Push Notifications', () => {
  let testGroup: TestGroup;

  test.beforeAll(() => {
    testGroup = createTestGroup('Notifications Test Group');
  });

  test.afterAll(() => {
    cleanupPushSubscriptions(testGroup.groupId);
    cleanupTestGroup(testGroup.groupId);
  });

  test('NotificationBell is visible in header when logged in', async ({ page }) => {
    await mockPushSupported(page);

    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Bell should be visible in the header (matches "Enable notifications" or "Disable notifications")
    const bell = page.getByRole('button', { name: /^(enable|disable) notifications$/i });
    await expect(bell).toBeVisible();
  });

  test('NotificationBell shows unsupported state and help modal when push is not available', async ({ page }) => {
    await mockPushUnsupported(page);

    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Bell should be visible with unsupported state
    const bell = page.getByRole('button', { name: /notifications not supported/i });
    await expect(bell).toBeVisible();
    await expect(bell).toBeEnabled();

    // Clicking the bell should show a help modal
    await bell.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Notifications not supported')).toBeVisible();
    await expect(page.getByText(/try using Chrome, Firefox, or Edge/i)).toBeVisible();

    // Close the modal
    const gotItButton = dialog.getByRole('button', { name: 'Got it' });
    await gotItButton.click();
    await expect(dialog).not.toBeVisible();
  });

  test('NotificationBell shows blocked state when permission denied and shows help modal on click', async ({ page }) => {
    await mockPushSupported(page, 'denied');

    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Bell should show blocked state when permission is denied
    const blockedBell = page.getByRole('button', { name: /notifications blocked/i });
    await expect(blockedBell).toBeVisible();
    await expect(blockedBell).toBeEnabled();

    // Clicking the blocked bell should show a help modal
    await blockedBell.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Notifications blocked')).toBeVisible();
    await expect(page.getByText(/change your browser settings/i)).toBeVisible();

    // Close the modal
    const gotItButton = dialog.getByRole('button', { name: 'Got it' });
    await gotItButton.click();
    await expect(dialog).not.toBeVisible();
  });

  test('clicking bell when unsubscribed calls subscribe API', async ({ page, request }) => {
    await mockPushSupported(page, 'default');

    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Intercept the subscribe API call
    let subscribeCalled = false;
    await page.route('**/push/subscribe', async (route) => {
      subscribeCalled = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Subscribed successfully' }),
      });
    });

    // Also intercept the VAPID key request
    await page.route('**/push/vapid-public-key', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ publicKey: 'BNtest-vapid-public-key-base64' }),
      });
    });

    // Click the bell
    const bell = page.getByRole('button', { name: /enable notifications/i });
    await bell.click();

    // Wait for the API call
    await expect.poll(() => subscribeCalled, { timeout: 5000 }).toBe(true);
  });

  test('clicking bell when subscribed shows confirmation modal', async ({ page }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/test-${generateId()}`;

    // Create subscription in DB first
    createPushSubscription(testGroup.ownerId, testGroup.groupId, endpoint);

    await mockPushSubscribed(page, endpoint);

    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Intercept the status check to return subscribed
    await page.route('**/push/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscribed: true }),
      });
    });

    // Wait for bell to show subscribed state and click it
    const bell = page.getByRole('button', { name: /disable notifications/i });
    await expect(bell).toBeVisible({ timeout: 5000 });
    await bell.click();

    // Confirmation modal should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Disable notifications?')).toBeVisible();
  });

  test('confirming unsubscribe calls unsubscribe API', async ({ page }) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/test-${generateId()}`;

    // Create subscription in DB
    createPushSubscription(testGroup.ownerId, testGroup.groupId, endpoint);

    await mockPushSubscribed(page, endpoint);

    const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
    await loginWithMagicLink(page, magicLink);

    // Mock the API calls
    await page.route('**/push/status**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscribed: true }),
      });
    });

    let unsubscribeCalled = false;
    await page.route('**/push/subscribe', async (route) => {
      if (route.request().method() === 'DELETE') {
        unsubscribeCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Unsubscribed successfully' }),
        });
      }
    });

    // Click bell to show modal
    const bell = page.getByRole('button', { name: /disable notifications/i });
    await expect(bell).toBeVisible({ timeout: 5000 });
    await bell.click();

    // Confirm unsubscribe - use the dialog's Disable button (not the bell)
    const dialog = page.getByRole('dialog');
    const confirmButton = dialog.getByRole('button', { name: 'Disable' });
    await confirmButton.click();

    // Wait for the API call
    await expect.poll(() => unsubscribeCalled, { timeout: 5000 }).toBe(true);
  });

  test('subscription is per-group - switching groups changes bell state', async ({ page }) => {
    // Create a second group
    const testGroup2 = createTestGroup('Second Notifications Group');
    const endpoint = `https://fcm.googleapis.com/fcm/send/test-${generateId()}`;

    try {
      // Subscribe to first group only
      createPushSubscription(testGroup.ownerId, testGroup.groupId, endpoint);

      await mockPushSubscribed(page, endpoint);

      const magicLink = createFreshMagicLink(testGroup.groupId, testGroup.adminEmail);
      await loginWithMagicLink(page, magicLink);

      // Add the user to the second group
      const now = Math.floor(Date.now() / 1000);
      execSync(
        `cd backend && npx wrangler d1 execute photodrop-db --local --command "INSERT INTO memberships (user_id, group_id, role, joined_at) VALUES ('${testGroup.ownerId}', '${testGroup2.groupId}', 'member', ${now});"`,
        { stdio: 'pipe' }
      );

      // Track which group the status API is being called for
      let currentGroupId = testGroup.groupId;
      await page.route('**/push/status**', async (route) => {
        // Only return subscribed for group 1
        const isSubscribed = currentGroupId === testGroup.groupId;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ subscribed: isSubscribed }),
        });
      });

      // First group should show as subscribed
      const bellSubscribed = page.getByRole('button', { name: /disable notifications/i });
      await expect(bellSubscribed).toBeVisible({ timeout: 5000 });

      // Reload to get updated group list
      await page.reload();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

      // Re-apply the mock after reload
      await page.route('**/push/status**', async (route) => {
        const isSubscribed = currentGroupId === testGroup.groupId;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ subscribed: isSubscribed }),
        });
      });

      // Switch to group 2 via the group switcher
      await page.getByRole('button', { name: /Notifications Test Group/i }).click();
      await page.getByRole('option', { name: /Second Notifications Group/i }).click();

      // Update the mock to return unsubscribed for group 2
      currentGroupId = testGroup2.groupId;

      // Wait for switch to complete
      await expect(page.getByRole('button', { name: /Second Notifications Group/i })).toBeVisible();

      // Bell should now show unsubscribed state (enable button)
      const bellUnsubscribed = page.getByRole('button', { name: /enable notifications/i });
      await expect(bellUnsubscribed).toBeVisible({ timeout: 5000 });
    } finally {
      cleanupPushSubscriptions(testGroup2.groupId);
      cleanupTestGroup(testGroup2.groupId);
    }
  });
});
