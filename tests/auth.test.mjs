import { describe, expect, it } from 'vitest';
import { createApp } from '../apps/api/src/app.ts';
import { resolveAuthConfig } from '../apps/api/src/auth.ts';

const secret = 'test-only-secret-not-for-production-0123456789';

describe('Better Auth configuration', () => {
  it('requires an explicit strong secret and an origin-only URL', () => {
    expect(
      resolveAuthConfig({ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: 'http://localhost:3000' }),
    ).toEqual({
      secret,
      origin: 'http://localhost:3000',
      production: false,
    });
    for (const invalid of [
      undefined,
      '',
      'placeholder-secret-value-that-is-long-enough',
      'short',
    ]) {
      expect(() =>
        resolveAuthConfig({
          BETTER_AUTH_SECRET: invalid,
          BETTER_AUTH_URL: 'http://localhost:3000',
        }),
      ).toThrow();
    }
    for (const invalidUrl of [
      undefined,
      'localhost:3000',
      'http://user:pass@localhost:3000',
      'http://localhost:3000/unsafe/path',
      'http://localhost:3000?host=evil',
      'http://app.example.test',
    ]) {
      expect(() =>
        resolveAuthConfig({ BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: invalidUrl }),
      ).toThrow();
    }
    expect(() =>
      resolveAuthConfig({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'http://localhost:3000',
        NODE_ENV: 'production',
      }),
    ).toThrow();
    expect(
      resolveAuthConfig({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'https://app.example.test',
        NODE_ENV: 'production',
      }).production,
    ).toBe(true);
    expect(
      resolveAuthConfig({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'https://app.example.test/api/v1/auth',
        CUPMEMO_DB_ENV: 'production',
      }).production,
    ).toBe(true);
  });
});

describe('Fastify Better Auth Fetch bridge', () => {
  it('preserves configured origin, request semantics, response bytes and separate cookies', async () => {
    const app = createApp({
      auth: {
        origin: 'http://localhost:3000',
        handler: async (request) => {
          expect(request.url).toBe('http://localhost:3000/api/v1/auth/sign-in/email?next=%2F');
          expect(request.method).toBe('POST');
          expect(request.headers.get('content-type')).toContain('application/json');
          expect(request.headers.get('origin')).toBe('http://localhost:3000');
          expect(request.headers.get('cookie')).toBe('session=sentinel-cookie');
          expect(request.headers.get('sec-fetch-site')).toBe('cross-site');
          expect(await request.json()).toEqual({
            email: 'person@example.test',
            password: 'sentinel-password',
          });
          return new globalThis.Response('auth-response', {
            status: 201,
            headers: [
              ['content-type', 'text/plain'],
              ['set-cookie', 'session=first; Path=/; HttpOnly'],
              ['set-cookie', 'session_data=second; Path=/; HttpOnly'],
            ],
          });
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email?next=%2F',
      headers: {
        origin: 'http://localhost:3000',
        cookie: 'session=sentinel-cookie',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      payload: { email: 'person@example.test', password: 'sentinel-password' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).toBe('auth-response');
    expect(response.headers['set-cookie']).toEqual([
      'session=first; Path=/; HttpOnly',
      'session_data=second; Path=/; HttpOnly',
    ]);
    await app.close();
  });

  it('does not construct request URLs from untrusted Host values', async () => {
    let receivedUrl;
    const app = createApp({
      auth: {
        origin: 'http://localhost:3000',
        handler: async (request) => {
          receivedUrl = request.url;
          return new globalThis.Response('{}', { headers: { 'content-type': 'application/json' } });
        },
      },
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/auth/get-session',
      headers: { host: 'evil.example' },
    });
    expect(receivedUrl).toBe('http://localhost:3000/api/v1/auth/get-session');
    await app.close();
  });

  it('passes URL-encoded bodies through without changing their content type', async () => {
    const app = createApp({
      auth: {
        origin: 'http://localhost:3000',
        handler: async (request) => {
          expect(request.headers.get('content-type')).toContain(
            'application/x-www-form-urlencoded',
          );
          expect(await request.text()).toBe('email=person%40example.test&password=sentinel');
          return new globalThis.Response('{}');
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=person%40example.test&password=sentinel',
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
