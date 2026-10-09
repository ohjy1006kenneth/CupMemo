import { writeFile } from 'node:fs/promises';
import {
  brewCreateSchema,
  brewListResponseSchema,
  brewResponseSchema,
  coffeeListResponseSchema,
  coffeeCreateSchema,
  coffeeResponseSchema,
} from '../../packages/contracts/dist/index.js';
/* global document, window, getComputedStyle */

// Registered in the original auth suite: one real port-owning API/DB fixture, no duplicate service owner.
export function registerBrewFlows({
  test,
  expect,
  signup,
  signin,
  seedBrew,
  startApi,
  stopApi,
  getConnection,
  origin,
}) {
  async function seedCoffee(request, name) {
    const response = await request.post('/api/v1/coffees', {
      headers: { Origin: origin },
      data: coffeeCreateSchema.parse({ name, roaster: 'SEY' }),
    });
    expect(response.status()).toBe(201);
    return coffeeResponseSchema.parse(await response.json()).coffee;
  }
  async function choose(page, coffeeName) {
    await page.goto('/app/brews/new');
    await expect(page.getByRole('heading', { name: 'Choose a coffee' })).toBeVisible();
    await page.getByRole('button', { name: `SEY · ${coffeeName}`, exact: true }).click();
    // Validated mounted latest response, not SSR heading, is the readiness boundary.
    await expect(page.getByLabel('Grind setting (required)')).toHaveValue(/.+/);
    await expect(page.getByRole('button', { name: 'Continue to tasting' })).toBeEnabled();
  }
  async function tasting(page) {
    await page.getByRole('button', { name: 'Continue to tasting' }).click();
    await expect(page.getByRole('heading', { name: 'How did it taste?' })).toBeVisible();
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue('');
  }
  async function list(request, coffeeId) {
    const response = await request.get(`/api/v1/brews?coffeeId=${coffeeId}&limit=20&offset=0`);
    expect(response.status()).toBe(200);
    return brewListResponseSchema.parse(await response.json()).brews;
  }
  async function count(email) {
    return Number(
      (
        await getConnection().pool.query(
          'SELECT count(*) FROM cupmemo.brews WHERE owner_id IN (SELECT id FROM public."user" WHERE email=$1)',
          [email],
        )
      ).rows[0].count,
    );
  }
  async function save(page, score) {
    await page.getByLabel('Overall score /100 (required)').fill(score);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/brews') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save brew & tasting' }).click();
    const result = await response;
    expect(result.status()).toBe(201);
    const brew = brewResponseSchema.parse(await result.json()).brew;
    await expect(page).toHaveURL(`${origin}/app/journal`);
    await expect(
      page.locator('.brew-score').filter({ hasText: `${Number(score).toFixed(2)}/100` }),
    ).toBeVisible();
    return brew;
  }
  test('brew real manual prerequisite, overall-only save, latest second brew, optional zero quarters and durable Journal', async ({
    page,
    context,
    browser,
  }) => {
    const email = await signup(page);
    await page.getByRole('link', { name: 'Record a brew' }).click();
    await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Add coffee', exact: true }).click();
    await page.getByLabel('Roaster (required)').fill('SEY');
    await page.getByLabel('Coffee name (required)').fill('Brew prerequisite');
    await page.getByRole('button', { name: 'Add coffee to shelf' }).click();
    await expect(page.getByRole('heading', { name: 'Brew prerequisite' })).toBeVisible();
    const shelf = await context.request.get('/api/v1/coffees?limit=20&offset=0');
    const coffee = coffeeListResponseSchema.parse(await shelf.json()).coffees[0];
    await choose(page, coffee.name);
    await expect(page.getByText(/Starter recipe/)).toBeVisible();
    await page.getByRole('button', { name: 'Increase Temperature (°C)' }).click();
    await page.getByRole('button', { name: 'Move pour 1 later' }).click();
    await page.getByRole('button', { name: 'Scale target' }).click();
    await expect(page.getByLabel('Pour 1 incremental water (g)')).toHaveValue('100');
    await expect(page.getByLabel('Pour 1 start (seconds)')).toHaveValue('0');
    await tasting(page);
    await expect(page.getByText('Not rated')).toHaveCount(3);
    let posts = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/v1/brews') && r.method() === 'POST') posts++;
    });
    const first = await save(page, '87.25');
    expect(posts).toBe(1);
    expect(await count(email)).toBe(1);
    expect(first).toMatchObject({
      acidity: null,
      body: null,
      aftertaste: null,
      tastingMode: 'quick',
      notes: null,
      tastingTags: [],
      waterTemperatureC: 94,
    });
    await page.reload();
    await expect(page.locator('.brew-score').filter({ hasText: '87.25/100' })).toBeVisible();
    await choose(page, coffee.name);
    await expect(page.getByText('Based on your latest brew')).toBeVisible();
    await expect(page.getByLabel('Temperature (°C)', { exact: true })).toHaveValue('94');
    await expect(page.getByLabel('Pour 1 incremental water (g)')).toHaveValue('100');
    await expect(page.getByLabel('Pour 2 incremental water (g)')).toHaveValue('50');
    await page.getByLabel('Grind setting (required)').fill('6.3');
    await expect(page.getByText(/Changed:/)).toContainText('6.2 → 6.3');
    await tasting(page);
    await expect(page.getByText('Not rated')).toHaveCount(3);
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('');
    await page.getByRole('button', { name: 'Add Acidity rating' }).click();
    await expect(page.getByLabel('Acidity quality /10')).toHaveValue('0');
    await page.getByRole('button', { name: 'Add Body rating' }).click();
    await page.getByLabel('Body quality /10').fill('8.25');
    await page.getByRole('button', { name: 'Add Aftertaste rating' }).click();
    await page.getByLabel('Aftertaste quality /10').fill('7.75');
    await page.getByRole('button', { name: 'Peach', exact: true }).click();
    await page.getByLabel('Tasting notes (optional)').fill('  Bright, sweet finish  ');
    await page.getByRole('button', { name: 'Back to recipe' }).click();
    await expect(page.getByLabel('Grind setting (required)')).toHaveValue('6.3');
    await page.getByRole('button', { name: 'Continue to tasting' }).click();
    await expect(page.getByLabel('Body quality /10')).toHaveValue('8.25');
    const second = await save(page, '0');
    expect(posts).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(await count(email)).toBe(2);
    expect(second).toMatchObject({
      overallScore: 0,
      acidity: 0,
      body: 8.25,
      aftertaste: 7.75,
      tastingTags: ['Peach'],
      notes: 'Bright, sweet finish',
    });
    const brews = await list(context.request, coffee.id);
    expect(brews.find((b) => b.id === first.id)).toEqual(first);
    expect(brews.find((b) => b.id === second.id)).toEqual(second);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await signin(freshPage, email);
    await freshPage.goto(`${origin}/app/journal`);
    await expect(freshPage.locator('.brew-score').filter({ hasText: '0.00/100' })).toBeVisible();
    await freshPage.reload();
    await expect(freshPage.locator('.brew-score').filter({ hasText: '87.25/100' })).toBeVisible();
    await fresh.close();
  });
  test('brew real sensory latest retains custom equipment and precise recipe only', async ({
    page,
    context,
  }) => {
    await signup(page);
    const coffee = await seedCoffee(context.request, 'Sensory source');
    const prior = await seedBrew(context.request, coffee.id);
    const changed = await context.request.patch(`/api/v1/brews/${prior.id}`, {
      headers: { Origin: origin },
      data: {
        tastingMode: 'sensory',
        overallScore: 99,
        flavor: 8.25,
        acidity: 0,
        notes: 'Prior tasting',
        tastingTags: ['Peach'],
        brewer: 'Custom dripper',
        grinder: 'Custom grinder',
        grindSetting: '22 clicks + mark',
        doseGrams: 15.29,
        waterGrams: 250.29,
        waterTemperatureC: 92.29,
        pours: [{ waterGrams: 250.29, startTimeSeconds: 12 }],
      },
    });
    expect(changed.status()).toBe(200);
    await choose(page, coffee.name);
    await expect(page.getByLabel('Other brewer (required)')).toHaveValue('Custom dripper');
    await expect(page.getByLabel('Other grinder (required)')).toHaveValue('Custom grinder');
    await expect(page.getByLabel('Coffee dose (g)', { exact: true })).toHaveValue('15.29');
    await expect(page.getByLabel('Pour 1 start (seconds)')).toHaveValue('12');
    await tasting(page);
    await expect(page.getByText('Not rated')).toHaveCount(3);
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Peach', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await list(context.request, coffee.id)).toHaveLength(1);
  });
  test('brew real page-two selection is bounded and does not retain first page', async ({
    page,
    context,
  }) => {
    await signup(page);
    for (let i = 0; i < 21; i++)
      await seedCoffee(context.request, `Paging ${String(i).padStart(2, '0')}`);
    await page.goto('/app/brews/new');
    await expect(page.getByRole('button', { name: 'SEY · Paging 20', exact: true })).toBeVisible();
    await expect(page.locator('.brew-choice')).toHaveCount(20);
    await page.getByRole('button', { name: 'Next coffees' }).click();
    await expect(page.getByRole('button', { name: 'SEY · Paging 00', exact: true })).toBeVisible();
    await expect(page.locator('.brew-choice')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'SEY · Paging 20', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next coffees' })).toBeDisabled();
    await page.getByRole('button', { name: 'SEY · Paging 00', exact: true }).click();
    await expect(page.getByLabel('Grind setting (required)')).toHaveValue('6.2');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  test('brew real cross-account selection privacy, foreign POST404, and new mounted draft does not leak', async ({
    page,
    context,
  }) => {
    await signup(page);
    const a = await seedCoffee(context.request, 'Private A');
    const prior = await seedBrew(context.request, a.id);
    await choose(page, a.name);
    await tasting(page);
    await page.getByLabel('Tasting notes (optional)').fill('Unsubmitted private A');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signup(page);
    await page.goto('/app/brews/new');
    await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
    await expect(page.getByText(/Private A|Unsubmitted private A/)).toHaveCount(0);
    const payload = brewCreateSchema.parse({
      coffeeId: a.id,
      brewer: prior.brewer,
      grinder: prior.grinder,
      grindSetting: prior.grindSetting,
      doseGrams: prior.doseGrams,
      waterGrams: prior.waterGrams,
      waterTemperatureC: prior.waterTemperatureC,
      totalBrewTimeSeconds: prior.totalBrewTimeSeconds,
      brewedAt: new Date().toISOString(),
      overallScore: 0,
      pours: prior.pours.map(({ waterGrams, startTimeSeconds }) => ({
        waterGrams,
        startTimeSeconds,
      })),
    });
    const foreign = await context.request.post('/api/v1/brews', {
      headers: { Origin: origin },
      data: payload,
    });
    expect(foreign.status()).toBe(404);
    expect(await foreign.json()).toEqual({ message: 'Resource not found' });
    const b = await seedCoffee(context.request, 'Private B');
    await choose(page, b.name);
    await tasting(page);
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  test('brew real session revocation during tasting clears private draft on POST401 with no row', async ({
    page,
    context,
  }) => {
    const email = await signup(page);
    const coffee = await seedCoffee(context.request, 'Revoke selected');
    await choose(page, coffee.name);
    await tasting(page);
    await page.getByLabel('Overall score /100 (required)').fill('0');
    await getConnection().pool.query(
      'DELETE FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email=$1)',
      [email],
    );
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/brews') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save brew & tasting' }).click();
    expect((await response).status()).toBe(401);
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveCount(0);
    expect(await count(email)).toBe(0);
  });
  test('brew real exact selected coffee deletion yields retained404 and explicit reselect', async ({
    page,
    context,
  }) => {
    const email = await signup(page);
    const coffee = await seedCoffee(context.request, 'Deleted selection');
    await choose(page, coffee.name);
    await tasting(page);
    await page.getByLabel('Overall score /100 (required)').fill('87.25');
    const removed = await context.request.delete(`/api/v1/coffees/${coffee.id}`, {
      headers: { Origin: origin },
    });
    expect(removed.status()).toBe(204);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/brews') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save brew & tasting' }).click();
    expect((await response).status()).toBe(404);
    await expect(page.locator('.brew-entry [role="alert"]')).toContainText('coffee is unavailable');
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue('87.25');
    expect(await count(email)).toBe(0);
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Change coffee' }).click();
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue('87.25');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Change coffee' }).click();
    await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
  });
  test('brew native draft warnings, cancel decline/accept, reload reset and no write/replay', async ({
    page,
    context,
  }) => {
    const email = await signup(page);
    const coffee = await seedCoffee(context.request, 'Draft safety');
    await choose(page, coffee.name);
    await tasting(page);
    await page.getByLabel('Overall score /100 (required)').fill('87.25');
    await page.getByLabel('Tasting notes (optional)').fill('Draft');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('Draft');
    let type = '';
    page.once('dialog', async (d) => {
      type = d.type();
      await d.dismiss();
    });
    await page.getByRole('link', { name: 'Beans', exact: true }).click();
    expect(type).toBe('beforeunload');
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('Draft');
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Choose a coffee' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SEY · Draft safety' })).toBeVisible();
    expect(await count(email)).toBe(0);
    await page.getByRole('button', { name: 'SEY · Draft safety' }).click();
    await expect(page.getByLabel('Grind setting (required)')).toHaveValue('6.2');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(`${origin}/app`);
    expect(await count(email)).toBe(0);
  });
  test('brew real owned API outage after mounted validated recipe settles is uncertain and never replays', async ({
    page,
    context,
  }, testInfo) => {
    const email = await signup(page);
    const coffee = await seedCoffee(context.request, 'Outage selection');
    await choose(page, coffee.name);
    await tasting(page);
    await page.getByLabel('Overall score /100 (required)').fill('0');
    const timing = { readyAt: new Date().toISOString(), stopStartedAt: new Date().toISOString() };
    try {
      await stopApi();
      timing.stoppedAt = new Date().toISOString();
      timing.clickStartedAt = new Date().toISOString();
      await page.getByRole('button', { name: 'Save brew & tasting' }).click();
      await expect(page.locator('.brew-entry [role="alert"]')).toContainText('may have been saved');
      timing.uncertainAt = new Date().toISOString();
      await page.getByLabel('Overall score /100 (required)').fill('99');
      await expect(page.getByRole('button', { name: 'Save brew & tasting' })).toBeDisabled();
    } finally {
      await startApi();
      timing.restoredAt = new Date().toISOString();
      await writeFile(
        testInfo.outputPath('owned-outage-timing.json'),
        JSON.stringify(timing, null, 2),
      );
    }
    expect(await count(email)).toBe(0);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('link', { name: 'Check journal' }).click();
    await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
    await page.reload();
    expect(await count(email)).toBe(0);
  });
  for (const fault of ['400', '403', '500', 'malformed201', 'mismatched201', 'stalled-late'])
    test(`brew LABELED controlled write fault ${fault} (not happy/auth/ownership)`, async ({
      page,
      context,
    }, testInfo) => {
      const email = await signup(page);
      const coffee = await seedCoffee(context.request, `Fault ${fault}`);
      await choose(page, coffee.name);
      await tasting(page);
      await page.getByLabel('Overall score /100 (required)').fill('87.25');
      let calls = 0,
        release;
      await page.route('**/api/v1/brews', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        calls++;
        if (fault === 'stalled-late')
          await new Promise((done) => {
            release = done;
          });
        const payload = route.request().postDataJSON();
        const brew = {
          ...payload,
          coffeeId: '00000000-0000-4000-8000-000000000099',
          id: '00000000-0000-4000-8000-000000000098',
          pours: payload.pours.map((p, position) => ({ ...p, position })),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        try {
          await route.fulfill({
            status: /^\d+$/.test(fault) ? Number(fault) : 201,
            contentType: 'application/json',
            body: JSON.stringify(
              fault === 'mismatched201' ? { brew } : { malformed: 'LABELED fault' },
            ),
          });
        } catch {
          if (fault !== 'stalled-late') throw new Error('Controlled fulfillment failed');
        }
      });
      await page.getByRole('button', { name: 'Save brew & tasting' }).click();
      await expect(page.locator('.brew-entry [role="alert"]')).toContainText(
        ['400', '403'].includes(fault) ? 'not saved' : 'may have been saved',
      );
      if (release) release();
      expect(calls).toBe(1);
      expect(await count(email)).toBe(0);
      await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue('87.25');
      await page.screenshot({ path: testInfo.outputPath(`brew-${fault}.png`), fullPage: true });
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  test('brew rendered responsive light/dark recipe and quick unset/zero with keyboard and numeric evidence', async ({
    page,
    context,
  }, testInfo) => {
    await signup(page);
    const coffee = await seedCoffee(context.request, 'Long coffee name '.repeat(10));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const colorScheme of ['light', 'dark'])
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: 740 });
        await page.emulateMedia({ colorScheme });
        await choose(page, coffee.name);
        await page
          .getByLabel('Grind setting (required)')
          .fill('6.2 marks, model-specific notation');
        await page.getByRole('button', { name: 'Move pour 1 later' }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByLabel('Pour 1 incremental water (g)')).toHaveValue('100');
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await page.screenshot({
          path: testInfo.outputPath(`brew-recipe-${width}-${colorScheme}.png`),
          fullPage: true,
        });
        await tasting(page);
        await page.screenshot({
          path: testInfo.outputPath(`brew-quick-unset-${width}-${colorScheme}.png`),
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Decrease overall score' }).click();
        await page.getByRole('button', { name: 'Add Acidity rating' }).click();
        for (const control of await page.locator('form input,form textarea,form button').all())
          expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await page.getByRole('button', { name: 'Save brew & tasting' }).focus();
        await page.screenshot({
          path: testInfo.outputPath(`brew-quick-zero-${width}-${colorScheme}.png`),
          fullPage: true,
        });
        if (width === 390) {
          const evidence = await page.evaluate(() => {
            const input = getComputedStyle(document.querySelector('#overallScore'));
            const body = getComputedStyle(document.body);
            const help = getComputedStyle(document.querySelector('#score-help'));
            return {
              inputText: input.color,
              inputSurface: input.backgroundColor,
              inputBorder: input.borderTopColor,
              background: body.backgroundColor,
              help: help.color,
            };
          });
          const luminance = (color) => {
            const v = color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((n) => n / 255)
              .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
            return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
          };
          const contrast = (a, b) =>
            (Math.max(luminance(a), luminance(b)) + 0.05) /
            (Math.min(luminance(a), luminance(b)) + 0.05);
          const ratios = {
            text: contrast(evidence.inputText, evidence.inputSurface),
            boundary: contrast(evidence.inputBorder, evidence.inputSurface),
            help: contrast(evidence.help, evidence.background),
          };
          expect(ratios.text).toBeGreaterThanOrEqual(4.5);
          expect(ratios.boundary).toBeGreaterThanOrEqual(3);
          expect(ratios.help).toBeGreaterThanOrEqual(4.5);
          await writeFile(
            testInfo.outputPath(`brew-contrast-${colorScheme}.json`),
            JSON.stringify({ evidence, ratios }, null, 2),
          );
        }
        page.once('dialog', (d) => d.accept());
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    expect(errors).toEqual([]);
  });
}
