import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3314',
    browserName: 'chromium',
    launchOptions: { executablePath: '/usr/bin/chromium' },
    // Auth traces/storage snapshots can contain credentials. Never record them.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'corepack pnpm --filter @cupmemo/web exec next start --hostname 127.0.0.1 --port 3314',
    url: 'http://127.0.0.1:3314/sign-in',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
