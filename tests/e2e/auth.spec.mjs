import { test, expect } from '@playwright/test';
/* global document, window, Event, getComputedStyle, localStorage, sessionStorage */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { createDatabase, resolveDatabaseConfig } from '../../packages/database/dist/index.js';
import {
  coffeeCreateSchema,
  coffeeResponseSchema,
  brewCreateSchema,
  brewResponseSchema,
} from '../../packages/contracts/dist/index.js';

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
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
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
    for (const email of emails) {
      const generated = await connection.pool.query(
        'SELECT id FROM public."user" WHERE email = $1',
        [email],
      );
      for (const { id } of generated.rows)
        await connection.pool.query('DELETE FROM public."user" WHERE id = $1', [id]);
    }
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
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
  const state = await context.storageState(); // Memory only; never saved as an artifact.
  expect(state.origins).toHaveLength(0);
  expect(state.cookies.every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);
  const fresh = await browser.newContext({ storageState: state });
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${origin}/app`);
  await expect(freshPage.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await freshPage.reload();
  await expect(freshPage).toHaveURL(`${origin}/sign-in`);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
  const fresh = await browser.newContext({ storageState: await context.storageState() });
  const freshPage = await fresh.newPage();
  await freshPage.goto(`${origin}/app`);
  await expect(freshPage.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toHaveCount(0);
});

test('wrong credentials and duplicate signup are generic; failed revocation and real outage are retryable', async ({
  page,
}) => {
  const email = await signup(page);
  // The heading precedes the mounted shelf GET. Stop only after that real
  // request settles: graceful shutdown can otherwise drain its keepalive
  // connection past this test's deadline, before Sign out is ever clicked.
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toHaveCount(0);
  await startApi();
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
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

async function seedCoffee(request, name) {
  const response = await request.post('/api/v1/coffees', {
    headers: { Origin: origin },
    data: coffeeCreateSchema.parse({
      name,
      roaster: 'Shell fixture roaster',
      country: 'Ethiopia',
      process: 'Washed',
      tastingNotes: ['Peach'],
    }),
  });
  expect(response.status()).toBe(201);
  return coffeeResponseSchema.parse(await response.json()).coffee;
}
async function seedBrew(request, coffeeId, index = 0) {
  const response = await request.post('/api/v1/brews', {
    headers: { Origin: origin },
    data: brewCreateSchema.parse({
      coffeeId,
      brewer: 'Shell fixture V60',
      grinder: 'Hand grinder',
      grindSetting: '22 clicks',
      doseGrams: 15,
      waterGrams: 250,
      waterTemperatureC: 93,
      totalBrewTimeSeconds: 180,
      brewedAt: new Date(Date.UTC(2026, 9, 8, 0, index)).toISOString(),
      overallScore: 0,
      pours: [{ waterGrams: 250, startTimeSeconds: 0 }],
    }),
  });
  expect(response.status()).toBe(201);
  return brewResponseSchema.parse(await response.json()).brew;
}

test('shell real empty destinations, anchors, direct links, reload, back/forward and keyboard', async ({
  page,
}) => {
  for (const route of ['/app', '/app/journal', '/app/gear', '/app/coffees/new']) {
    await page.goto(route);
    await expect(page).toHaveURL(`${origin}/sign-in`);
  }
  await signup(page);
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record a brew' })).toBeDisabled();
  await expect(
    page.getByText('Brew recording will be available in the next delivery.'),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary' });
  expect(await nav.getByRole('link').allTextContents()).toEqual(['Beans', 'Journal', 'Gear']);
  await nav.getByRole('link', { name: 'Journal' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Brew, learn, repeat' })).toBeVisible();
  await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Journal');
  await nav.getByRole('link', { name: 'Gear' }).click();
  await expect(
    page.getByRole('heading', { name: 'Saved equipment isn’t available yet' }),
  ).toBeVisible();
  await page.reload();
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Gear');
  await page.goBack();
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Journal');
  await page.goForward();
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Gear');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.goto('/app/journal');
  await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
});

test('shell real owned records persist, recent twenty boundary, zero score and account isolation', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000); // 42 real authenticated domain writes, not changed auth timeouts.
  const emailA = await signup(page);
  for (let i = 0; i < 21; i++) {
    const coffee = await seedCoffee(context.request, `Owner A shelf ${String(i).padStart(2, '0')}`);
    await seedBrew(context.request, coffee.id, i);
  }
  await page.reload();
  await expect(page.locator('.collection-list > li')).toHaveCount(20);
  await expect(page.getByText('Only the 20 most recent records are shown.')).toBeVisible();
  await expect(page.getByText('Owner A shelf 20', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.locator('.collection-list > li')).toHaveCount(20);
  await expect(page.locator('.brew-score').first()).toContainText('0.00/100');
  await expect(page.getByText('Only the 20 most recent records are shown.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  const emailB = await signup(page);
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
  const coffeeB = await seedCoffee(context.request, 'Owner B only coffee');
  await seedBrew(context.request, coffeeB.id);
  await page.reload();
  await expect(page.getByText('Owner B only coffee', { exact: true })).toBeVisible();
  await expect(page.getByText('Owner A shelf', { exact: false })).toHaveCount(0);
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.locator('.collection-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signin(page, emailA);
  await expect(page.getByText('Owner A shelf 20', { exact: true })).toBeVisible();
  await expect(page.getByText('Owner B only coffee', { exact: true })).toHaveCount(0);
  expect(emailA).not.toBe(emailB);
});

test('shell real revoked collection returns 401, clears content, and protected deep links recover from owned API outage', async ({
  page,
  context,
}) => {
  const email = await signup(page);
  await seedCoffee(context.request, 'Revoked private shelf');
  await page.reload();
  await expect(page.getByText('Revoked private shelf', { exact: true })).toBeVisible();
  await stopApi();
  await page.goto('/app/journal');
  await expect(
    page.getByRole('heading', { name: 'We can’t reach your account right now.' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await startApi();
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(page.getByText('Revoked private shelf', { exact: true })).toBeVisible();
  // Pause the collection before forwarding to the real API; no response/auth substitution.
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  await page.route('**/api/v1/brews?limit=20&offset=0', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Loading your brews');
  await connection.pool.query(
    'DELETE FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email = $1)',
    [email],
  );
  release();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByText('Revoked private shelf', { exact: true })).toHaveCount(0);
});

test('shell controlled collection fault simulations: pending, 500, malformed and stalled late retry', async ({
  page,
}) => {
  await signup(page);
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  await page.route('**/api/v1/coffees?limit=20&offset=0', async (route) => {
    await gate;
    await route.fulfill({ status: 500, body: 'private fault simulation' });
  });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Loading your coffees');
  release();
  await expect(page.locator('.collection [role="alert"]')).toContainText(
    'We couldn’t load your coffees',
  );
  await expect(page.getByText('No coffees yet', { exact: true })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/api/v1/coffees?limit=20&offset=0', (route) =>
    route.fulfill({ status: 200, body: '{bad' }),
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.collection [role="alert"]')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  let late;
  const stalled = new Promise((done) => {
    late = done;
  });
  await page.route('**/api/v1/coffees?limit=20&offset=0', async (route) => {
    await stalled;
    await route.fulfill({ status: 200, body: '{bad' }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('status')).toContainText('Loading your coffees');
  await expect(page.locator('.collection [role="alert"]')).toBeVisible({ timeout: 5000 });
  late();
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
});

test('shell rendered light/dark responsive states and long-copy layout evidence', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000); // Ten actual rendered viewport/theme combinations plus state captures.
  const errors = [];
  page.on('pageerror', () => errors.push('uncaught page error'));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console error');
  });
  await signup(page);
  await page.screenshot({ path: testInfo.outputPath('empty-beans.png'), fullPage: true });
  await page.goto('/app/journal');
  await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('empty-journal.png'), fullPage: true });
  const coffee = await seedCoffee(context.request, 'LongCoffeeLabel'.repeat(12));
  await seedBrew(context.request, coffee.id);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      for (const [route, state] of [
        ['/app', 'beans'],
        ['/app/journal', 'journal'],
        ['/app/gear', 'gear'],
      ]) {
        await page.goto(route);
        await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
        if (state === 'beans')
          await expect(page.getByText(coffee.name, { exact: true })).toBeVisible();
        if (state === 'journal')
          await expect(page.locator('.brew-score')).toContainText('0.00/100');
        if (state === 'beans' && width === 390) {
          const colors = await page.evaluate(() => {
            const main = getComputedStyle(document.querySelector('main'));
            const secondary = getComputedStyle(document.querySelector('.collection-note'));
            const active = getComputedStyle(document.querySelector('[aria-current="page"]'));
            const body = getComputedStyle(document.body);
            return {
              text: main.color,
              secondary: secondary.color,
              background: body.backgroundColor,
              activeText: active.color,
              activeBackground: active.backgroundColor,
              focus: active.borderBottomColor,
            };
          });
          const luminance = (rgb) => {
            const values = rgb
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((value) => value / 255)
              .map((value) =>
                value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
              );
            return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
          };
          const contrast = (a, b) =>
            (Math.max(luminance(a), luminance(b)) + 0.05) /
            (Math.min(luminance(a), luminance(b)) + 0.05);
          const ratios = {
            body: contrast(colors.text, colors.background),
            secondary: contrast(colors.secondary, colors.background),
            activeText: contrast(colors.activeText, colors.activeBackground),
            activeIndicator: contrast(colors.focus, colors.activeBackground),
          };
          expect(ratios.body).toBeGreaterThanOrEqual(4.5);
          expect(ratios.secondary).toBeGreaterThanOrEqual(4.5);
          expect(ratios.activeText).toBeGreaterThanOrEqual(4.5);
          expect(ratios.activeIndicator).toBeGreaterThanOrEqual(3);
          await testInfo.attach(`rendered-contrast-${colorScheme}`, {
            body: JSON.stringify({ colors, ratios }, null, 2),
            contentType: 'application/json',
          });
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        expect(await page.getByRole('main').count()).toBe(1);
        expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
        for (const link of await page.getByRole('navigation').getByRole('link').all()) {
          const box = await link.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({
          path: testInfo.outputPath(`${state}-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 400 });
  await page.goto('/app');
  await expect(page.getByText(coffee.name, { exact: true })).toBeVisible();
  // Explicit CSS zoom layout stress; native browser zoom remains a reviewer check.
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Gear', exact: true }).focus();
  await page.screenshot({
    path: testInfo.outputPath('css-200-percent-small-height-focus.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.goto('/app');
  let release;
  const pending = new Promise((done) => {
    release = done;
  });
  await page.route('**/api/v1/coffees?limit=20&offset=0', async (route) => {
    await pending;
    await route.fulfill({ status: 500, body: 'controlled fault' });
  });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Loading your coffees');
  await page.screenshot({ path: testInfo.outputPath('controlled-loading.png'), fullPage: true });
  release();
  await expect(page.locator('.collection [role="alert"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('controlled-error.png'), fullPage: true });
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText(coffee.name, { exact: true })).toBeVisible();
  // Fault simulation's 500 produces an expected console network diagnostic.
  expect(errors.filter((error) => error === 'uncaught page error')).toHaveLength(0);
});

for (const width of [320, 360, 390, 430, 1280]) {
  test(`labels, keyboard, invalid input, touch targets and overflow at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/sign-in');
    await page.screenshot({ path: testInfo.outputPath(`sign-in-${width}.png`) });
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
    await page.screenshot({ path: testInfo.outputPath(`sign-up-${width}.png`) }); // Invalid throwaway fields only, no identity/cookie dumps.
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
    await expect(page.getByRole('heading', { name: 'Your coffee shelf' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`) });
    await page.getByRole('button', { name: 'Sign out', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${origin}/sign-in`);
  });
}

async function openManual(page) {
  await page.getByRole('link', { name: 'Add coffee', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a coffee' })).toBeVisible();
  await expect(page.getByLabel('Roaster (required)', { exact: true })).toHaveValue('');
  await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveText('Beans');
}
async function fillManual(page, name = 'Manual private coffee') {
  await page.getByLabel('Roaster (required)', { exact: true }).fill('  Manual roaster  ');
  await page.getByLabel('Coffee name (required)', { exact: true }).fill(`  ${name}  `);
}
async function ownedCoffeeCount(email) {
  const result = await connection.pool.query(
    'SELECT count(*)::int AS count FROM cupmemo.coffees WHERE owner_id IN (SELECT id FROM public."user" WHERE email = $1)',
    [email],
  );
  return result.rows[0].count;
}

test('manual real browser minimal and full optional writes persist through reload and fresh signin with no replay', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const email = await signup(page);
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
  let posts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${origin}/api/v1/coffees`) posts++;
  });
  await openManual(page);
  await fillManual(page);
  const created = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/v1/coffees` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(`${origin}/app`);
  await expect(page.getByText('Manual private coffee', { exact: true })).toBeVisible();
  expect(posts).toBe(1);
  expect(await ownedCoffeeCount(email)).toBe(1);
  await page.reload();
  await expect(page.getByText('Manual private coffee', { exact: true })).toBeVisible();
  const minimalList = await context.request.get('/api/v1/coffees');
  const minimalCoffee = (await minimalList.json()).coffees[0];
  expect(minimalCoffee).toMatchObject({
    roaster: 'Manual roaster',
    name: 'Manual private coffee',
    country: null,
    region: null,
    producer: null,
    farmStation: null,
    variety: null,
    process: null,
    elevation: null,
    roastDate: null,
    tastingNotes: [],
  });
  await openManual(page);
  await page.reload();
  await expect(page.getByLabel('Coffee name (required)', { exact: true })).toHaveValue('');
  expect(posts).toBe(1);
  await fillManual(page, 'Full optional coffee');
  for (const [label, value] of [
    ['Country', 'Ethiopia'],
    ['Region', 'Sidama'],
    ['Producer', 'Smallholders'],
    ['Farm / station', 'Station'],
    ['Variety', '74158'],
    ['Process', 'Washed'],
    ['Elevation', '2,200–2,350 m'],
  ])
    await page.getByLabel(`${label} (optional)`, { exact: true }).fill(` ${value} `);
  await page.getByLabel('Roast date (optional)', { exact: true }).fill('2028-02-29');
  await page
    .getByLabel('Roaster tasting notes (optional)', { exact: true })
    .fill(' Peach \n\nFloral\nPeach, citrus');
  await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app`);
  await expect(page.getByText('Full optional coffee', { exact: true })).toBeVisible();
  const list = await context.request.get('/api/v1/coffees');
  expect(list.status()).toBe(200);
  const full = (await list.json()).coffees.find((coffee) => coffee.name === 'Full optional coffee');
  expect(full).toMatchObject({
    country: 'Ethiopia',
    region: 'Sidama',
    producer: 'Smallholders',
    farmStation: 'Station',
    variety: '74158',
    process: 'Washed',
    elevation: '2,200–2,350 m',
    roastDate: '2028-02-29',
    tastingNotes: ['Floral', 'Peach', 'Peach, citrus'],
  });
  expect(posts).toBe(2);
  expect(await ownedCoffeeCount(email)).toBe(2);
  await page.screenshot({
    path: testInfo.outputPath('manual-real-saved-shelf.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  const fresh = await browser.newContext({ baseURL: origin });
  const freshPage = await fresh.newPage();
  await signin(freshPage, email);
  await expect(freshPage.getByText('Full optional coffee', { exact: true })).toBeVisible();
  await fresh.close();
});

test('manual native cancel and ordinary nav/back unload dialogs retain or deliberately discard without writes', async ({
  page,
}) => {
  const email = await signup(page);
  await openManual(page);
  await fillManual(page);
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('Discard');
    return dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Coffee name (required)', { exact: true })).toHaveValue(
    '  Manual private coffee  ',
  );
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    return dialog.dismiss();
  });
  await page.getByRole('link', { name: 'Beans', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app/coffees/new`);
  const backWarning = page.waitForEvent('dialog');
  page.once('dialog', (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    return dialog.dismiss();
  });
  // A dismissed back navigation never commits: don't wait for a nonexistent load.
  await page.evaluate(() => window.history.back());
  await backWarning;
  await expect(page).toHaveURL(`${origin}/app/coffees/new`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app`);
  expect(await ownedCoffeeCount(email)).toBe(0);
  await openManual(page);
  page.once('dialog', () => {
    throw new Error('Pristine cancel must not show a dialog');
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app`);
});

test('manual real account isolation and revoked session POST401 clear the draft with no write', async ({
  page,
  context,
}) => {
  const emailA = await signup(page);
  await openManual(page);
  await fillManual(page, 'Account A coffee');
  await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/app`);
  await openManual(page);
  await fillManual(page, 'Private unfinished A');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  const emailB = await signup(page);
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
  expect((await (await context.request.get('/api/v1/coffees')).json()).coffees).toHaveLength(0);
  await openManual(page);
  await fillManual(page, 'Revoked must not save');
  await connection.pool.query(
    'DELETE FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email = $1)',
    [emailB],
  );
  const denied = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/v1/coffees` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
  expect((await denied).status()).toBe(401);
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await expect(page.getByLabel('Roaster (required)', { exact: true })).toHaveCount(0);
  expect(await ownedCoffeeCount(emailB)).toBe(0);
  expect(await ownedCoffeeCount(emailA)).toBe(1);
  const storage = await page.evaluate(() => ({
    keys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage),
    broadcast: JSON.parse(localStorage.getItem('better-auth.message') || '{}'),
  }));
  // Existing pinned official auth cross-tab notification contains no credentials/draft.
  expect(storage.keys).toEqual(['better-auth.message']);
  expect(storage.sessionKeys).toEqual([]);
  expect(Object.keys(storage.broadcast).sort()).toEqual(['clientId', 'data', 'event', 'timestamp']);
  expect(Object.keys(storage.broadcast.data)).toEqual(['trigger']);
});

test('manual owned API outage produces uncertainty and check-shelf recovery without replay', async ({
  page,
}) => {
  const email = await signup(page);
  await openManual(page);
  await fillManual(page);
  await stopApi();
  try {
    await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
    await expect(page.locator('.coffee-form [role="alert"]')).toContainText('may have been saved');
    await expect(
      page.getByRole('button', { name: 'Add coffee to shelf', exact: true }),
    ).toBeDisabled();
  } finally {
    await startApi();
  }
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'Check coffee shelf', exact: true }).click();
  await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
  expect(await ownedCoffeeCount(email)).toBe(0);
  await openManual(page);
  await page.reload();
  await expect(page.getByLabel('Coffee name (required)', { exact: true })).toHaveValue('');
  expect(await ownedCoffeeCount(email)).toBe(0);
});

for (const fault of [400, 403, 500, 'malformed201', 'stalled-late']) {
  test(`manual LABELED POST fault simulation ${fault} never creates false success`, async ({
    page,
  }, testInfo) => {
    const email = await signup(page);
    await openManual(page);
    await fillManual(page);
    let release;
    const gate = new Promise((done) => {
      release = done;
    });
    let posts = 0;
    await page.route('**/api/v1/coffees', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts++;
      if (fault === 'stalled-late') await gate;
      await route
        .fulfill({
          status: typeof fault === 'number' ? fault : 201,
          contentType: 'application/json',
          body: '{"controlledFault":true}',
        })
        .catch(() => {});
    });
    await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
    if (fault === 'stalled-late') {
      await expect(
        page.getByRole('button', { name: 'Adding coffee…', exact: true }),
      ).toBeDisabled();
      await expect(page.getByLabel('Roaster (required)', { exact: true })).toHaveAttribute(
        'readonly',
        '',
      );
      await page.screenshot({
        path: testInfo.outputPath('manual-controlled-pending.png'),
        fullPage: true,
      });
      page.once('dialog', (dialog) => {
        expect(dialog.message()).toContain('cannot roll back');
        return dialog.dismiss();
      });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await expect(page.locator('.coffee-form [role="alert"]')).toContainText(
      fault === 400 || fault === 403 ? 'not added' : 'may have been saved',
    );
    await page.screenshot({
      path: testInfo.outputPath(`manual-controlled-${fault}.png`),
      fullPage: true,
    });
    if (fault === 400 || fault === 403) {
      await expect(
        page.getByRole('button', { name: 'Add coffee to shelf', exact: true }),
      ).toBeEnabled();
    } else {
      await expect(
        page.getByRole('button', { name: 'Add coffee to shelf', exact: true }),
      ).toBeDisabled();
      await page
        .getByLabel('Coffee name (required)', { exact: true })
        .fill('Changed uncertain draft');
      await page.locator('form.coffee-form').evaluate((form) => form.requestSubmit());
      expect(posts).toBe(1);
    }
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(page).toHaveURL(`${origin}/app/coffees/new`);
    expect(await ownedCoffeeCount(email)).toBe(0);
  });
}

test('manual rendered form light/dark phone and desktop, keyboard, long optional values and validation evidence', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000); // New ten-combination rendered form test, unchanged existing test deadlines.
  const errors = [];
  page.on('pageerror', () => errors.push('uncaught page error'));
  await signup(page);
  await openManual(page);
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const width of [320, 360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 700 });
      await page.screenshot({
        path: testInfo.outputPath(`manual-empty-${width}-${colorScheme}.png`),
        fullPage: true,
      });
      await page.getByLabel('Roaster (required)', { exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Coffee name (required)', { exact: true })).toBeFocused();
      await fillManual(page, 'LongCoffeeLabel'.repeat(12));
      await page
        .getByLabel('Producer (optional)', { exact: true })
        .fill('Long optional producer '.repeat(20));
      await page.getByLabel('Elevation (optional)', { exact: true }).fill('2,200–2,350 m');
      await page
        .getByLabel('Roaster tasting notes (optional)', { exact: true })
        .fill(' Peach \nPeach');
      await page.getByRole('button', { name: 'Add coffee to shelf', exact: true }).click();
      await expect(
        page.getByLabel('Roaster tasting notes (optional)', { exact: true }),
      ).toBeFocused();
      await expect(page.locator('.coffee-form [role="alert"]')).toContainText('Check');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(await page.getByRole('main').count()).toBe(1);
      expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1);
      for (const control of await page.locator('form input, form textarea, form button').all()) {
        expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
      await page.screenshot({
        path: testInfo.outputPath(`manual-filled-errors-${width}-${colorScheme}.png`),
        fullPage: true,
      });
      if (width === 390) {
        const colors = await page.evaluate(() => {
          const input = getComputedStyle(document.querySelector('#roaster'));
          const help = getComputedStyle(document.querySelector('#notes-help'));
          const error = getComputedStyle(document.querySelector('.form-error'));
          return {
            text: input.color,
            surface: input.backgroundColor,
            border: input.borderTopColor,
            secondary: help.color,
            error: error.color,
            background: getComputedStyle(document.body).backgroundColor,
          };
        });
        const luminance = (rgb) => {
          const values = rgb
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((value) => value / 255)
            .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const contrast = (a, b) =>
          (Math.max(luminance(a), luminance(b)) + 0.05) /
          (Math.min(luminance(a), luminance(b)) + 0.05);
        const ratios = {
          inputText: contrast(colors.text, colors.surface),
          inputBoundary: contrast(colors.border, colors.surface),
          optionalHelp: contrast(colors.secondary, colors.background),
          error: contrast(colors.error, colors.background),
        };
        expect(ratios.inputText).toBeGreaterThanOrEqual(4.5);
        expect(ratios.inputBoundary).toBeGreaterThanOrEqual(3);
        expect(ratios.optionalHelp).toBeGreaterThanOrEqual(4.5);
        expect(ratios.error).toBeGreaterThanOrEqual(4.5);
        await testInfo.attach(`manual-contrast-${colorScheme}`, {
          body: JSON.stringify({ colors, ratios }, null, 2),
          contentType: 'application/json',
        });
      }
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await openManual(page);
    }
  }
  expect(errors).toHaveLength(0);
});
