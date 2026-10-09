import { writeFile } from 'node:fs/promises';
import {
  brewResponseSchema,
  brewListResponseSchema,
  coffeeResponseSchema,
} from '../../packages/contracts/dist/index.js';
/* global document, window, getComputedStyle, Response, ReadableStream, TextEncoder */

// Registered against the existing suite's ONE real API/database lifecycle.
export function registerHistoryFlows({
  test,
  expect,
  signup,
  signin,
  seedBrew,
  origin,
  startApi,
  stopApi,
  getConnection,
}) {
  const qualityKeys = [
    'fragranceAroma',
    'flavor',
    'aftertaste',
    'acidity',
    'body',
    'balance',
    'sweetness',
    'overallImpression',
  ];
  async function fixture(page, context) {
    const email = await signup(page);
    const r = await context.request.post('/api/v1/coffees', {
      headers: { Origin: origin },
      data: { name: 'History coffee', roaster: 'Actual roaster' },
    });
    expect(r.status()).toBe(201);
    const coffee = coffeeResponseSchema.parse(await r.json()).coffee;
    return { email, coffee, brew: await seedBrew(context.request, coffee.id) };
  }
  async function patch(request, id, data) {
    const r = await request.patch(`/api/v1/brews/${id}`, { headers: { Origin: origin }, data });
    expect(r.status()).toBe(200);
    return brewResponseSchema.parse(await r.json()).brew;
  }
  async function get(request, id) {
    const r = await request.get(`/api/v1/brews/${id}`);
    expect(r.status()).toBe(200);
    return brewResponseSchema.parse(await r.json()).brew;
  }
  async function list(request, offset = 0) {
    const r = await request.get(`/api/v1/brews?limit=20&offset=${offset}`);
    expect(r.status()).toBe(200);
    return brewListResponseSchema.parse(await r.json());
  }
  async function edit(page, id) {
    await page.goto(`/app/brews/${id}/tasting`);
    await expect(page.getByLabel('Overall score /100 (required)')).toBeVisible();
  }
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  async function save(page, id) {
    const request = page.waitForRequest(
      (r) => r.method() === 'PATCH' && r.url().endsWith(`/api/v1/brews/${id}`),
    );
    const response = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/brews/${id}`),
    );
    await button(page, 'Save changes').click();
    const r = await response;
    expect(r.status()).toBe(200);
    const brew = brewResponseSchema.parse(await r.json()).brew;
    await expect(page).toHaveURL(`${origin}/app/journal`);
    await expect(page.getByRole('link', { name: new RegExp(`View brew.*${id}`) })).toBeVisible();
    return { brew, delta: (await request).postDataJSON() };
  }
  test('history real initial action and >20 tied-date pages preserve actual API order and later-empty Previous', async ({
    page,
    context,
  }) => {
    await signup(page);
    await page.goto('/app/journal');
    await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record a brew', exact: true })).toHaveAttribute(
      'href',
      '/app/brews/new',
    );
    const r = await context.request.post('/api/v1/coffees', {
      headers: { Origin: origin },
      data: { name: 'Paging coffee', roaster: 'SEY' },
    });
    expect(r.status()).toBe(201);
    const coffee = coffeeResponseSchema.parse(await r.json()).coffee;
    for (let i = 0; i < 21; i++) {
      const b = await seedBrew(context.request, coffee.id, i);
      await patch(context.request, b.id, {
        brewedAt: '2026-10-08T01:02:03.123Z',
        overallScore: i === 20 ? 0 : 100,
      });
    }
    const first = await list(context.request);
    const second = await list(context.request, 20);
    expect(first.brews).toHaveLength(20);
    expect(second.brews).toHaveLength(1);
    expect(first.brews.map((b) => b.id)).toEqual(
      [...first.brews.map((b) => b.id)].sort().reverse(),
    );
    await page.reload();
    await expect(page.locator('.collection-list > li')).toHaveCount(20);
    expect(
      await page
        .getByRole('link', { name: /^View brew/ })
        .evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual(first.brews.map((b) => `/app/brews/${b.id}`));
    await button(page, 'Next').click();
    await expect(page.locator('.collection-list > li')).toHaveCount(1);
    await expect(
      page.getByRole('link', { name: new RegExp(`View brew.*${second.brews[0].id}`) }),
    ).toBeVisible();
    await expect(button(page, 'Next')).toBeDisabled();
    await button(page, 'Previous').click();
    await expect(page.locator('.collection-list > li')).toHaveCount(20);
    const deleted = await context.request.delete(`/api/v1/brews/${second.brews[0].id}`, {
      headers: { Origin: origin },
    });
    expect(deleted.status()).toBe(204);
    await button(page, 'Next').click();
    await expect(page.getByText('No brews on this page.', { exact: true })).toBeVisible();
    await expect(button(page, 'Previous')).toBeEnabled();
    await expect(page.getByText('No brews yet', { exact: true })).toHaveCount(0);
  });
  for (const full of [false, true])
    test(`history real detail ${full ? 'full8 custom quick retained' : 'overall-only null and zero'} and coffee context`, async ({
      page,
      context,
    }, info) => {
      const { brew, coffee } = await fixture(page, context);
      const original = await patch(
        context.request,
        brew.id,
        full
          ? {
              ...Object.fromEntries(qualityKeys.map((k, i) => [k, i === 0 ? 0 : 8.25])),
              tastingTags: ['Custom aroma'],
              notes: 'Written history notes',
              overallScore: 100,
            }
          : { overallScore: 0 },
      );
      await page.goto('/app/journal');
      await page.getByRole('link', { name: new RegExp(`View brew.*${brew.id}`) }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your brew');
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByText(coffee.name, { exact: true })).toBeVisible();
      await expect(page.getByText(coffee.roaster, { exact: true })).toBeVisible();
      await expect(
        page.getByText(`${original.overallScore.toFixed(2)} /100`, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Saved mode: quick', { exact: true })).toBeVisible();
      if (full) {
        await expect(page.getByText('0.00 /10', { exact: true })).toHaveCount(1);
        await expect(page.getByText('8.25 /10', { exact: true })).toHaveCount(7);
        await expect(page.getByText('Custom aroma', { exact: true })).toBeVisible();
      } else {
        await expect(page.getByText('Not rated', { exact: true })).toHaveCount(8);
        await expect(page.getByText('No tasting notes', { exact: true })).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath('history-detail.png'), fullPage: true });
      await expect(page.getByRole('link', { name: 'Edit brew', exact: true })).toHaveAttribute(
        'href',
        `/app/brews/${brew.id}/tasting`,
      );
    });
  test('history real both-panel recipe pours date and assessment save same ID then fresh signin/detail', async ({
    page,
    context,
    browser,
  }) => {
    const { email, brew, coffee } = await fixture(page, context);
    await edit(page, brew.id);
    let posts = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/v1/brews')) posts++;
    });
    await page.getByLabel('Overall score /100 (required)').fill('88.25');
    await page.getByLabel('Tasting notes (optional)').fill('Both panels');
    await button(page, 'Recipe').click();
    await page.getByLabel('Temperature (°C)', { exact: true }).fill('94');
    await page.getByLabel('Water (g)', { exact: true }).fill('255');
    await page.getByLabel('Pour 1 incremental water (g)').fill('255');
    await page.getByLabel('Brew date and time (local, required)').fill('2026-10-09T12:34:56');
    await button(page, 'Tasting').click();
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('Both panels');
    const { brew: saved, delta } = await save(page, brew.id);
    const utc = await page.evaluate(() => new Date(2026, 9, 9, 12, 34, 56).toISOString());
    expect(delta).toEqual({
      waterTemperatureC: 94,
      waterGrams: 255,
      pours: [{ waterGrams: 255, startTimeSeconds: 0 }],
      brewedAt: utc,
      overallScore: 88.25,
      notes: 'Both panels',
    });
    expect(saved).toMatchObject({
      id: brew.id,
      createdAt: brew.createdAt,
      coffeeId: coffee.id,
      grinder: brew.grinder,
      acidity: brew.acidity,
    });
    expect((await list(context.request)).brews).toHaveLength(1);
    expect(posts).toBe(0);
    await page.reload();
    await page.goto(`/app/brews/${brew.id}`);
    await expect(page.getByText('94°C', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const fresh = await browser.newContext({ baseURL: origin, timezoneId: 'UTC' });
    const p = await fresh.newPage();
    await signin(p, email);
    await edit(p, brew.id);
    await expect(p.getByLabel('Overall score /100 (required)')).toHaveValue('88.25');
    await button(p, 'Recipe').click();
    await expect(p.getByLabel('Pour 1 incremental water (g)')).toHaveValue('255');
    expect(await get(fresh.request, brew.id)).toEqual(saved);
    await fresh.close();
  });
  for (const timestamp of ['2026-10-08T01:02:03.123Z', '2026-11-01T06:30:00.789Z'])
    test(`history real unchanged timestamp ${timestamp} recipe delta preserves concurrent assessment`, async ({
      page,
      context,
      browser,
    }) => {
      const { email, brew } = await fixture(page, context);
      const original = await patch(context.request, brew.id, { brewedAt: timestamp });
      const local = await browser.newContext({ baseURL: origin, timezoneId: 'America/New_York' });
      const p = await local.newPage();
      await signin(p, email);
      await edit(p, brew.id);
      await button(p, 'Recipe').click();
      await button(p, 'Save changes').click();
      await expect(p.getByText('No changes to save.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      // A separate signin on the original page is a concurrent authenticated editor.
      await signin(page, email);
      await patch(context.request, brew.id, { overallScore: 99, notes: 'Concurrent assessment' });
      await p.getByLabel('Temperature (°C)', { exact: true }).fill('94');
      const { brew: saved, delta } = await save(p, brew.id);
      expect(delta).toEqual({ waterTemperatureC: 94 });
      expect(saved).toMatchObject({
        id: original.id,
        coffeeId: original.coffeeId,
        createdAt: original.createdAt,
        brewedAt: timestamp,
        overallScore: 99,
        notes: 'Concurrent assessment',
        pours: original.pours,
      });
      await local.close();
    });
  test('history real both-panel hidden invalid focus cancellation/refusal/reopen never POSTs', async ({
    page,
    context,
  }) => {
    const { brew } = await fixture(page, context);
    await edit(page, brew.id);
    let writes = 0;
    page.on('request', (r) => {
      if (['POST', 'PATCH'].includes(r.method()) && r.url().includes('/api/v1/brews')) writes++;
    });
    await button(page, 'Recipe').click();
    await page.getByLabel('Water (g)', { exact: true }).fill('255');
    await button(page, 'Tasting').click();
    await button(page, 'Save changes').click();
    await expect(page.getByLabel('Water (g)', { exact: true })).toBeFocused();
    await page.getByLabel('Water (g)', { exact: true }).fill('250');
    await button(page, 'Tasting').click();
    await button(page, 'Sensory Detail').click();
    await button(page, 'Add Flavor rating').click();
    await page.getByLabel('Flavor quality /10').fill('');
    await button(page, 'Quick rating').click();
    await button(page, 'Recipe').click();
    await button(page, 'Save changes').click();
    await expect(page.getByLabel('Flavor quality /10')).toBeFocused();
    page.once('dialog', (d) => d.dismiss());
    await button(page, 'Cancel changes').click();
    await expect(page.getByLabel('Flavor quality /10')).toHaveValue('');
    page.once('dialog', (d) => d.accept());
    await button(page, 'Cancel changes').click();
    await edit(page, brew.id);
    expect(await get(context.request, brew.id)).toEqual(brew);
    expect(writes).toBe(0);
  });
  test('history real two-user history/detail absent-or-foreign404 and invalid route no lookup', async ({
    page,
    context,
  }) => {
    const { brew } = await fixture(page, context);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signup(page);
    await page.goto('/app/journal');
    await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
    for (const id of [brew.id, '00000000-0000-4000-8000-000000000099']) {
      await page.goto(`/app/brews/${id}`);
      await expect(page.locator('.brew-detail [role="alert"]')).toHaveText(
        'This brew is unavailable.',
      );
      await expect(page.getByRole('link', { name: 'Edit brew', exact: true })).toHaveCount(0);
    }
    const calls = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/brews/')) calls.push(r.url());
    });
    await page.goto('/app/brews/not-a-uuid');
    await expect(page.locator('.brew-entry [role="alert"]')).toHaveText(
      'This brew is unavailable.',
    );
    expect(calls).toEqual([]);
  });
  test('history real mounted detail coffee revoked401 hides all private data', async ({
    page,
    context,
  }) => {
    const { email, brew } = await fixture(page, context);
    // LABELED coffee503 exposes Retry; the later revoked401 is real Fastify auth.
    await page.route(`**/api/v1/coffees/${brew.coffeeId}`, (route) =>
      route.fulfill({ status: 503, body: '{}' }),
    );
    await page.goto(`/app/brews/${brew.id}`);
    await expect(button(page, 'Retry coffee context')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit brew', exact: true })).toBeVisible();
    await getConnection().pool.query(
      'DELETE FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email=$1)',
      [email],
    );
    await page.unrouteAll({ behavior: 'wait' });
    const response = page.waitForResponse((r) =>
      r.url().endsWith(`/api/v1/coffees/${brew.coffeeId}`),
    );
    await button(page, 'Retry coffee context').click();
    expect((await response).status()).toBe(401);
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(page.getByText('History coffee', { exact: true })).toHaveCount(0);
  });
  for (const fault of ['pagemismatch', 'malformed'])
    test(`history LABELED GET ${fault} hides rows and deliberate retry restores real page`, async ({
      page,
      context,
    }) => {
      const { brew } = await fixture(page, context);
      await page.route('**/api/v1/brews?limit=20&offset=0', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            fault === 'pagemismatch'
              ? { brews: [brew], pagination: { limit: 20, offset: 20, hasMore: false } }
              : {},
          ),
        }),
      );
      await page.goto('/app/journal');
      await expect(page.locator('.collection [role="alert"]')).toContainText('couldn’t load');
      await expect(page.getByRole('link', { name: /^View brew/ })).toHaveCount(0);
      await page.unrouteAll({ behavior: 'wait' });
      await button(page, 'Try again').click();
      await expect(
        page.getByRole('link', { name: new RegExp(`View brew.*${brew.id}`) }),
      ).toBeVisible();
    });
  test('history real owned outage after settled detail then recipe uncertain and fresh read recovery', async ({
    page,
    context,
  }, info) => {
    const { brew } = await fixture(page, context);
    await page.goto(`/app/brews/${brew.id}`);
    await expect(page.getByText('History coffee', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Edit brew', exact: true }).click();
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue(
      String(brew.overallScore),
    );
    await button(page, 'Recipe').click();
    const times = { ready: new Date().toISOString() };
    await page.getByLabel('Temperature (°C)', { exact: true }).fill('94');
    try {
      times.stopStarted = new Date().toISOString();
      await stopApi();
      times.stopped = new Date().toISOString();
      await button(page, 'Save changes').click();
      await expect(page.locator('.brew-entry > [role="alert"]')).toContainText(
        'may have been updated',
      );
      await expect(button(page, 'Save changes')).toBeDisabled();
      times.uncertain = new Date().toISOString();
    } finally {
      await startApi();
      times.restored = new Date().toISOString();
      await writeFile(
        info.outputPath('history-outage-timing.json'),
        JSON.stringify(times, null, 2),
      );
    }
    page.once('dialog', (d) => d.accept());
    await page.getByRole('link', { name: 'Check journal' }).click();
    await expect(
      page.getByRole('link', { name: new RegExp(`View brew.*${brew.id}`) }),
    ).toBeVisible();
    expect(await get(context.request, brew.id)).toEqual(brew);
  });
  for (const fault of [400, 403, 500, 'body-stalled', 'id-mismatch'])
    test(`history LABELED recipe PATCH ${fault} retained both-panel draft and single write`, async ({
      page,
      context,
    }, info) => {
      const { brew } = await fixture(page, context);
      await edit(page, brew.id);
      await page.getByLabel('Tasting notes (optional)').fill('Both-panel fault draft');
      await button(page, 'Recipe').click();
      await page.getByLabel('Temperature (°C)', { exact: true }).fill('94');
      let calls = 0;
      if (fault === 'body-stalled') {
        await page.evaluate(
          ({ id, original }) => {
            const actual = window.fetch;
            window.__historyFaultCalls = 0;
            window.fetch = (url, options) => {
              if (String(url) !== `/api/v1/brews/${id}` || options?.method !== 'PATCH')
                return actual(url, options);
              window.__historyFaultCalls++;
              return Promise.resolve(
                new Response(
                  new ReadableStream({
                    start(controller) {
                      window.__historyRelease = () => {
                        controller.enqueue(
                          new TextEncoder().encode(
                            JSON.stringify({
                              brew: {
                                ...original,
                                waterTemperatureC: 94,
                                notes: 'Both-panel fault draft',
                              },
                            }),
                          ),
                        );
                        controller.close();
                      };
                    },
                  }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
              );
            };
          },
          { id: brew.id, original: brew },
        );
      } else
        await page.route(`**/api/v1/brews/${brew.id}`, (route) => {
          if (route.request().method() !== 'PATCH') return route.continue();
          calls++;
          return route.fulfill({
            status: typeof fault === 'number' ? fault : 200,
            contentType: 'application/json',
            body: JSON.stringify(
              fault === 'id-mismatch'
                ? {
                    brew: {
                      ...brew,
                      id: brew.coffeeId,
                      waterTemperatureC: 94,
                      notes: 'Both-panel fault draft',
                    },
                  }
                : { fault: 'LABELED' },
            ),
          });
        });
      await button(page, 'Save changes').click();
      if (fault === 'body-stalled') {
        await expect(page.getByLabel('Temperature (°C)', { exact: true })).toBeDisabled();
        await expect(button(page, 'Tasting')).toBeDisabled();
        await page.locator('form.brew-editor').evaluate((form) => {
          form.requestSubmit();
          form.requestSubmit();
        });
      }
      await expect(page.locator('.brew-entry > [role="alert"]')).toContainText(
        [400, 403].includes(fault) ? 'not saved' : 'may have been updated',
      );
      if (fault === 'body-stalled') {
        await page.evaluate(() => window.__historyRelease());
        expect(await page.evaluate(() => window.__historyFaultCalls)).toBe(1);
      } else expect(calls).toBe(1);
      await page.getByLabel('Temperature (°C)', { exact: true }).fill('95');
      await button(page, 'Tasting').click();
      await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue(
        'Both-panel fault draft',
      );
      if (![400, 403].includes(fault)) {
        await expect(button(page, 'Save changes')).toBeDisabled();
        await page.locator('form.brew-editor').evaluate((form) => form.requestSubmit());
      }
      expect(await get(context.request, brew.id)).toEqual(brew);
      await page.screenshot({
        path: info.outputPath(`history-recipe-fault-${fault}.png`),
        fullPage: true,
      });
      page.once('dialog', (d) => d.accept());
      await button(page, 'Cancel changes').click();
    });
  test('history shared saved and new recipe pour arrows retain 44px targets and chronological slots', async ({
    page,
    context,
  }, info) => {
    const { brew } = await fixture(page, context);
    const original = await patch(context.request, brew.id, {
      pours: [
        { waterGrams: 50, startTimeSeconds: 0 },
        { waterGrams: 75, startTimeSeconds: 45 },
        { waterGrams: 125, startTimeSeconds: 90 },
      ],
    });
    const measurements = [];
    for (const surface of ['saved', 'new']) {
      if (surface === 'saved') {
        await edit(page, brew.id);
        await page.getByLabel('Tasting notes (optional)').fill('Preserved across reorder');
        await button(page, 'Recipe').click();
      } else {
        await patch(context.request, brew.id, {
          pours: original.pours.map(({ waterGrams, startTimeSeconds }) => ({
            waterGrams,
            startTimeSeconds,
          })),
        });
        await page.goto('/app/brews/new');
        await button(page, 'Actual roaster · History coffee').click();
        await expect(page.getByLabel('Grind setting (required)')).toHaveValue('22 clicks');
      }
      await expect(button(page, 'Move pour 1 earlier')).toBeDisabled();
      await expect(button(page, 'Move pour 3 later')).toBeDisabled();
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: width === 320 ? 480 : 700 });
        for (const name of ['Move pour 2 earlier', 'Move pour 2 later']) {
          const control = button(page, name);
          await expect(control).toBeEnabled();
          const geometry = await control.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return {
              width: r.width,
              height: r.height,
              dpr: window.devicePixelRatio,
              viewport: window.innerWidth,
              cssZoom: getComputedStyle(document.documentElement).zoom,
            };
          });
          measurements.push({ surface, width, name, ...geometry });
          await writeFile(
            info.outputPath('pour-targets.json'),
            JSON.stringify(measurements, null, 2),
          );
          expect(geometry.width).toBeGreaterThanOrEqual(44);
          expect(geometry.height).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      }
      await button(page, 'Move pour 2 earlier').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Pour 1 incremental water (g)', { exact: true })).toHaveValue(
        '75',
      );
      await expect(page.getByLabel('Pour 2 incremental water (g)', { exact: true })).toHaveValue(
        '50',
      );
      for (const [i, seconds] of [0, 45, 90].entries())
        await expect(page.getByLabel(`Pour ${i + 1} start (seconds)`, { exact: true })).toHaveValue(
          String(seconds),
        );
      await button(page, 'Move pour 2 later').click();
      await expect(page.getByLabel('Pour 2 incremental water (g)', { exact: true })).toHaveValue(
        '125',
      );
      if (surface === 'saved') {
        await button(page, 'Tasting').click();
        await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue(
          'Preserved across reorder',
        );
        await button(page, 'Recipe').click();
        const { brew: updated, delta } = await save(page, brew.id);
        expect(delta).toEqual({
          pours: [
            { waterGrams: 75, startTimeSeconds: 0 },
            { waterGrams: 125, startTimeSeconds: 45 },
            { waterGrams: 50, startTimeSeconds: 90 },
          ],
          notes: 'Preserved across reorder',
        });
        expect(updated.brewedAt).toBe(original.brewedAt);
        expect(updated.createdAt).toBe(original.createdAt);
        expect((await list(context.request)).brews).toHaveLength(1);
      } else {
        await button(page, 'Continue to tasting').click();
        await expect(page.getByRole('heading', { name: 'How did it taste?' })).toBeVisible();
        await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue('');
        expect((await list(context.request)).brews).toHaveLength(1);
        page.once('dialog', (d) => d.accept());
        await button(page, 'Cancel').click();
      }
    }
  });
  test('history rendered long-label detail and both editors light/dark all widths with real geometry/contrast', async ({
    page,
    context,
  }, info) => {
    test.setTimeout(120_000); // New ten-combination rendered check, no prior deadline changed.
    const errors = [];
    page.on('pageerror', () => errors.push('uncaught page error'));
    const { brew } = await fixture(page, context);
    const b = await patch(context.request, brew.id, {
      brewer: 'Long custom brewer '.repeat(9),
      grinder: 'Long custom grinder '.repeat(9),
      tastingTags: ['Custom long aroma '.repeat(5)],
      notes: 'Long notes '.repeat(20),
      flavor: 0,
      fragranceAroma: 8.25,
      pours: [
        { waterGrams: 50, startTimeSeconds: 0 },
        { waterGrams: 75, startTimeSeconds: 45 },
        { waterGrams: 125, startTimeSeconds: 90 },
      ],
    });
    const measurements = [];
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: width === 320 ? 480 : 700 });
        await page.goto(`/app/brews/${b.id}`);
        await expect(page.getByText('History coffee', { exact: true })).toBeVisible();
        for (const surface of ['detail', 'tasting', 'recipe']) {
          if (surface === 'tasting') {
            await page.getByRole('link', { name: 'Edit brew', exact: true }).click();
            await expect(page.getByLabel('Overall score /100 (required)')).toBeVisible();
          }
          if (surface === 'recipe') await button(page, 'Recipe').click();
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          await expect(page.getByRole('main')).toHaveCount(1);
          await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
          const controls = await page
            .locator(
              '.brew-entry button, .brew-entry input:not([type="range"]), .brew-entry select, .brew-entry textarea, .brew-entry a.cm-button',
            )
            .all();
          for (const control of controls) {
            const box = await control.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
          }
          const colors = await page.evaluate(() => {
            const text = getComputedStyle(document.querySelector('.brew-entry'));
            const secondary = getComputedStyle(
              document.querySelector('.field-hint') || document.querySelector('dt'),
            );
            const link = getComputedStyle(
              document.querySelector('.brew-entry a.cm-button') ||
                document.querySelector('.brew-entry button'),
            );
            return {
              text: text.color,
              secondary: secondary.color,
              background: getComputedStyle(document.body).backgroundColor,
              accent: link.backgroundColor,
              accentText: link.color,
            };
          });
          const luminance = (rgb) =>
            rgb
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((n) => n / 255)
              .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
              .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
          const contrast = (a, c) =>
            (Math.max(luminance(a), luminance(c)) + 0.05) /
            (Math.min(luminance(a), luminance(c)) + 0.05);
          const ratios = {
            text: contrast(colors.text, colors.background),
            secondary: contrast(colors.secondary, colors.background),
            button: contrast(colors.accentText, colors.accent),
          };
          measurements.push({ colorScheme, width, surface, colors, ratios });
          await writeFile(
            info.outputPath('history-rendered-measurements.json'),
            JSON.stringify(measurements, null, 2),
          );
          for (const value of Object.values(ratios)) expect(value).toBeGreaterThanOrEqual(4.5);
          await page.screenshot({
            path: info.outputPath(`history-${surface}-${width}-${colorScheme}.png`),
            fullPage: true,
          });
        }
        await button(page, 'Cancel changes').click();
      }
    }
    await writeFile(
      info.outputPath('history-rendered-measurements.json'),
      JSON.stringify(measurements, null, 2),
    );
    expect(errors).toEqual([]);
  });
}
