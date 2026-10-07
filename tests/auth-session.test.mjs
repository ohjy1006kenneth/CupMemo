import { describe, expect, it, vi } from 'vitest';
import { readAuthSession } from '../apps/web/src/auth/session';

/* global AbortSignal, Response */

describe('server-side auth session boundary', () => {
  it('does not make a request without incoming cookies', async () => {
    const fetcher = vi.fn();
    await expect(readAuthSession({ cookie: null, fetcher })).resolves.toEqual({
      kind: 'unauthenticated',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the configured origin, forwards cookies, disables refresh, and prevents caching/redirects', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              id: 'private-id',
              name: 'Jamie',
              email: 'jamie@example.test',
              emailVerified: false,
            },
            session: { token: 'secret-token' },
          }),
          { status: 200 },
        ),
    );
    await expect(
      readAuthSession({
        cookie: 'session=opaque-cookie',
        origin: 'https://api.example.test',
        fetcher,
      }),
    ).resolves.toEqual({
      kind: 'authenticated',
      session: { user: { name: 'Jamie', email: 'jamie@example.test' } },
    });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://api.example.test/api/v1/auth/get-session?disableRefresh=true&disableCookieCache=true',
    );
    expect(options).toMatchObject({
      method: 'GET',
      headers: { cookie: 'session=opaque-cookie', accept: 'application/json' },
      cache: 'no-store',
      redirect: 'manual',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('distinguishes an invalid session from upstream failures, redirects, and malformed data', async () => {
    const response = (status, body = '{}') => vi.fn(async () => new Response(body, { status }));
    await expect(
      readAuthSession({ cookie: 's=x', fetcher: response(200, 'null') }),
    ).resolves.toEqual({
      kind: 'unauthenticated',
    });
    await expect(readAuthSession({ cookie: 's=x', fetcher: response(401) })).resolves.toEqual({
      kind: 'unauthenticated',
    });
    await expect(readAuthSession({ cookie: 's=x', fetcher: response(503) })).resolves.toEqual({
      kind: 'unavailable',
    });
    await expect(readAuthSession({ cookie: 's=x', fetcher: response(302) })).resolves.toEqual({
      kind: 'unavailable',
    });
    await expect(
      readAuthSession({ cookie: 's=x', fetcher: response(200, '{bad') }),
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(
      readAuthSession({ cookie: 's=x', fetcher: response(200, '{"user":{"name":"Jamie"}}') }),
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(
      readAuthSession({
        cookie: 's=x',
        fetcher: response(
          200,
          '{"user":{"name":"Jamie","email":"jamie@example.test"},"session":null}',
        ),
      }),
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(
      readAuthSession({ cookie: 's=x', fetcher: vi.fn().mockRejectedValue(new Error('timeout')) }),
    ).resolves.toEqual({ kind: 'unavailable' });
  });
});
