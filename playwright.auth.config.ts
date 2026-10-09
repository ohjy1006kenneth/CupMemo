import { defineConfig } from '@playwright/test';
import process from 'node:process';

const origin = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3314';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('E2E requires loopback origin');
const port = new URL(origin).port;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: origin,
    browserName: 'chromium',
    launchOptions: { executablePath: '/usr/bin/chromium' },
    // Auth traces/storage snapshots can contain credentials. Never record them.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: `corepack pnpm --filter @cupmemo/web exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/sign-in`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
