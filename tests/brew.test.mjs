import { describe, expect, it, vi } from 'vitest';
import process from 'node:process';
import { setImmediate } from 'node:timers/promises';
import * as contracts from '../packages/contracts/src/index.ts';
import { createApp } from '../apps/api/src/app.ts';

const recipe = {
  coffeeId: 'f59e0f50-a5db-4e5a-8e3e-b04926173d24',
  brewer: ' V60 ',
  grinder: ' Hand ',
  grindSetting: ' 22 clicks ',
  doseGrams: 15,
  waterGrams: 0.3,
  waterTemperatureC: 93,
  totalBrewTimeSeconds: 120,
  brewedAt: '2024-02-29T12:30:00.12+02:00',
  overallScore: 0,
  pours: [
    { waterGrams: 0.1, startTimeSeconds: 10 },
    { waterGrams: 0.2, startTimeSeconds: 120 },
  ],
};
describe('brew contracts', () => {
  it('accepts incremental decimal sums and quick-only input without seeded assessment', () => {
    expect(contracts.brewCreateSchema?.parse(recipe)).toEqual({
      ...recipe,
      brewer: 'V60',
      grinder: 'Hand',
      grindSetting: '22 clicks',
      brewedAt: '2024-02-29T10:30:00.120Z',
      acidity: null,
      body: null,
      aftertaste: null,
      tastingTags: [],
      notes: null,
    });
  });
  it('validates decimals exactly without coercion or epsilon mismatch allowance', () => {
    for (const value of [0.1, 0.29, 15, 99999.99])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, doseGrams: value }).success).toBe(
        true,
      );
    for (const value of [0, -1, 100000, 0.001, 15.001, NaN, Infinity, '15', null])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, doseGrams: value }).success).toBe(
        false,
      );
    expect(contracts.brewCreateSchema.safeParse({ ...recipe, waterGrams: 0.31 }).success).toBe(
      false,
    );
    expect(contracts.brewCreateSchema.safeParse({ ...recipe, waterGrams: 0.1 + 0.2 }).success).toBe(
      false,
    );
  });
  it('validates calendar/time/offset and normalized year bounds', () => {
    for (const brewedAt of [
      '0001-01-01T00:00:00Z',
      '9999-12-31T23:59:59.999Z',
      '2000-02-29T00:00:00-04:00',
    ])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, brewedAt }).success).toBe(true);
    for (const brewedAt of [
      '1900-02-29T00:00:00Z',
      '2024-04-31T00:00:00Z',
      '2024-01-01T00:00:60Z',
      '2024-01-01T24:00:00Z',
      '2024-01-01T00:00:00',
      '2024-01-01T00:00:00.0001Z',
      '0001-01-01T00:00:00+01:00',
      '9999-12-31T23:59:59-01:00',
      '0000-01-01T00:00:00Z',
      '2024-01-01T00:00:00+24:00',
    ])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, brewedAt }).success).toBe(false);
  });
  it('has independent quarter-point scores and null distinct from zero', () => {
    for (const overallScore of [0, 0.25, 87.25, 100])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, overallScore }).success).toBe(true);
    for (const overallScore of [-0.25, 100.25, 1.1, '87', NaN, Infinity])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, overallScore }).success).toBe(false);
    for (const acidity of [0, 0.25, 10, null])
      expect(contracts.brewCreateSchema.parse({ ...recipe, acidity }).acidity).toBe(acidity);
    for (const acidity of [-0.25, 10.25, 0.1, '8'])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, acidity }).success).toBe(false);
  });
  it('enforces strict incremental schedules including equal starts and duration boundary', () => {
    expect(
      contracts.brewCreateSchema.safeParse({
        ...recipe,
        pours: recipe.pours.map((p) => ({ ...p, startTimeSeconds: 120 })),
      }).success,
    ).toBe(true);
    for (const pours of [
      [],
      Array.from({ length: 33 }, () => ({ waterGrams: 0.01, startTimeSeconds: 0 })),
      [{ waterGrams: 0.3, startTimeSeconds: 121 }],
      [{ waterGrams: 0.3, startTimeSeconds: -1 }],
      [{ waterGrams: 0.3, startTimeSeconds: 1.5 }],
      [{ waterGrams: 0.3, startTimeSeconds: 10, position: 0 }],
      [
        { waterGrams: 0.2, startTimeSeconds: 20 },
        { waterGrams: 0.1, startTimeSeconds: 10 },
      ],
    ])
      expect(contracts.brewCreateSchema.safeParse({ ...recipe, pours }).success).toBe(false);
  });
  it('preserves patch omission with no defaults and rejects forbidden fields', () => {
    expect(contracts.brewPatchSchema.parse({ notes: ' ', tastingTags: [], acidity: null })).toEqual(
      { notes: null, tastingTags: [], acidity: null },
    );
    expect(contracts.brewPatchSchema.parse({ overallScore: 0 })).toEqual({ overallScore: 0 });
    for (const patch of [
      {},
      { notes: undefined },
      { coffeeId: recipe.coffeeId },
      { ownerId: 'x' },
      { id: recipe.coffeeId },
      { createdAt: recipe.brewedAt },
      { tastingMode: 'quick' },
      { flavor: 8 },
      { ratio: 20 },
      { archive: true },
      { pours: [] },
    ])
      expect(contracts.brewPatchSchema.safeParse(patch).success).toBe(false);
    expect(
      contracts.brewCreateSchema.parse({
        ...recipe,
        tastingTags: ['z', ' Apple ', 'apple'],
        notes: ' note ',
      }).tastingTags,
    ).toEqual(['Apple', 'apple', 'z']);
    for (const tastingTags of [
      ['a', ' a '],
      [' '],
      ['x'.repeat(101)],
      Array.from({ length: 33 }, (_, i) => String(i)),
    ])
      expect(contracts.brewPatchSchema.safeParse({ tastingTags }).success).toBe(false);
    expect(contracts.brewPatchSchema.safeParse({ notes: 'x'.repeat(5001) }).success).toBe(false);
    expect(contracts.brewPatchSchema.safeParse({ brewer: '😀'.repeat(101) }).success).toBe(false);
  });
  it('bounds strict pagination and refuses invalid persisted output without repair', () => {
    expect(contracts.brewListQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(
      contracts.brewListQuerySchema.parse({
        coffeeId: recipe.coffeeId,
        limit: '100',
        offset: '100000',
      }),
    ).toEqual({ coffeeId: recipe.coffeeId, limit: 100, offset: 100000 });
    for (const query of [
      { limit: ['1', '2'] },
      { limit: '0' },
      { limit: '101' },
      { limit: '+1' },
      { limit: '1e1' },
      { limit: '1.0' },
      { offset: '100001' },
      { coffeeId: 'x' },
      { ownerId: 'x' },
    ])
      expect(contracts.brewListQuerySchema.safeParse(query).success).toBe(false);
    const brew = {
      ...contracts.brewCreateSchema.parse(recipe),
      id: recipe.coffeeId,
      tastingMode: 'sensory',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      pours: recipe.pours.map((p, position) => ({ ...p, position })),
    };
    expect(contracts.brewSchema.parse(brew)).toEqual(brew);
    for (const extra of [
      { brewer: ' padded ' },
      { notes: ' ' },
      { tastingTags: ['B', 'A'] },
      { ownerId: 'x' },
      { waterGrams: '0.3' },
      { brewedAt: recipe.brewedAt },
      { pours: brew.pours.map((p) => ({ ...p, position: p.position + 1 })) },
      { flavor: 8 },
    ])
      expect(contracts.brewSchema.safeParse({ ...brew, ...extra }).success).toBe(false);
  });
});

