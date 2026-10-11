import { describe, expect, it, vi } from 'vitest';
import process from 'node:process';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { setImmediate } from 'node:timers/promises';
import * as contracts from '../packages/contracts/src/index.ts';
import { createApp } from '../apps/api/src/app.ts';

describe('manual coffee contracts', () => {
  it('rejects invalid persisted output instead of normalizing or leaking it', () => {
    const coffee = {
      id: 'f59e0f50-a5db-4e5a-8e3e-b04926173d24',
      name: 'N',
      roaster: 'R',
      country: null,
      region: null,
      farmStation: null,
      producer: null,
      variety: null,
      process: null,
      elevation: null,
      roastDate: null,
      tastingNotes: ['Apple'],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(contracts.coffeeResponseSchema.safeParse({ coffee }).success).toBe(true);
    for (const extra of [
      { ownerId: 'private' },
      { name: ' ' },
      { name: ' padded ' },
      { tastingNotes: [' Apple '] },
      { tastingNotes: ['B', 'A'] },
    ])
      expect(
        contracts.coffeeResponseSchema.safeParse({ coffee: { ...coffee, ...extra } }).success,
      ).toBe(false);
  });
  it.each(['2025-02-29', '2024-04-31', '2024-00-01', '2024-13-01', '', '2024-2-1'])(
    'rejects impossible or noncanonical date %s',
    (roastDate) => {
      expect(
        contracts.coffeeCreateSchema.safeParse({ name: 'Lot', roaster: 'Roaster', roastDate })
          .success,
      ).toBe(false);
    },
  );
  it('rejects unknown fields, empty patches and duplicate trimmed descriptors', () => {
    for (const payload of [
      { name: 'Lot', roaster: 'Roaster', ownerId: 'other' },
      { name: ' ', roaster: 'R' },
      { name: 'N', roaster: 'R', tastingNotes: [' a', 'a '] },
    ])
      expect(contracts.coffeeCreateSchema.safeParse(payload).success).toBe(false);
    expect(contracts.coffeePatchSchema.safeParse({}).success).toBe(false);
    expect(contracts.coffeePatchSchema.safeParse({ name: undefined }).success).toBe(false);
    expect(contracts.coffeePatchSchema.parse({ country: ' ', tastingNotes: [] })).toEqual({
      country: null,
      tastingNotes: [],
    });
  });
  it('bounds notes and text after trimming in JS string code units', () => {
    expect(
      contracts.coffeeCreateSchema.safeParse({ name: '😀'.repeat(101), roaster: 'R' }).success,
    ).toBe(false);
    expect(
      contracts.coffeeCreateSchema.parse({
        name: ' N ',
        roaster: ' R ',
        country: ' ',
        tastingNotes: [' Apple ', 'apple'],
      }),
    ).toMatchObject({ name: 'N', roaster: 'R', country: null, tastingNotes: ['Apple', 'apple'] });
    for (const tastingNotes of [
      Array.from({ length: 33 }, (_, i) => String(i)),
      [''],
      ['x'.repeat(101)],
    ])
      expect(contracts.coffeePatchSchema.safeParse({ tastingNotes }).success).toBe(false);
  });
  it('accepts only bounded decimal pagination and strict UUID paths', () => {
    expect(contracts.coffeeListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(contracts.coffeeListQuerySchema.parse({ limit: '100', offset: '100000' })).toEqual({
      limit: 100,
      offset: 100000,
    });
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { offset: '100001' },
      { limit: ['1', '2'] },
      { limit: '1e1' },
      { limit: '+1' },
      { limit: '1.0' },
      { ownerId: 'x' },
    ])
      expect(contracts.coffeeListQuerySchema.safeParse(query).success).toBe(false);
    expect(contracts.coffeeIdSchema.safeParse('not-uuid').success).toBe(false);
  });
  it('normalizes minimal manual input without inventing metadata', () => {
    expect(contracts.coffeeCreateSchema?.parse({ name: ' Lot ', roaster: ' Roaster ' })).toEqual({
      name: 'Lot',
      roaster: 'Roaster',
      country: null,
      region: null,
      farmStation: null,
      producer: null,
      variety: null,
      process: null,
      elevation: null,
      roastDate: null,
      tastingNotes: [],
    });
  });
});

