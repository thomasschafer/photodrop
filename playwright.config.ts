import { defineConfig, devices } from '@playwright/test';
import { E2E_BACKEND_PORT, E2E_FRONTEND_PORT } from './e2e/helpers/ports';
import { INSTALL_PROMPT_STORAGE_KEY, INSTALL_PROMPT_DISMISSED } from '@photodrop/common/storage';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Serial execution to avoid SQLite database locks
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: `http://localhost:${E2E_FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // The install prompt opens as a modal on a browser that has never seen it,
    // and its backdrop would swallow every click. Start already dismissed.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://localhost:${E2E_FRONTEND_PORT}`,
          localStorage: [
            {
              name: INSTALL_PROMPT_STORAGE_KEY,
              value: JSON.stringify(INSTALL_PROMPT_DISMISSED),
            },
          ],
        },
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: [
    {
      command: `cd backend && npx wrangler d1 migrations apply photodrop-db --local && npx wrangler dev --port ${E2E_BACKEND_PORT}`,
      url: `http://localhost:${E2E_BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `cd frontend && npx vite --port ${E2E_FRONTEND_PORT}`,
      url: `http://localhost:${E2E_FRONTEND_PORT}`,
      reuseExistingServer: false,
      env: {
        API_PORT: String(E2E_BACKEND_PORT),
      },
      timeout: 30000,
    },
  ],
});
