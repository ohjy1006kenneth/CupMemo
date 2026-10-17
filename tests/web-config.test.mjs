import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiOrigin } from '../apps/web/src/api-origin.ts';
import { readAuthSession } from '../apps/web/src/auth/session';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('web API proxy configuration', () => {
  it('defaults to the private loopback API origin and normalizes a trailing slash', () => {
    expect(parseApiOrigin(undefined)).toBe('http://127.0.0.1:4101');
    expect(parseApiOrigin('https://api.example.test/')).toBe('https://api.example.test');
  });

  it.each([
    'ftp://example.test',
    'http://user:pass@example.test',
    '/relative',
    'not-a-url',
    'http://cupmemo-api:4101/private',
    'http://cupmemo-api:4101?target=other',
    'http://cupmemo-api:4101#fragment',
    'http://cupmemo-api:4101?',
    'http://cupmemo-api:4101#',
    'http://cupmemo-api:4101/?',
    'http://cupmemo-api:4101/#',
    'http://cupmemo-api:4101/.',
    'http://cupmemo-api:4101/a/..',
    'http://cupmemo-api:4101/%2e',
    'http://cupmemo-api:4101\\',
    'http:cupmemo-api:4101',
    ' http://cupmemo-api:4101',
    'http://cupmemo-api:4101\n',
  ])('rejects unsafe or invalid API origin %s', (origin) =>
    expect(() => parseApiOrigin(origin)).toThrow(),
  );

  it.each([
    ['http://cupmemo-api:4101', 'http://cupmemo-api:4101'],
    ['HTTPS://API.EXAMPLE.TEST:443/', 'https://api.example.test'],
    ['http://[::1]:4101/', 'http://[::1]:4101'],
  ])(
    'canonicalizes valid origin %s without altering appended API paths',
    async (input, expected) => {
      expect(parseApiOrigin(input)).toBe(expected);
      vi.stubEnv('CUPMEMO_API_ORIGIN', input);
      const { default: config } = await import('../apps/web/next.config.ts');
      expect(await config.rewrites()).toEqual([
        { source: '/api/v1/:path*', destination: `${expected}/api/v1/:path*` },
      ]);
      const fetcher = vi.fn(async () => ({ status: 401 }));
      await readAuthSession({ cookie: 'synthetic=transport', fetcher });
      expect(fetcher.mock.calls[0][0]).toBe(
        `${expected}/api/v1/auth/get-session?disableRefresh=true&disableCookieCache=true`,
      );
    },
  );

  it.each(['http://cupmemo-api:4101?', 'http://cupmemo-api:4101#', 'http://cupmemo-api:4101/%2e'])(
    'fails closed in both real origin consumers for %s',
    async (input) => {
      vi.stubEnv('CUPMEMO_API_ORIGIN', input);
      await expect(import('../apps/web/next.config.ts')).rejects.toThrow();
      const fetcher = vi.fn();
      await expect(readAuthSession({ cookie: 'synthetic=transport', fetcher })).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
