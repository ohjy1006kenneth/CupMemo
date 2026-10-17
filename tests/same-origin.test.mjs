import { describe, expect, it } from 'vitest';
import { createApp, parseApiConfig } from '../apps/api/src/app.ts';
import { resolveAuthConfig } from '../apps/api/src/auth.ts';

// Actual Fastify registration/configuration; injected handler is NOT Better Auth acceptance.
describe('same-origin Fastify boundary without a database', () => {
  it('defaults to loopback and requires HTTPS for the production app origin', () => {
    expect(parseApiConfig({})).toEqual({ host: '127.0.0.1', port: 4101 });
    const env = {
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'synthetic-test-only-012345678901234567890123456789',
      BETTER_AUTH_URL: 'https://cupmemo.example.test',
    };
    expect(resolveAuthConfig(env).origin).toBe(env.BETTER_AUTH_URL);
    expect(() =>
      resolveAuthConfig({ ...env, BETTER_AUTH_URL: 'http://cupmemo.example.test' }),
    ).toThrow();
  });

  it('does not opt foreign browser origins into credentialed CORS or accept their mutations', async () => {
    const app = createApp({
      auth: {
        origin: 'https://cupmemo.example.test',
        handler: async () => new globalThis.Response('{}'),
        getSession: async () => {
          throw new Error('Foreign mutation must be rejected before session lookup');
        },
      },
    });
    try {
      for (const url of ['/api/v1/health', '/api/v1/auth/get-session', '/api/v1/me']) {
        for (const method of ['GET', 'OPTIONS']) {
          const response = await app.inject({
            method,
            url,
            headers: {
              origin: 'https://foreign.example.test',
              'access-control-request-method': 'POST',
              'access-control-request-headers': 'content-type',
            },
          });
          for (const header of [
            'access-control-allow-origin',
            'access-control-allow-credentials',
            'access-control-allow-methods',
          ])
            expect(response.headers[header]).toBeUndefined();
          if (method === 'OPTIONS') expect(response.statusCode).toBe(404);
        }
      }
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/coffees',
        headers: { origin: 'https://foreign.example.test', cookie: 'synthetic=only' },
        payload: { name: 'Synthetic', roaster: 'Transport' },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.headers['cache-control']).toBe('no-store');
      expect(denied.headers.vary).toContain('Cookie');
    } finally {
      await app.close();
    }
  });
});
