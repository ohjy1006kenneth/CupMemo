import { writeFile } from 'node:fs/promises';
import {
  brewResponseSchema,
  brewListResponseSchema,
  coffeeResponseSchema,
} from '../../packages/contracts/dist/index.js';
/* global document, window, getComputedStyle, Response, ReadableStream, TextEncoder */

// Shares the original auth suite's one real API/database owner; fault interception is explicitly labeled.
export function registerSensoryFlows({
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
  const fields = [
    ['fragranceAroma', 'Fragrance/Aroma', 8.25],
    ['flavor', 'Flavor', 0],
    ['aftertaste', 'Aftertaste', 7.75],
    ['acidity', 'Acidity', 0],
    ['body', 'Body', 10],
    ['balance', 'Balance', 8.5],
    ['sweetness', 'Sweetness', 9.25],
    ['overallImpression', 'Overall Impression', 7.25],
  ];
  async function fixture(page, context, name = 'Sensory fixture') {
    const email = await signup(page);
    const response = await context.request.post('/api/v1/coffees', {
      headers: { Origin: origin },
      data: { name, roaster: 'SEY' },
    });
    expect(response.status()).toBe(201);
    const coffee = coffeeResponseSchema.parse(await response.json()).coffee;
    const brew = await seedBrew(context.request, coffee.id);
    return { email, coffee, brew };
  }
  async function get(request, id) {
    const r = await request.get(`/api/v1/brews/${id}`);
    expect(r.status()).toBe(200);
    return brewResponseSchema.parse(await r.json()).brew;
  }
  async function patch(request, id, data) {
    const r = await request.patch(`/api/v1/brews/${id}`, { headers: { Origin: origin }, data });
    expect(r.status()).toBe(200);
    return brewResponseSchema.parse(await r.json()).brew;
  }
  async function list(request, coffeeId) {
    const r = await request.get(`/api/v1/brews?coffeeId=${coffeeId}&limit=20&offset=0`);
    expect(r.status()).toBe(200);
    return brewListResponseSchema.parse(await r.json()).brews;
  }
  async function edit(page, brew) {
    await page.goto('/app/journal');
    await page.getByRole('link', { name: new RegExp(`Edit tasting.*${brew.id}`) }).click();
    await expect(page).toHaveURL(`${origin}/app/brews/${brew.id}/tasting`);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue(
      String(brew.overallScore),
    );
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Edit your tasting');
  }
  async function save(page, id) {
    const response = page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/brews/${id}`) && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const r = await response;
    expect(r.status()).toBe(200);
    const brew = brewResponseSchema.parse(await r.json()).brew;
    await expect(page).toHaveURL(`${origin}/app/journal`);
    await expect(page.getByRole('link', { name: new RegExp(`Edit tasting.*${id}`) })).toBeVisible();
    return brew;
  }
  for (const subset of ['none', 'partial', 'full'])
    test(`sensory real new ${subset} qualities shares mode/back and persists one POST with blank latest assessment`, async ({
      page,
      context,
      browser,
    }) => {
      const { email, coffee, brew: prior } = await fixture(page, context);
      await patch(context.request, prior.id, {
        tastingMode: 'sensory',
        flavor: 8.25,
        overallScore: 99,
      });
      await page.goto('/app/brews/new');
      await page.getByRole('button', { name: `SEY · ${coffee.name}`, exact: true }).click();
      await expect(page.getByLabel('Grind setting (required)')).toHaveValue(prior.grindSetting);
      await page.getByRole('button', { name: 'Continue to tasting' }).click();
      await expect(page.getByRole('button', { name: 'Quick rating' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByLabel('Overall score /100 (required)')).toHaveValue('');
      await page.getByRole('button', { name: 'Sensory Detail', exact: true }).click();
      await expect(page.getByText('Not rated', { exact: true })).toHaveCount(8);
      const supplied =
        subset === 'none' ? [] : subset === 'partial' ? [fields[0], fields[3], fields[7]] : fields;
      for (const [, label, value] of supplied) {
        await page.getByRole('button', { name: `Add ${label} rating`, exact: true }).click();
        await page.getByLabel(`${label} quality /10`, { exact: true }).fill(String(value));
      }
      await page.getByLabel('Overall score /100 (required)').fill('0');
      await page.getByRole('button', { name: 'Peach', exact: true }).click();
      await page.getByLabel('Tasting notes (optional)').fill('Shared sensory notes');
      await page.getByRole('button', { name: 'Quick rating' }).click();
      await page.getByRole('button', { name: 'Back to recipe' }).click();
      await page.getByRole('button', { name: 'Continue to tasting' }).click();
      await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('Shared sensory notes');
      await page.getByRole('button', { name: 'Sensory Detail', exact: true }).click();
      for (const [, label, value] of supplied)
        await expect(page.getByLabel(`${label} quality /10`, { exact: true })).toHaveValue(
          String(value),
        );
      // Full case proves retained hidden values are sent even when collapsed quick.
      if (subset === 'full') await page.getByRole('button', { name: 'Quick rating' }).click();
      let posts = 0;
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith('/api/v1/brews')) posts++;
      });
      const response = page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/brews') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Save brew & tasting' }).click();
      const r = await response;
      expect(r.status()).toBe(201);
      const created = brewResponseSchema.parse(await r.json()).brew;
      expect(created.overallScore).toBe(0);
      expect(created.tastingMode).toBe(subset === 'full' ? 'quick' : 'sensory');
      for (const [key, , value] of fields)
        expect(created[key]).toBe(supplied.some(([k]) => k === key) ? value : null);
      await expect(page).toHaveURL(`${origin}/app/journal`);
      expect(posts).toBe(1);
      expect(await list(context.request, coffee.id)).toHaveLength(2);
      await page.reload();
      await edit(page, created);
      await expect(page.getByRole('button', { name: 'Peach', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Cancel changes' }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      const fresh = await browser.newContext({ baseURL: origin });
      const freshPage = await fresh.newPage();
      await signin(freshPage, email);
      await edit(freshPage, created);
      await freshPage.getByRole('button', { name: 'Sensory Detail', exact: true }).click();
      for (const [, label, value] of supplied)
        await expect(freshPage.getByLabel(`${label} quality /10`, { exact: true })).toHaveValue(
          String(value),
        );
      expect((await get(fresh.request, created.id)).tastingMode).toBe(created.tastingMode);
      await fresh.close();
    });
  test('sensory real Journal edit no-op changed-only PATCH preserves concurrent recipe and all immutable identity', async ({
    page,
    context,
  }) => {
    const { coffee, brew } = await fixture(page, context);
    const original = await patch(context.request, brew.id, {
      tastingTags: ['Custom aroma', 'Peach'],
      notes: 'Original notes',
    });
    await edit(page, original);
    let patches = 0;
    page.on('request', (r) => {
      if (r.method() === 'PATCH') patches++;
    });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('No changes to save.', { exact: true })).toBeVisible();
    expect(patches).toBe(0);
    await expect(page.getByRole('button', { name: 'Custom aroma', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Sensory Detail', exact: true }).click();
    await page.getByRole('button', { name: 'Add Fragrance/Aroma rating' }).click();
    await page.getByLabel('Fragrance/Aroma quality /10').fill('8.25');
    const newer = await patch(context.request, brew.id, {
      waterTemperatureC: 95,
      grindSetting: '24 clicks',
    });
    const request = page.waitForRequest(
      (r) => r.method() === 'PATCH' && r.url().endsWith(`/api/v1/brews/${brew.id}`),
    );
    const saved = await save(page, brew.id);
    expect((await request).postDataJSON()).toEqual({
      tastingMode: 'sensory',
      fragranceAroma: 8.25,
    });
    expect(patches).toBe(1);
    expect(saved).toMatchObject({
      id: original.id,
      coffeeId: original.coffeeId,
      createdAt: original.createdAt,
      brewedAt: original.brewedAt,
      pours: original.pours,
      waterTemperatureC: newer.waterTemperatureC,
      grindSetting: newer.grindSetting,
      tastingTags: original.tastingTags,
      notes: original.notes,
    });
    expect(await list(context.request, coffee.id)).toHaveLength(1);
    await page.reload();
    await edit(page, saved);
    await expect(page.getByLabel('Fragrance/Aroma quality /10')).toHaveValue('8.25');
    await page.getByRole('button', { name: 'Quick rating' }).click();
    const collapsed = await save(page, brew.id);
    expect(collapsed.fragranceAroma).toBe(8.25);
    expect(collapsed.tastingMode).toBe('quick');
  });
  test('sensory real full saved null/zero clear and custom tag removal retains original recipe/time/count', async ({
    page,
    context,
  }) => {
    const { coffee, brew } = await fixture(page, context);
    const original = await patch(context.request, brew.id, {
      tastingMode: 'sensory',
      ...Object.fromEntries(fields.map(([k, , v]) => [k, v])),
      tastingTags: ['Custom aroma', 'Peach'],
      notes: 'Original notes',
    });
    await edit(page, original);
    for (const [, label, value] of fields)
      await expect(page.getByLabel(`${label} quality /10`, { exact: true })).toHaveValue(
        String(value),
      );
    await page.getByRole('button', { name: 'Clear Balance rating' }).click();
    await page.getByLabel('Sweetness quality /10').fill('0');
    await page.getByRole('button', { name: 'Peach', exact: true }).click();
    await page.getByLabel('Tasting notes (optional)').fill(' ');
    await page.getByLabel('Overall score /100 (required)').fill('88.25');
    const req = page.waitForRequest(
      (r) => r.method() === 'PATCH' && r.url().endsWith(`/api/v1/brews/${brew.id}`),
    );
    const saved = await save(page, brew.id);
    expect((await req).postDataJSON()).toEqual({
      balance: null,
      sweetness: 0,
      tastingTags: ['Custom aroma'],
      notes: null,
      overallScore: 88.25,
    });
    for (const key of [
      'id',
      'coffeeId',
      'createdAt',
      'brewedAt',
      'brewer',
      'grinder',
      'grindSetting',
      'doseGrams',
      'waterGrams',
      'waterTemperatureC',
      'totalBrewTimeSeconds',
      'pours',
    ])
      expect(saved[key]).toEqual(original[key]);
    expect(await list(context.request, coffee.id)).toHaveLength(1);
    await expect(page.locator('.brew-score')).toContainText('88.25');
    await page.reload();
    await edit(page, saved);
    await expect(page.getByLabel('Sweetness quality /10')).toHaveValue('0');
    await expect(page.getByRole('button', { name: 'Add Balance rating' })).toBeVisible();
    await page.getByRole('button', { name: 'Custom aroma' }).click();
    await save(page, brew.id);
    expect((await get(context.request, brew.id)).tastingTags).toEqual([]);
  });
  test('sensory real saved cancel refusal/acceptance native unload/reload no replay restores authoritative assessment', async ({
    page,
    context,
  }) => {
    const { brew } = await fixture(page, context);
    await edit(page, brew);
    let patches = 0;
    page.on('request', (r) => {
      if (r.method() === 'PATCH') patches++;
    });
    await page.getByRole('button', { name: 'Sensory Detail', exact: true }).click();
    await page.getByLabel('Tasting notes (optional)').fill('Unsaved changes');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Cancel changes' }).click();
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('Unsaved changes');
    let kind = '';
    page.once('dialog', async (d) => {
      kind = d.type();
      await d.dismiss();
    });
    await page.getByRole('link', { name: 'Beans', exact: true }).click();
    expect(kind).toBe('beforeunload');
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await expect(page.getByRole('button', { name: 'Quick rating' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveValue('');
    await page.getByLabel('Overall score /100 (required)').fill('99');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel changes' }).click();
    await edit(page, brew);
    expect(patches).toBe(0);
    expect(await get(context.request, brew.id)).toEqual(brew);
  });
  test('sensory real two-user deep link GET/PATCH foreign and missing404 no exposure; invalid ID no lookup', async ({
    page,
    context,
  }) => {
    const { brew } = await fixture(page, context);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signup(page);
    const missing = '00000000-0000-4000-8000-000000000099';
    for (const id of [brew.id, missing]) {
      for (const method of ['get', 'patch']) {
        const r = await context.request[method](
          `/api/v1/brews/${id}`,
          method === 'patch' ? { headers: { Origin: origin }, data: { fragranceAroma: 8.25 } } : {},
        );
        expect(r.status()).toBe(404);
        expect(await r.json()).toEqual({ message: 'Resource not found' });
      }
      await page.goto(`/app/brews/${id}/tasting`);
      await expect(page.locator('.brew-entry [role="alert"]')).toHaveText(
        'This tasting is unavailable.',
      );
      await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    }
    const lookups = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/brews/')) lookups.push(r.url());
    });
    await page.goto('/app/brews/not-a-uuid/tasting');
    await expect(page.locator('.brew-entry [role="alert"]')).toHaveText(
      'This tasting is unavailable.',
    );
    expect(lookups).toEqual([]);
  });
  test('sensory real revoked session PATCH401 terminal clears mounted private draft', async ({
    page,
    context,
  }) => {
    const { email, brew } = await fixture(page, context);
    await edit(page, brew);
    await page.getByLabel('Tasting notes (optional)').fill('Private unsaved notes');
    await getConnection().pool.query(
      'DELETE FROM public.session WHERE user_id IN (SELECT id FROM public."user" WHERE email=$1)',
      [email],
    );
    const response = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await response).status()).toBe(401);
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(page.getByLabel('Tasting notes (optional)')).toHaveCount(0);
  });
  test('sensory real selected brew deletion PATCH404 terminal hides editor without retry', async ({
    page,
    context,
  }) => {
    const { brew } = await fixture(page, context);
    await edit(page, brew);
    const removed = await context.request.delete(`/api/v1/brews/${brew.id}`, {
      headers: { Origin: origin },
    });
    expect(removed.status()).toBe(204);
    await page.getByLabel('Overall score /100 (required)').fill('99');
    const response = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await response).status()).toBe(404);
    await expect(page.locator('.brew-entry [role="alert"]')).toHaveText(
      'This tasting is unavailable.',
    );
    await expect(page.getByRole('button', { name: 'Retry tasting' })).toHaveCount(0);
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveCount(0);
  });
  test('sensory real API outage after validated saved readiness retains uncertain lock and fresh Journal recovers', async ({
    page,
    context,
  }, info) => {
    const { brew } = await fixture(page, context);
    await edit(page, brew);
    await page.getByLabel('Overall score /100 (required)').fill('99');
    const timing = { readyAt: new Date().toISOString(), stopStartedAt: new Date().toISOString() };
    try {
      await stopApi();
      timing.stoppedAt = new Date().toISOString();
      timing.clickStartedAt = new Date().toISOString();
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.locator('.brew-entry [role="alert"]')).toContainText(
        'may have been updated',
      );
      timing.uncertainAt = new Date().toISOString();
      await page.getByLabel('Overall score /100 (required)').fill('90');
      await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    } finally {
      await startApi();
      timing.restoredAt = new Date().toISOString();
      await writeFile(info.outputPath('saved-outage-timing.json'), JSON.stringify(timing, null, 2));
    }
    page.once('dialog', (d) => d.accept());
    await page.getByRole('link', { name: 'Check journal' }).click();
    await expect(
      page.getByRole('link', { name: new RegExp(`Edit tasting.*${brew.id}`) }),
    ).toBeVisible();
    expect(await get(context.request, brew.id)).toEqual(brew);
  });
  for (const fault of [
    '400',
    '403',
    '500',
    'redirect',
    'unexpected',
    'malformed200',
    'mismatched200',
    'stalled-late',
  ])
    test(`sensory LABELED PATCH fault ${fault} not happy/auth/ownership`, async ({
      page,
      context,
    }, info) => {
      const { brew } = await fixture(page, context);
      await edit(page, brew);
      await page.getByLabel('Overall score /100 (required)').fill('88.25');
      let calls = 0,
        release;
      await page.route(`**/api/v1/brews/${brew.id}`, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        calls++;
        if (fault === 'stalled-late')
          await new Promise((done) => {
            release = done;
          });
        try {
          await route.fulfill({
            status:
              fault === 'redirect'
                ? 302
                : fault === 'unexpected'
                  ? 202
                  : /^\d+$/.test(fault)
                    ? Number(fault)
                    : 200,
            headers: fault === 'redirect' ? { Location: '/app/journal' } : {},
            contentType: 'application/json',
            body: JSON.stringify(
              fault === 'mismatched200'
                ? { brew: { ...brew, overallScore: 88.25, coffeeId: brew.id } }
                : { fault: 'LABELED malformed' },
            ),
          });
        } catch {
          if (fault !== 'stalled-late') throw new Error('Labeled fault fulfillment failed');
        }
      });
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.locator('.brew-entry [role="alert"]')).toContainText(
        ['400', '403'].includes(fault) ? 'not saved' : 'may have been updated',
      );
      if (release) release();
      expect(calls).toBe(1);
      await page.getByLabel('Overall score /100 (required)').fill('90');
      if (!['400', '403'].includes(fault)) {
        await expect(
          page.getByRole('button', { name: 'Save changes', exact: true }),
        ).toBeDisabled();
        expect(calls).toBe(1);
      }
      expect(await get(context.request, brew.id)).toEqual(brew);
      await page.screenshot({ path: info.outputPath(`saved-${fault}.png`), fullPage: true });
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Cancel changes' }).click();
    });
  test('sensory LABELED body-stalled PATCH pending double-submit and late-body uncertain lock', async ({
    page,
    context,
  }) => {
    const { brew } = await fixture(page, context);
    await edit(page, brew);
    await page.getByLabel('Overall score /100 (required)').fill('88.25');
    await page.evaluate(
      ({ id, original }) => {
        const actual = window.fetch;
        window.__faultCalls = 0;
        window.fetch = (url, options) => {
          if (String(url) !== `/api/v1/brews/${id}` || options?.method !== 'PATCH')
            return actual(url, options);
          window.__faultCalls++;
          const stream = new ReadableStream({
            start(controller) {
              window.__releaseFaultBody = () => {
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ brew: { ...original, overallScore: 88.25 } }),
                  ),
                );
                controller.close();
              };
            },
          });
          return Promise.resolve(
            new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } }),
          );
        };
        const form = document.querySelector('form');
        form.requestSubmit();
        form.requestSubmit();
      },
      { id: brew.id, original: brew },
    );
    await expect(page.getByRole('button', { name: 'Saving changes…', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Overall score /100 (required)')).toHaveAttribute('readonly', '');
    await expect(page.locator('.brew-entry [role="alert"]')).toContainText('may have been updated');
    await page.evaluate(() => window.__releaseFaultBody());
    expect(await page.evaluate(() => window.__faultCalls)).toBe(1);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    expect(await get(context.request, brew.id)).toEqual(brew);
  });
  test('sensory rendered expanded saved light/dark responsive short viewport hidden-error keyboard and contrast', async ({
    page,
    context,
  }, info) => {
    const { brew } = await fixture(page, context);
    const saved = await patch(context.request, brew.id, {
      tastingMode: 'sensory',
      ...Object.fromEntries(fields.map(([k, , v]) => [k, v])),
      tastingTags: ['Long custom sensory aroma '.repeat(3)],
      notes: 'Actual saved sensory notes',
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const colorScheme of ['light', 'dark'])
      for (const width of [320, 360, 390, 430, 1280]) {
        await page.setViewportSize({ width, height: width === 320 ? 480 : 740 });
        await page.emulateMedia({ colorScheme });
        await edit(page, saved);
        for (const control of await page.locator('form input,form textarea,form button').all())
          expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.getByRole('button', { name: 'Quick rating' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Sensory Detail', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.getByLabel('Fragrance/Aroma quality /10').fill('');
        await page.getByRole('button', { name: 'Quick rating' }).click();
        await page.getByRole('button', { name: 'Save changes', exact: true }).click();
        await expect(page.getByLabel('Fragrance/Aroma quality /10')).toBeFocused();
        await page.screenshot({
          path: info.outputPath(`saved-hidden-error-${width}-${colorScheme}.png`),
          fullPage: true,
        });
        await page.getByLabel('Fragrance/Aroma quality /10').fill('8.25');
        await page
          .getByRole('button', { name: 'Save changes', exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          page.getByRole('button', { name: 'Save changes', exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: info.outputPath(`saved-expanded-${width}-${colorScheme}.png`),
          fullPage: true,
        });
        if (width === 390) {
          const colors = await page.evaluate(() => {
            const input = getComputedStyle(document.querySelector('#overallImpression')),
              body = getComputedStyle(document.body),
              help = getComputedStyle(document.querySelector('#score-help'));
            return {
              text: input.color,
              surface: input.backgroundColor,
              border: input.borderTopColor,
              help: help.color,
              background: body.backgroundColor,
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
          const ratio = (a, b) =>
            (Math.max(luminance(a), luminance(b)) + 0.05) /
            (Math.min(luminance(a), luminance(b)) + 0.05);
          const ratios = {
            text: ratio(colors.text, colors.surface),
            border: ratio(colors.border, colors.surface),
            help: ratio(colors.help, colors.background),
          };
          expect(ratios.text).toBeGreaterThanOrEqual(4.5);
          expect(ratios.border).toBeGreaterThanOrEqual(3);
          expect(ratios.help).toBeGreaterThanOrEqual(4.5);
          await writeFile(
            info.outputPath(`saved-contrast-${colorScheme}.json`),
            JSON.stringify({ colors, ratios }, null, 2),
          );
        }
        page.once('dialog', (d) => d.accept());
        await page.getByRole('button', { name: 'Cancel changes' }).click();
      }
    expect(errors).toEqual([]);
  });
}
