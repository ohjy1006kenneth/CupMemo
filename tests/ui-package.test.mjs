import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { expect, it } from 'vitest';
const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

it('publishes built browser-safe UI and CSS with one consumer React instance', async () => {
  const ui = await json('../packages/ui/package.json');
  const web = await json('../apps/web/package.json');
  const root = await json('../package.json');
  expect(ui.exports['.']).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' });
  expect(ui.exports['./styles.css']).toBe('./src/styles.css');
  expect(ui.peerDependencies.react).toBe('^19.2.4');
  expect(ui.dependencies).toBeUndefined();
  expect(web.dependencies['@cupmemo/ui']).toBe('workspace:*');
  const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const uiRequire = createRequire(new URL('../packages/ui/package.json', import.meta.url));
  expect(uiRequire.resolve('react')).toBe(webRequire.resolve('react'));
  expect(webRequire.resolve('@cupmemo/ui')).toMatch(/\/packages\/ui\/dist\/index\.js$/);
  expect(webRequire.resolve('@cupmemo/ui/styles.css')).toMatch(/\/packages\/ui\/src\/styles\.css$/);
  expect(root.scripts.typecheck.indexOf('--filter @cupmemo/ui build')).toBeLessThan(
    root.scripts.typecheck.indexOf('--recursive'),
  );
  expect(root.scripts.test).toMatch(
    /^corepack pnpm --filter @cupmemo\/ui build && corepack pnpm api:openapi:check &&/,
  );
  for (const script of ['dev', 'build'])
    expect(web.scripts[script]).toMatch(/^corepack pnpm --filter @cupmemo\/ui build && next /);
});