describe('production coffee route boundary', () => {
  it.each(['injection', 'HTTP'])(
    'keeps coffee escape routes private over %s',
    async (transport) => {
      const chunks = [];
      const capture = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });
      const app = createApp();
      let port;
      try {
        if (transport === 'HTTP') {
          await app.listen({ host: '127.0.0.1', port: 0 });
          port = app.server.address().port;
        }
        const send = async (method, url) => {
          const payload = ['POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'].includes(method)
            ? JSON.stringify({ note: 'private-body-sentinel' })
            : undefined;
          if (transport === 'injection') {
            const response = await app.inject({
              method,
              url,
              payload,
              headers: payload ? { 'content-type': 'application/json' } : {},
            });
            return { status: response.statusCode, headers: response.headers, body: response.body };
          }
          return new Promise((resolve, reject) => {
            const request = httpRequest(
              {
                host: '127.0.0.1',
                port,
                method,
                path: url,
                headers: payload
                  ? {
                      'content-type': 'application/json',
                      'content-length': Buffer.byteLength(payload),
                    }
                  : {},
              },
              (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                  body += chunk;
                });
                response.on('end', () =>
                  resolve({ status: response.statusCode, headers: response.headers, body }),
                );
              },
            );
            request.on('error', reject);
            request.end(payload);
          });
        };
        expect(JSON.parse((await send('GET', '/health')).body)).toEqual({ status: 'ok' });
        expect(JSON.parse((await send('GET', '/api/v1/health')).body)).toEqual({ status: 'ok' });
        expect((await send('GET', '/ready')).status).toBe(503);
        for (const url of [
          '/unknown',
          '/api/v1/coffees-other',
          '/api/v1/brews-other',
          '/api/v1/auth/unknown',
        ]) {
          const response = await send('GET', url);
          expect(response.status).toBe(404);
          expect(JSON.parse(response.body)).toEqual({
            message: `Route GET:${url} not found`,
            error: 'Not Found',
            statusCode: 404,
          });
          expect(response.headers['cache-control']).toBeUndefined();
          expect(response.headers.vary).toBeUndefined();
        }
        const unrelated = await send('GET', '/unrelated/%ZZ');
        expect(unrelated.status).toBe(400);
        expect(JSON.parse(unrelated.body)).toEqual({
          error: 'Bad Request',
          code: 'FST_ERR_BAD_URL',
          message: "'/unrelated/%ZZ' is not a valid url component",
          statusCode: 400,
        });
        expect(unrelated.headers['cache-control']).toBeUndefined();
        for (const [method, status, message] of [
          ['GET', 503, 'Authentication unavailable'],
          ['POST', 404, 'Resource not found'],
        ]) {
          const response = await send(method, '/api/v1/coffees/?note=private-query-sentinel');
          expect(response.status).toBe(status);
          expect(JSON.parse(response.body)).toEqual({ message });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers.vary).toBe('Cookie');
        }
        const cases = [];
        for (const method of ['PUT', 'OPTIONS']) cases.push([method, '/private-resource-id', 404]);
        for (const method of ['PATCH', 'DELETE', 'PUT', 'OPTIONS']) {
          cases.push([method, '', 404], [method, '?private=private-query-sentinel', 404]);
        }
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS', 'HEAD']) {
          cases.push(
            [method, '/private-resource-id/unmatched/', 404],
            [method, '/private-resource-id/unmatched', 404],
          );
          for (const suffix of [
            '/private-resource-id%ZZ',
            '/private-resource-id%',
            '/private-resource-id/unmatched%ZZ',
            '/private-resource-id/unmatched%',
          ]) {
            cases.push([method, suffix, ['PUT', 'OPTIONS'].includes(method) ? 404 : 400]);
          }
        }
        for (const [method, suffix, status] of cases) {
          const url = `/api/v1/coffees${suffix}${suffix.includes('?') ? '&' : '?'}note=private-query-sentinel`;
          const response = await send(method, url);
          expect(response.status, `${method} ${suffix}`).toBe(status);
          if (method === 'HEAD' && transport === 'HTTP') expect(response.body).toBe('');
          else if (method !== 'HEAD' || response.body !== '')
            expect(JSON.parse(response.body)).toEqual({
              message: status === 400 ? 'Invalid coffee request' : 'Resource not found',
            });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(
            response.headers.vary.split(',').map((value) => value.trim().toLowerCase()),
          ).toContain('cookie');
          for (const sentinel of [
            'private-resource-id',
            'private-query-sentinel',
            'private-body-sentinel',
            '%ZZ',
          ])
            expect(response.body).not.toContain(sentinel);
        }
        await app.close();
        await setImmediate();
        const output = chunks.join('');
        expect(output).toContain('incoming request');
        expect(output).toContain('request completed');
        expect(output).toContain('/health');
        for (const sentinel of [
          'private-resource-id',
          'private-query-sentinel',
          'private-body-sentinel',
          '%ZZ',
        ])
          expect(output).not.toContain(sentinel);
      } finally {
        await app.close();
        capture.mockRestore();
        if (port)
          await new Promise((resolve, reject) => {
            const socket = connect({ host: '127.0.0.1', port });
            socket.on('connect', () => {
              socket.destroy();
              reject(new Error('Owned API port still open'));
            });
            socket.on('error', (error) => {
              expect(error.code).toBe('ECONNREFUSED');
              resolve();
            });
          });
      }
    },
  );
  it('authenticates before unavailable domain work and enforces origins', async () => {
    let lookups = 0;
    const user = { id: 'owner', name: 'Owner', email: 'owner@example.test' };
    const app = createApp({
      auth: {
        origin: 'http://127.0.0.1:4317',
        handler: async () => new globalThis.Response(),
        getSession: async () => {
          lookups++;
          return {
            headers: new globalThis.Headers(),
            response: {
              user,
              session: { id: 'session', userId: user.id, expiresAt: new Date(Date.now() + 60000) },
            },
          };
        },
      },
    });
    try {
      const denied = await app.inject({
        method: 'POST',
        url: '/api/v1/coffees',
        payload: { name: 'N', roaster: 'R' },
      });
      expect(denied.statusCode).toBe(403);
      expect(lookups).toBe(0);
      const response = await app.inject({ url: '/api/v1/coffees' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ message: 'Coffee service unavailable' });
      expect(lookups).toBe(1);
      const invalid = await app.inject({ url: '/api/v1/coffees?limit=1&limit=2' });
      expect(invalid.statusCode).toBe(400);
      const unsupported = await app.inject({
        method: 'POST',
        url: '/api/v1/coffees',
        headers: { 'content-type': 'application/x-private' },
        payload: 'parser-secret',
      });
      expect(unsupported.statusCode).toBe(415);
      expect(unsupported.json()).toEqual({ message: 'Invalid coffee request' });
      expect(unsupported.headers['cache-control']).toBe('no-store');
      expect(unsupported.headers.vary).toBe('Cookie');
      const large = await app.inject({
        method: 'POST',
        url: '/api/v1/coffees',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'x'.repeat(1048576) }),
      });
      expect(large.statusCode).toBe(413);
      expect(large.json()).toEqual({ message: 'Invalid coffee request' });
      expect(large.headers['cache-control']).toBe('no-store');
      expect(large.headers.vary).toBe('Cookie');
      expect((await app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
  it('fails closed without authority and marks parser failures private', async () => {
    const app = createApp();
    try {
      const response = await app.inject({ url: '/api/v1/coffees' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ message: 'Authentication unavailable' });
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/v1/coffees',
        headers: { 'content-type': 'application/json' },
        payload: '{"private-sentinel":',
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ message: 'Invalid coffee request' });
      expect(malformed.headers['cache-control']).toBe('no-store');
      expect(malformed.headers.vary).toBe('Cookie');
    } finally {
      await app.close();
    }
  });
});
