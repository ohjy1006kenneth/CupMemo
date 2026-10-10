import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const publicRoot = new URL('../apps/web/public/', import.meta.url);
const manifest = () =>
  JSON.parse(readFileSync(new URL('manifest.webmanifest', publicRoot), 'utf8'));

// Decode actual PNG scanlines, including all five PNG filters; no image-source assertions.
function decodePng(path) {
  const bytes = readFileSync(new URL(path.slice(1), publicRoot));
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let width, height, channels;
  const data = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      expect(chunk[8]).toBe(8);
      expect([2, 6]).toContain(chunk[9]);
      channels = chunk[9] === 6 ? 4 : 3;
      expect(chunk[12]).toBe(0);
    }
    if (type === 'IDAT') data.push(chunk);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  expect(raw.length).toBe((stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const paeth =
        distances[0] <= distances[1] && distances[0] <= distances[2]
          ? a
          : distances[1] <= distances[2]
            ? b
            : c;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth][filter];
      pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, channels, pixels };
}

test('manifest binds installed identity, start and scope to the authoritative root', () => {
  const value = manifest();
  expect(value).toMatchObject({
    name: 'CupMemo',
    short_name: 'CupMemo',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'en',
    theme_color: '#365FC9',
    background_color: '#F5F7FA',
  });
  expect(value.description).toMatch(/brewing journal/i);
  expect(value.prefer_related_applications ?? false).toBe(false);
  for (const origin of ['http://127.0.0.1:3326', 'https://cupmemo.example']) {
    for (const key of ['id', 'start_url', 'scope'])
      expect(new URL(value[key], origin).href).toBe(`${origin}/`);
  }
});

test('required any icons decode to real 192 and 512 pixel images', () => {
  const icons = manifest().icons;
  expect(icons).toBeDefined();
  for (const size of [192, 512]) {
    const icon = icons.find((item) => item.sizes === `${size}x${size}` && item.purpose === 'any');
    expect(icon).toBeDefined();
    expect(icon.type).toBe('image/png');
    expect(icon.src).toMatch(/^\/icons\/[\w-]+\.png$/);
    const decoded = decodePng(icon.src);
    expect([decoded.width, decoded.height]).toEqual([size, size]);
    expect(new Set(decoded.pixels).size).toBeGreaterThan(3);
  }
});

test('separate maskable icon is opaque with the complete mark inside the safe circle', () => {
  const icons = manifest().icons;
  expect(icons).toBeDefined();
  const icon = icons.find((item) => item.purpose === 'maskable');
  expect(icon).toMatchObject({ sizes: '512x512', type: 'image/png' });
  expect(icons.filter((item) => item.purpose === 'any').map((item) => item.src)).not.toContain(
    icon.src,
  );
  const { width, height, channels, pixels } = decodePng(icon.src);
  expect([width, height]).toEqual([512, 512]);
  let markPixels = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      if (channels === 4) expect(pixels[offset + 3]).toBe(255);
      if (pixels[offset] !== 54 || pixels[offset + 1] !== 95 || pixels[offset + 2] !== 201) {
        markPixels++;
        expect(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2)).toBeLessThanOrEqual(
          width * 0.4,
        );
      }
    }
  expect(markPixels).toBeGreaterThan(1000);
});

test('Apple touch icon decodes at 180 pixels', () => {
  const decoded = decodePng('/icons/apple-touch-icon.png');
  expect([decoded.width, decoded.height]).toEqual([180, 180]);
});
