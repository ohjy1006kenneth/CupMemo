import { test, expect } from '@playwright/test';
/* global document, window, Event */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { createDatabase, resolveDatabaseConfig } from '../../packages/database/dist/index.js';

const origin = 'http://127.0.0.1:3314';
const apiOrigin = 'http://127.0.0.1:4314';
const password = 'Browser-only-coffee-Strong8!';
const emails = [];
let connection;
let api;
let apiOutput = '';

async function startApi() {
  let listening = false;
  api = spawn(process.execPath, ['apps/api/dist/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CUPMEMO_API_PORT: '4314',
      CUPMEMO_API_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (chunk) => {
    if (String(chunk).includes(`Server listening at ${apiOrigin}`)) listening = true;
    apiOutput += String(chunk);
  });
  api.stderr.on('data', (chunk) => {
    apiOutput += String(chunk);
  });
  await expect.poll(() => listening && api.exitCode === null).toBe(true);
  await expect
    .poll(async () => {
      try {
        return (await globalThis.fetch(`${apiOrigin}/ready`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
}
async function stopApi() {
  if (api && api.exitCode === null) {
    const exited = once(api, 'exit');
    api.kill('SIGTERM');
    await exited;
  }
}
async function signup(page) {
  const email = `browser-${process.pid}-${Date.now()}-${emails.length}@example.test`;
  emails.push(email);
  await page.goto('/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Coffee Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app`);
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toBeVisible();
  return email;
}
async function signin(page, email) {
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app`);
}
async function expiry(email) {
  const result = await connection.pool.query(
    'SELECT expires_at FROM public.session JOIN public."user" u ON u.id = user_id WHERE u.email = $1',
    [email],
  );
  return result.rows[0]?.expires_at?.getTime() ?? 0;
}

test.beforeAll(async () => {
  const config = resolveDatabaseConfig(process.env);
  expect(config.environment).toBe('test');
  expect(process.env.BETTER_AUTH_URL).toBe(origin);
  expect(process.env.CUPMEMO_API_ORIGIN).toBe(apiOrigin);
  connection = createDatabase(config.databaseUrl, { max: 1 });
  await startApi();
});
test.afterAll(async () => {
  await stopApi();
  if (connection) {
    for (const email of emails)
      await connection.pool.query('DELETE FROM public."user" WHERE email = $1', [email]);
    await connection.close();
  }
  expect(apiOutput.includes(password)).toBe(false);
});

test('real signup, persistence, signin, signout, revocation and back navigation', async ({
  page,
  browser,
  context,
}) => {
  await page.goto('/app');
  await expect(page).toHaveURL(`${origin}/sign-in`);
  const email = await signup(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toBeVisible();
  const state = await context.storageState(); // Memory only; never saved as an artifact.
  expect(state.origins).toHaveLength(0);
  expect(state.cookies.every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);
  const fresh = await browser.newContext({ storageState: state });
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${origin}/app`);
  await expect(freshPage.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await freshPage.reload();
  await expect(freshPage).toHaveURL(`${origin}/sign-in`);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toHaveCount(0);
  await page.goto('/app');
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await signin(page, email);
  await page.goto('/sign-up');
  await expect(page).toHaveURL(`${origin}/app`);
  const html = await page.content();
  const serverHtml = await (
    await context.request.get(`${origin}/app`, {
      headers: { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' },
    })
  ).text();
  const persistedToken = await connection.pool.query(
    'SELECT token FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email = $1)',
    [email],
  );
  expect(persistedToken.rows.every((row) => !serverHtml.includes(row.token))).toBe(true);
  expect(
    (await context.cookies(origin)).every((cookie) => !serverHtml.includes(cookie.value)),
  ).toBe(true);
  expect(html.includes(password)).toBe(false);
  expect(html.includes('session_token')).toBe(false);
  expect(html.includes('expiresAt')).toBe(false);
  await fresh.close();
});

test('aged valid server validation is non-renewing; mounted client renews DB and browser cookie', async ({
  page,
  context,
  browser,
}) => {
  const email = await signup(page);
  await page.goto('about:blank');
  await connection.pool.query(
    `UPDATE public.session SET updated_at = NOW() - INTERVAL '2 days', expires_at = NOW() + INTERVAL '5 days' WHERE user_id IN (SELECT id FROM public."user" WHERE email = $1)`,
    [email],
  );
  const agedExpiry = await expiry(email);
  const cookies = await context.cookies(origin);
  const oldCookieExpiry = Math.floor(agedExpiry / 1000);
  await context.addCookies(cookies.map((c) => ({ ...c, expires: oldCookieExpiry })));
  const server = await context.request.get(`${origin}/app`);
  expect(server.status()).toBe(200);
  expect(await expiry(email)).toBe(agedExpiry);
  await page.goto('/app');
  await expect.poll(() => expiry(email)).toBeGreaterThan(agedExpiry);
  await expect
    .poll(async () => (await context.cookies(origin))[0].expires)
    .toBeGreaterThan(oldCookieExpiry);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toBeVisible();
  const fresh = await browser.newContext({ storageState: await context.storageState() });
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${origin}/app`);
  await expect(freshPage.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toBeVisible();
  await fresh.close();
});

test('expired and DB-revoked sessions redirect without account content', async ({ page }) => {
  const email = await signup(page);
  await connection.pool.query(
    `UPDATE public.session SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id IN (SELECT id FROM public."user" WHERE email = $1)`,
    [email],
  );
  await page.reload();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await signin(page, email);
  await connection.pool.query(
    'DELETE FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email = $1)',
    [email],
  );
  // The already-mounted official client must also discard its stale session,
  // not merely rely on a new server visit. Exercise its visibility refresh.
  await expect
    .poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      return page.url();
    })
    .toBe(`${origin}/sign-in`);
  await page.reload();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toHaveCount(0);
});

test('wrong credentials and duplicate signup are generic; failed revocation and real outage are retryable', async ({
  page,
}) => {
  const email = await signup(page);
  await stopApi();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.locator('.form-error[role="alert"]')).toContainText(
    'We couldn’t sign you out.',
  );
  await expect(page).toHaveURL(`${origin}/app`);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'We can’t reach your account right now.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toHaveCount(0);
  await startApi();
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Coffee Tester' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-coffee-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.form-error[role="alert"]')).toHaveText(
    'Email or password is incorrect. Try again.',
  );
  await page.goto('/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Duplicate');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('.form-error[role="alert"]')).toHaveText(
    'We couldn’t create your account. Check your details and try again.',
  );
});

for (const width of [320, 360, 390, 430, 1280]) {
  test(`labels, keyboard, invalid input, touch targets and overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/sign-in');
    await page.screenshot({ path: `test-results/sign-in-${width}.png` });
    await page.goto('/sign-up');
    const name = page.getByLabel('Name', { exact: true });
    await name.focus();
    await page.keyboard.type('Keyboard Tester');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
    await page.keyboard.type('invalid');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await page.keyboard.type('short');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${origin}/sign-up`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const box = await page
      .getByRole('button', { name: 'Create account', exact: true })
      .boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/sign-up-${width}.png` }); // Invalid throwaway fields only, no identity/cookie dumps.
    await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
    const email = `keyboard-${process.pid}-${Date.now()}@example.test`;
    emails.push(email);
    await page.keyboard.press('Control+a');
    await page.keyboard.type(email);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Control+a');
    await page.keyboard.type(password);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${origin}/app`);
    await expect(page.getByRole('heading', { name: 'Welcome, Keyboard Tester' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/account-${width}.png` });
    await page.getByRole('button', { name: 'Sign out', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${origin}/sign-in`);
  });
}
