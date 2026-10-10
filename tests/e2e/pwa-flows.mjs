import { writeFile } from 'node:fs/promises';

// Uses the existing suite's single API/DB lifecycle and real authenticated responses.
export function registerPwaFlows({ test, expect, signup, origin }) {
  test('PWA public assets and rendered metadata are anonymous, same-origin and zoom-accessible', async ({
    page,
    context,
  }, info) => {
    await page.goto('/');
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#365FC9');
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable=no/);
    // Pinned Next 16.3.8 emits the standard capable name from appleWebApp.capable.
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'CupMemo',
    );
    await expect(
      page.locator('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).toHaveAttribute('content', 'default');
    const response = await context.request.get('/manifest.webmanifest', { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/application\/(manifest\+json|json)/);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
    const assets = [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }];
    for (const asset of assets) {
      const r = await context.request.get(asset.src, { maxRedirects: 0 });
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type']).toMatch(/image\/png/);
      const dimensions = await page.evaluate(async (src) => {
        const image = new globalThis.Image();
        image.src = src;
        await image.decode();
        return `${image.naturalWidth}x${image.naturalHeight}`;
      }, asset.src);
      expect(dimensions).toBe(asset.sizes);
    }
    const cdp = await context.newCDPSession(page);
    const parsed = await cdp.send('Page.getAppManifest');
    expect(parsed.url).toBe(`${origin}/manifest.webmanifest`);
    expect(parsed.errors.filter((error) => error.critical)).toHaveLength(0);
    const diagnostics = await cdp.send('Page.getInstallabilityErrors');
    expect(diagnostics.installabilityErrors).toEqual([]);
    await writeFile(
      info.outputPath('pwa-manifest-diagnostics.json'),
      JSON.stringify({ parsed, diagnostics }, null, 2),
    );
  });

  test('PWA online-only private navigation fails offline without private caches or replay', async ({
    page,
    context,
  }) => {
    await signup(page);
    await expect(page.getByText('No coffees yet', { exact: true })).toBeVisible();
    const privateResponse = await context.request.get('/api/v1/coffees?limit=20&offset=0');
    expect(privateResponse.status()).toBe(200);
    expect(privateResponse.headers()['cache-control']).toContain('no-store');
    expect(
      await page.evaluate(async () => ({
        workers: (await globalThis.navigator.serviceWorker.getRegistrations()).length,
        caches: await globalThis.caches.keys(),
        local: globalThis.localStorage.length,
        session: globalThis.sessionStorage.length,
        databases: (await globalThis.indexedDB.databases()).map((db) => db.name),
      })),
    ).toEqual({ workers: 0, caches: [], local: 0, session: 0, databases: [] });
    await page.goto('about:blank');
    await context.setOffline(true);
    let failed = false;
    try {
      await page.goto(`${origin}/app/journal`);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(await page.getByRole('heading', { name: 'Brew, learn, repeat' }).count()).toBe(0);
    await context.setOffline(false);
    await page.goto(`${origin}/app/journal`);
    await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto('/');
    await expect(page).toHaveURL(`${origin}/sign-in`);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Brew, learn, repeat' })).toHaveCount(0);
  });
  test('PWA offline save is uncertain, never queued or replayed after reconnect', async ({
    page,
    context,
  }) => {
    await signup(page);
    const coffee = await context.request.post('/api/v1/coffees', {
      headers: { Origin: origin },
      data: { name: 'Offline boundary coffee', roaster: 'SEY' },
    });
    expect(coffee.status()).toBe(201);
    await page.goto('/app/brews/new');
    await page.getByRole('button', { name: 'SEY · Offline boundary coffee', exact: true }).click();
    await expect(page.getByLabel('Grind setting (required)')).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Continue to tasting', exact: true }).click();
    await page.getByLabel('Overall score /100 (required)').fill('87.25');
    let posts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/brews')) posts++;
    });
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Save brew & tasting', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Check journal', exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(
      page.getByRole('button', { name: 'Save brew & tasting', exact: true }),
    ).toBeDisabled();
    expect(posts).toBe(1);
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'Check journal', exact: true }).click();
    await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('No brews yet', { exact: true })).toBeVisible();
    const saved = await context.request.get('/api/v1/brews?limit=20&offset=0');
    expect(saved.status()).toBe(200);
    expect((await saved.json()).brews).toEqual([]);
    expect(posts).toBe(1);
  });
}