describe('production brew boundary', () => {
  it.each([
    ['PUT', '/api/v1/brews/private-resource-id', 404],
    ['GET', '/api/v1/brews/private-resource-id/unknown', 404],
    ['GET', '/api/v1/brews/private-resource-id%ZZ', 400],
    ['GET', '/api/v1/brews/private-resource-id/unknown%ZZ', 400],
  ])('sanitizes %s %s with actual request-log positive controls', async (method, path, status) => {
    const chunks = [];
    const capture = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const app = createApp();
    try {
      expect((await app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
      const response = await app.inject({ method, url: `${path}?private=private-query-sentinel` });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({
        message: status === 400 ? 'Invalid brew request' : 'Resource not found',
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.vary).toBe('Cookie');
      await app.close();
      await setImmediate();
      const output = chunks.join('');
      expect(output).toContain('incoming request');
      expect(output).toContain('request completed');
      expect(output).toContain('/health');
      for (const sentinel of ['private-resource-id', 'private-query-sentinel', '%ZZ']) {
        expect(response.body).not.toContain(sentinel);
        expect(output).not.toContain(sentinel);
      }
    } finally {
      await app.close();
      capture.mockRestore();
    }
  });
  it('preserves unrelated not-found and malformed-path routing', async () => {
    const app = createApp();
    try {
      for (const url of ['/unrelated', '/api/v1/brews-other']) {
        const response = await app.inject({ url });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          message: `Route GET:${url} not found`,
          error: 'Not Found',
          statusCode: 404,
        });
        expect(response.headers['cache-control']).toBeUndefined();
        expect(response.headers.vary).toBeUndefined();
      }
      const response = await app.inject({ url: '/api/v1/coffees/%ZZ' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'Bad Request',
        code: 'FST_ERR_BAD_URL',
        message: "'/api/v1/coffees/%ZZ' is not a valid url component",
        statusCode: 400,
      });
    } finally {
      await app.close();
    }
  });
  it('rejects unsafe origins before authority and valid input before unavailable domain work', async () => {
    let lookups = 0;
    const user = { id: 'owner', name: 'Owner', email: 'owner@example.test' };
    const app = createApp({
      auth: {
        origin: 'http://127.0.0.1:3314',
        handler: async () => new globalThis.Response(),
        getSession: async () => {
          lookups++;
          return {
            headers: new globalThis.Headers(),
            response: {
              user,
              session: { id: 's', userId: user.id, expiresAt: new Date(Date.now() + 60000) },
            },
          };
        },
      },
    });
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/brews', payload: recipe })).statusCode,
      ).toBe(403);
      expect(lookups).toBe(0);
      const unavailable = await app.inject({
        method: 'POST',
        url: '/api/v1/brews',
        headers: { origin: 'http://127.0.0.1:3314' },
        payload: recipe,
      });
      expect(unavailable.statusCode).toBe(503);
      expect(unavailable.json()).toEqual({ message: 'Brew service unavailable' });
      expect((await app.inject({ url: '/api/v1/brews?limit=1&limit=2' })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/v1/brews/not-uuid' })).statusCode).toBe(400);
      expect((await app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
  it('fails closed through the existing authority and sanitizes parser errors', async () => {
    const app = createApp();
    try {
      const response = await app.inject({ url: '/api/v1/brews' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ message: 'Authentication unavailable' });
      const malformed = await app.inject({
        method: 'POST',
        url: '/api/v1/brews',
        headers: { 'content-type': 'application/json' },
        payload: '{"private-sentinel":',
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ message: 'Invalid brew request' });
      expect(malformed.headers['cache-control']).toBe('no-store');
      expect(malformed.headers.vary).toBe('Cookie');
    } finally {
      await app.close();
    }
  });
});
