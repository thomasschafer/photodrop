// Runs the e2e suite against WebKit, the engine behind Safari and every iOS
// browser — the platform photodrop is used on most, and the one the default
// chromium run says nothing about. Kept as a separate opt-in config so the
// default `npm run test:e2e` stays a single fast chromium pass:
//
//   npx playwright test --config playwright.webkit.config.ts
//
// This run has caught engine-specific bugs chromium could not: WebKit does not
// implement unprefixed `user-select`, and it refuses `Secure` cookies over
// http://localhost where chromium special-cases them.
import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  projects: [
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
