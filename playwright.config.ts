import { defineConfig, devices } from '@playwright/test';
import { E2E_BACKEND_PORT, E2E_FRONTEND_PORT } from './e2e/helpers/ports';

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
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
