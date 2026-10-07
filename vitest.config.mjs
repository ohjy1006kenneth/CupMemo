import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

const webRequire = createRequire(new URL('./apps/web/package.json', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'server-only': new URL('./tests/server-only.mjs', import.meta.url).pathname,
      'next/navigation': webRequire.resolve('next/navigation'),
    },
  },

  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.mjs'],
    include: ['tests/**/*.test.mjs', 'tests/**/*.test.tsx'],
  },
});
