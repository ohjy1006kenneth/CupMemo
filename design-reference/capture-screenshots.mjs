// Optional helper. Requires an existing Playwright + Chromium installation.
// Outputs screenshots; does not install dependencies or modify the host.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('Playwright is not available. Open prototype.html in your browser tooling instead.'); process.exit(1); }
const directory = fileURLToPath(new URL('./screenshots/', import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('./prototype.html', import.meta.url).href);
  const click = action => page.locator(`[data-action="${action}"]`).first().click();
  const shot = filename => page.screenshot({ path: `${directory}/${filename}.png`, fullPage: true });
  await shot('beans');
  await click('scan'); await shot('scan-front');
  await click('capture'); await shot('scan-back');
  await click('capture'); await shot('coffee-review');
  await click('enrich'); await shot('enrichment-review');
  await click('library'); await page.locator('[data-action="bean"][data-index="0"]').click();
  await shot('coffee-brews');
  await page.locator('[data-action="beantab"][data-tab="details"]').click(); await shot('coffee-details');
  await page.locator('[data-action="beantab"][data-tab="community"]').click(); await shot('community');
  await click('newbrew'); await shot('recipe');
  await click('savebrew'); await shot('quick-rating');
  await page.locator('[data-action="evalmode"][data-mode="sensory"]').click(); await shot('sensory-detail');
  await click('journal'); await shot('journal');
  await click('edit'); await shot('edit-tasting');
  await click('recipe'); await shot('edit-recipe');
  await click('gear'); await shot('gear');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Screenshots written to ${directory}`);
} finally {
  await browser.close();
}
