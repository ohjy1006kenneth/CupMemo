import { describe, expect, it } from 'vitest';
import { createApp } from '../apps/api/src/app.ts';
import * as authorization from '../apps/api/src/authorization.ts';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
const { Headers, Response } = globalThis;
const { requireAuthenticatedUser } = authorization;
const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { pgTable, text, uuid, PgDialect } = apiRequire('drizzle-orm/pg-core');
const fixture = pgTable('fixture', { id: uuid().primaryKey(), owner: text().notNull() });
const dialect = new PgDialect();

const origin = 'http://localhost:3000';
const user = { id: 'user-a', name: 'A', email: 'a@example.test' };
const session = {
  user: { ...user, password: 'private-password' },
  session: {
    id: 'session-a',
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
    token: 'private-token',
  },
};

describe('application authentication', () => {
  it('preserves library stale-cache clears on a valid session without projecting headers', async () => {
    const app = createApp({
      auth: {
        origin,
        handler: async () => new Response(),
        getSession: async () => ({
          response: session,
          headers: new Headers([
            ['set-cookie', 'stale=; Max-Age=0'],
            ['cache-control', 'public'],
          ]),
        }),
      },
    });
    try {
      const response = await app.inject('/api/v1/me');
      expect(response.statusCode).toBe(200);
      expect(response.headers['set-cookie']).toEqual(['stale=; Max-Age=0']);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
  it('constructs mandatory parameterized SQL identity scopes, refusing absent IDs', () => {
    const collection = dialect.sqlToQuery(authorization.ownerScope(fixture.owner, user));
    expect(collection.sql).toBe('"fixture"."owner" = $1');
    expect(collection.params).toEqual([user.id]);
    const resource = dialect.sqlToQuery(
      authorization.ownedResourceScope(fixture.id, fixture.owner, 'resource-id', user),
    );
    expect(resource.sql).toBe('("fixture"."id" = $1 and "fixture"."owner" = $2)');
    expect(resource.params).toEqual(['resource-id', user.id]);
    for (const id of [undefined, null, '', ' ', ' bad ']) {
      expect(() => authorization.ownerScope(fixture.owner, { ...user, id })).toThrow();
      expect(() => authorization.ownedResourceScope(fixture.id, fixture.owner, id, user)).toThrow();
    }
    expect(() => authorization.ownerScope(fixture.owner, undefined)).toThrow();
  });
  it.each(['throw', 'timeout'])(
    'bounds %s lookup failures without protected work or leaked details',
    async (failure) => {
      const auth = {
        origin,
        handler: async () => new Response(),
        getSession: async () => {
          if (failure === 'throw') throw new Error('private-password private-token');
          return new Promise(() => {});
        },
      };
      const app = createApp({ auth });
      let work = 0;
      app.get('/private', { preHandler: requireAuthenticatedUser(auth) }, async () => {
        work++;
        return {};
      });
      try {
        const started = Date.now();
        const denied = await app.inject('/private');
        expect(denied.statusCode).toBe(503);
        expect(denied.json()).toEqual({ message: 'Authentication unavailable' });
        expect(Date.now() - started).toBeLessThan(2500);
        expect(work).toBe(0);
      } finally {
        await app.close();
      }
    },
    3000,
  );
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects unsafe %s origin and cross-site metadata before lookup or mutation',
    async (method) => {
      let lookups = 0;
      let work = 0;
      const auth = {
        origin,
        getSession: async () => {
          lookups++;
          return { response: session, headers: new Headers() };
        },
        handler: async () => new Response(),
      };
      const app = createApp({ auth });
      app.route({
        method,
        url: '/private',
        preHandler: requireAuthenticatedUser(auth),
        handler: async () => {
          work++;
          return {};
        },
      });
      try {
        for (const headers of [
          {},
          { origin: 'null' },
          { origin: origin + '/' },
          {
            origin: 'https://evil.test',
            host: 'localhost:3000',
            'x-forwarded-host': 'localhost:3000',
          },
          { origin, 'sec-fetch-site': 'cross-site' },
        ]) {
          const denied = await app.inject({ method, url: '/private', headers });
          expect(denied.statusCode).toBe(403);
          expect(denied.json()).toEqual({ message: 'Request origin not allowed' });
        }
        expect(lookups).toBe(0);
        expect(work).toBe(0);
        expect(
          (await app.inject({ method, url: '/private', headers: { origin } })).statusCode,
        ).toBe(200);
        expect(work).toBe(1);
      } finally {
        await app.close();
      }
    },
  );
  it.each([
    [null, 401],
    [undefined, 503],
    [{}, 503],
    [{ ...session, session: { ...session.session, id: ' ' } }, 503],
    [{ ...session, session: { ...session.session, userId: 'other' } }, 503],
    [{ ...session, session: { ...session.session, expiresAt: 'not-a-date' } }, 503],
    [{ ...session, session: { ...session.session, expiresAt: new Date(0) } }, 401],
    [{ ...session, user: { ...user, id: '' } }, 503],
    [{ ...session, user: { ...user, email: null } }, 503],
  ])('denies invalid authority %j with %s and no handler work', async (response, status) => {
    const auth = {
      origin,
      getSession: async () => ({ response, headers: new Headers() }),
      handler: async () => new Response(),
    };
    const app = createApp({ auth });
    let work = 0;
    app.get('/private', { preHandler: requireAuthenticatedUser(auth) }, async () => {
      work++;
      return {};
    });
    try {
      const denied = await app.inject('/private');
      expect(denied.statusCode).toBe(status);
      expect(denied.json()).toEqual({
        message: status === 401 ? 'Authentication required' : 'Authentication unavailable',
      });
      expect(work).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('preserves separate library cookie clears but not unrelated headers or Vary overwrite', async () => {
    const headers = new Headers([
      ['set-cookie', 'old=; Max-Age=0'],
      ['set-cookie', 'stale=; Max-Age=0'],
      ['cache-control', 'public'],
      ['access-control-allow-origin', '*'],
    ]);
    const auth = {
      origin,
      getSession: async () => ({ response: null, headers }),
      handler: async () => new Response(),
    };
    const app = createApp({ auth });
    app.addHook('onRequest', async (_request, reply) => {
      reply.header('vary', 'Accept-Encoding');
    });
    try {
      const denied = await app.inject('/api/v1/me');
      expect(denied.statusCode).toBe(401);
      expect(denied.headers['set-cookie']).toEqual(headers.getSetCookie());
      expect(denied.headers.vary).toBe('Accept-Encoding, Cookie');
      expect(denied.headers['cache-control']).toBe('no-store');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
  it('projects only the authoritative benign principal, ignoring caller identity', async () => {
    const app = createApp({
      auth: {
        origin,
        handler: async () => new Response(),
        getSession: async (options) => {
          expect(options.headers.get('cookie')).toBe('session=real-cookie');
          expect(options.query).toEqual({ disableRefresh: true, disableCookieCache: true });
          expect(options.returnHeaders).toBe(true);
          return { response: session, headers: new Headers() };
        },
      },
    });
    try {
      const response = await app.inject({
        url: '/api/v1/me?userId=user-b',
        headers: { cookie: 'session=real-cookie', 'x-user-id': 'user-b' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ user });
    } finally {
      await app.close();
    }
  });
  it('fails closed without an authoritative session dependency', async () => {
    const app = createApp();
    try {
      const response = await app.inject('/api/v1/me');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ message: 'Authentication unavailable' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.vary).toBe('Cookie');
    } finally {
      await app.close();
    }
  });
});
