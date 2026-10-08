import { test, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import * as contracts from '../packages/contracts/dist/index.js';
import {
  buildDocument,
  validateDocument,
  checkArtifact,
  serializeDocument,
  projectSchema,
} from '../apps/api/scripts/openapi.ts';
import { createApp } from '../apps/api/src/app.ts';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Ajv = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const document = buildDocument();
const valid = (name, value) =>
  ajv.compile({ ...document.components.schemas[name], components: document.components })(value);
const recipe = {
  coffeeId: '00000000-0000-4000-8000-000000000001',
  brewer: 'V60',
  grinder: 'Example grinder',
  grindSetting: '6.2',
  doseGrams: 20,
  waterGrams: 300,
  waterTemperatureC: 94,
  totalBrewTimeSeconds: 180,
  brewedAt: '2026-01-02T10:00:00+02:00',
  overallScore: 87.25,
  pours: [
    { waterGrams: 60, startTimeSeconds: 0 },
    { waterGrams: 240, startTimeSeconds: 45 },
  ],
};

test('all current v1 operations have accurate security, statuses and bodyless deletes', () => {
  expect(Object.keys(document.paths)).toHaveLength(10);
  expect(Object.values(document.paths).flatMap(Object.keys)).toHaveLength(16);
  for (const resource of ['coffees', 'brews']) {
    const paths = document.paths[`/api/v1/${resource}`];
    expect(paths.post.security).toEqual([{ sessionCookie: [] }]);
    expect(paths.post.responses['201']).toBeDefined();
    expect(paths.post.parameters.find((p) => p.name === 'Origin').required).toBe(true);
    expect(
      document.paths[`/api/v1/${resource}/{id}`].delete.responses['204'].content,
    ).toBeUndefined();
  }
  expect(document.paths['/api/v1/auth/get-session'].get.security).toEqual([
    {},
    { sessionCookie: [] },
  ]);
  expect(document.paths['/api/v1/auth/sign-out'].post.security).toEqual([
    {},
    { sessionCookie: [] },
  ]);
  expect(document.paths['/api/v1/health'].get.security).toEqual([]);
});

test('raw domain requests agree with Zod for expressible constraints and preserve defaults/patch omission', () => {
  const cases = {
    CoffeeCreate: [
      contracts.coffeeCreateSchema,
      [
        { name: 'Example coffee', roaster: 'Example roaster' },
        { name: 'x', roaster: 'y', country: null },
        { name: 'x', roaster: 'y', ownerId: 'x' },
        { name: 0, roaster: 'y' },
      ],
    ],
    CoffeePatch: [contracts.coffeePatchSchema, [{ country: null }, {}, { ownerId: 'x' }]],
    BrewCreate: [
      contracts.brewCreateSchema,
      [
        recipe,
        { ...recipe, tastingMode: 'sensory', flavor: 0, balance: null },
        { ...recipe, flavor: 10.25 },
        { ...recipe, overallScore: 87.1 },
        { ...recipe, doseGrams: 0 },
        { ...recipe, waterGrams: '300' },
        { ...recipe, pours: [] },
        { ...recipe, ownerId: 'x' },
      ],
    ],
    BrewPatch: [
      contracts.brewPatchSchema,
      [
        { flavor: 0, balance: null },
        { tastingMode: 'quick' },
        {},
        { coffeeId: recipe.coffeeId },
        { tastingMode: null },
      ],
    ],
    CoffeeListQuery: [
      contracts.coffeeListQuerySchema,
      [
        {},
        { limit: '1', offset: '0' },
        { limit: 1 },
        { limit: ['1', '2'] },
        { limit: '-1' },
        { unknown: '1' },
      ],
    ],
  };
  for (const [name, [schema, values]] of Object.entries(cases)) {
    for (const value of values)
      expect(valid(name, value), `${name}: ${JSON.stringify(value)}`).toBe(
        schema.safeParse(value).success,
      );
  }
  expect(document.components.schemas.CoffeeCreate.required).toEqual(['name', 'roaster']);
  expect(document.components.schemas.BrewCreate.required).not.toContain('tastingMode');
  expect(document.components.schemas.BrewPatch.properties.flavor.default).toBeUndefined();
  expect(contracts.brewPatchSchema.parse({ flavor: 0 })).toEqual({ flavor: 0 });
});

test('all eight quality attributes preserve null/zero and quarter point bounds', () => {
  for (const field of [
    'acidity',
    'body',
    'aftertaste',
    'fragranceAroma',
    'flavor',
    'balance',
    'sweetness',
    'overallImpression',
  ]) {
    for (const value of [null, 0, 8.25, 10, -0.25, 10.25, 8.1, '8', false]) {
      const input = { ...recipe, [field]: value };
      expect(valid('BrewCreate', input)).toBe(contracts.brewCreateSchema.safeParse(input).success);
    }
  }
});

test('documented refinement limitations do not claim JSON Schema equivalence', () => {
  const mismatch = { ...recipe, waterGrams: 301 };
  expect(contracts.brewCreateSchema.safeParse(mismatch).success).toBe(false);
  expect(valid('BrewCreate', mismatch)).toBe(true);
  expect(document.components.schemas.BrewCreate['x-cupmemo-validation']).toBeDefined();
  expect(document.components.schemas.BrewPatch.description).toMatch(/merged/i);
  const longRaw = { name: ' '.repeat(300) + 'Coffee', roaster: 'Example roaster' };
  expect(contracts.coffeeCreateSchema.safeParse(longRaw).success).toBe(true);
  expect(valid('CoffeeCreate', longRaw)).toBe(true);
});

test('validation rejects broken refs, security, statuses and required schemas', async () => {
  for (const mutate of [
    (d) => {
      d.paths['/api/v1/me'].get.responses['200'].content['application/json'].schema.$ref =
        '#/components/schemas/Missing';
    },
    (d) => {
      d.paths['/api/v1/me'].get.security = [{ Missing: [] }];
    },
    (d) => {
      d.paths['/api/v1/coffees/{id}'].delete.responses['204'].content = {};
    },
    (d) => {
      delete d.components.schemas.BrewCreate.required;
    },
  ]) {
    const broken = globalThis.structuredClone(document);
    mutate(broken);
    await expect(validateDocument(broken)).rejects.toThrow();
  }
  await validateDocument(document);
});

test('offline OpenAPI builder is available without a database or auth configuration', async () => {
  expect(existsSync(new URL('../apps/api/scripts/openapi.ts', import.meta.url))).toBe(true);
  const { buildDocument, validateDocument } = await import('../apps/api/scripts/openapi.ts');
  const document = buildDocument();
  expect(document.openapi).toBe('3.1.0');
  await validateDocument(document);
});

test('freshness refuses drift and missing files without rewriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cupmemo-openapi-'));
  const file = join(directory, 'openapi.json');
  try {
    await writeFile(file, serializeDocument(document));
    await checkArtifact(file);
    await writeFile(file, '{}\n');
    await expect(checkArtifact(file)).rejects.toThrow(/stale/);
    expect(await readFile(file, 'utf8')).toBe('{}\n');
    await rm(file);
    await expect(checkArtifact(file)).rejects.toThrow();
    expect(existsSync(file)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('native conversion fails closed for an unsupported output transform', () => {
  expect(() => projectSchema(contracts.coffeeCreateSchema, 'output')).toThrow(/Transforms/);
});

test('actual Fastify route inventory matches the documented domain routes', async () => {
  const app = createApp({
    auth: { origin: 'http://127.0.0.1', handler: async () => new globalThis.Response('null') },
  });
  try {
    await app.ready();
    const actual = [];
    let parent;
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const match = /(\/\S*) \(([^)]+)\)/.exec(line);
      if (!match) continue;
      let path = match[1];
      if (path === '/:id') path = parent + '/{id}';
      else parent = path;
      if (!path.startsWith('/api/v1/') || path.startsWith('/api/v1/auth')) continue;
      for (const method of match[2].split(', '))
        if (method !== 'HEAD') actual.push(`${method.toLowerCase()} ${path}`);
    }
    const expected = Object.entries(document.paths)
      .filter(([path]) => !path.startsWith('/api/v1/auth'))
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method} ${path}`),
      );
    expect(actual.sort()).toEqual(expected.sort());
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/auth/*' })).toBe(true);
  } finally {
    await app.close();
  }
});

test('public projections match output Zod, require defaults and exclude ownership fields', () => {
  const timestamp = '2026-01-02T08:00:00.000Z';
  const normalized = contracts.brewCreateSchema.parse(recipe);
  const brew = {
    ...normalized,
    id: recipe.coffeeId,
    brewedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    pours: normalized.pours.map((pour, position) => ({ ...pour, position })),
  };
  expect(valid('Brew', brew)).toBe(true);
  expect(contracts.brewSchema.safeParse(brew).success).toBe(true);
  for (const value of [
    { ...brew, ownerId: 'x' },
    { ...brew, overallScore: 100.25 },
    { ...brew, tastingMode: 'Sensory' },
    { ...brew, pours: brew.pours.map(({ position: _position, ...pour }) => pour) },
  ]) {
    expect(valid('Brew', value)).toBe(false);
    expect(contracts.brewSchema.safeParse(value).success).toBe(false);
  }
  expect(Object.keys(document.components.schemas.Brew.properties).sort()).toEqual(
    Object.keys(brew).sort(),
  );
  const invalidCalendar = { ...recipe, brewedAt: '2026-02-30T10:00:00+02:00' };
  expect(contracts.brewCreateSchema.safeParse(invalidCalendar).success).toBe(false);
  expect(valid('BrewCreate', invalidCalendar)).toBe(true);
  for (const limit of ['0', '101', '000101', '1.0', '1e2', '+1', '100', '0001'])
    expect(valid('CoffeeListQuery', { limit })).toBe(
      contracts.coffeeListQuerySchema.safeParse({ limit }).success,
    );
  for (const offset of ['100000', '100001', '000100000', '0'])
    expect(valid('CoffeeListQuery', { offset })).toBe(
      contracts.coffeeListQuerySchema.safeParse({ offset }).success,
    );
  expect(valid('BrewCreate', { ...recipe, brewedAt: '2026-01-02T10:00:00' })).toBe(false);
});
