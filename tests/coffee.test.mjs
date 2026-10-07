import { describe, expect, it } from 'vitest';
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
