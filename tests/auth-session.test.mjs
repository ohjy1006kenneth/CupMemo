import { describe, expect, it, vi } from 'vitest';
import { readAuthSession } from '../apps/web/src/auth/session';

/* global AbortSignal, Response, structuredClone */

const validPayload = {
  user: {
    id: 'private-user-id',
    name: 'Jamie',
    email: 'jamie@example.test',
    emailVerified: false,
    createdAt: '2026-10-07T04:00:00.000Z',
    updatedAt: '2026-10-07T04:00:00.000Z',
    image: null,
  },
  session: {
    id: 'private-session-id',
    userId: 'private-user-id',
    token: 'secret-token',
    expiresAt: '2026-10-14T04:00:00.000Z',
    createdAt: '2026-10-07T04:00:00.000Z',
    updatedAt: '2026-10-07T04:00:00.000Z',
    ipAddress: null,
    userAgent: null,
  },
};

describe('server-side auth session boundary', () => {
  it('does not make a request without incoming cookies', async () => {
    const fetcher = vi.fn();
    await expect(readAuthSession({ cookie: null, fetcher })).resolves.toEqual({
      kind: 'unauthenticated',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the configured origin, forwards cookies, disables refresh, and prevents caching/redirects', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validPayload), { status: 200 }));
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

  it('fails closed on an empty session even when user display fields are present', async () => {
    const fetcher = vi.fn(async () => Response.json({ user: validPayload.user, session: {} }));
    await expect(readAuthSession({ cookie: 's=x', fetcher })).resolves.toEqual({
      kind: 'unavailable',
    });
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

  const requiredFields = {
    session: ['id', 'userId', 'token', 'expiresAt', 'createdAt', 'updatedAt'],
    user: ['id', 'name', 'email', 'emailVerified', 'createdAt', 'updatedAt'],
  };
  for (const [record, fields] of Object.entries(requiredFields)) {
    for (const field of fields) {
      it(`rejects a missing ${record}.${field}`, async () => {
        const body = structuredClone(validPayload);
        delete body[record][field];
        const fetcher = vi.fn(async () => Response.json(body));
        await expect(readAuthSession({ cookie: 's=x', fetcher })).resolves.toEqual({
          kind: 'unavailable',
        });
      });
    }
  }

  it.each([
    ['session', {}],
    ['session', []],
    ['user', []],
    ['session', { ...validPayload.session, id: '' }],
    ['session', { ...validPayload.session, token: ' ' }],
    ['session', { ...validPayload.session, userId: 'another-user' }],
    ['session', { ...validPayload.session, expiresAt: 'not-a-date' }],
    ['session', { ...validPayload.session, expiresAt: '2026-02-30T04:00:00.000Z' }],
    ['session', { ...validPayload.session, createdAt: 1791345600000 }],
    ['session', { ...validPayload.session, updatedAt: null }],
    ['session', { ...validPayload.session, ipAddress: {} }],
    ['session', { ...validPayload.session, userAgent: 42 }],
    ['user', { ...validPayload.user, id: '' }],
    ['user', { ...validPayload.user, email: '' }],
    ['user', { ...validPayload.user, emailVerified: 'false' }],
    ['user', { ...validPayload.user, createdAt: 'not-a-date' }],
    ['user', { ...validPayload.user, image: [] }],
  ])('rejects malformed %s data (case %#)', async (record, value) => {
    const fetcher = vi.fn(async () => Response.json({ ...validPayload, [record]: value }));
    await expect(readAuthSession({ cookie: 's=x', fetcher })).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('accepts absent optional fields and projects only benign display fields', async () => {
    const body = structuredClone(validPayload);
    delete body.user.image;
    delete body.session.ipAddress;
    delete body.session.userAgent;
    const fetcher = vi.fn(async () => Response.json(body));
    await expect(readAuthSession({ cookie: 's=x', fetcher })).resolves.toEqual({
      kind: 'authenticated',
      session: { user: { name: 'Jamie', email: 'jamie@example.test' } },
    });
  });
});
