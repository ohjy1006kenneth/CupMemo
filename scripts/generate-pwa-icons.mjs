import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

// Development-only rasterization of an editable font-free SVG. No product runtime dependency.
const root = new URL('../apps/web/public/icons/', import.meta.url);
const svg = await readFile(new URL('monogram.svg', root), 'utf8');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
try {
  const page = await browser.newPage();
  for (const [name, size] of [
    ['icon-192', 192],
    ['icon-512', 512],
    ['icon-maskable-512', 512],
    ['apple-touch-icon', 180],
  ]) {
    const png = await page.evaluate(
      async ({ svg, size }) => {
        const image = new globalThis.Image();
        image.src = `data:image/svg+xml;base64,${globalThis.btoa(svg)}`;
        await image.decode();
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { svg, size },
    );
    await writeFile(new URL(`${name}.png`, root), Buffer.from(png, 'base64'));
  }
} finally {
  await browser.close();
}
