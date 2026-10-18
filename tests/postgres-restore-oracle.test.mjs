import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';

const names = [
  'public.user',
  'public.account',
  'public.session',
  'public.verification',
  'cupmemo.coffees',
  'cupmemo.brews',
  'cupmemo.brew_pours',
  'cupmemo.coffee_tasting_notes',
  'cupmemo.brew_tasting_tags',
  'drizzle.__drizzle_migrations',
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const binding = {
  archiveSha256: 'a'.repeat(64),
  releaseCommit: 'b'.repeat(40),
  releaseTree: 'c'.repeat(40),
};
function oracle() {
  return {
    version: 2,
    ...binding,
    catalogSha256: 'd'.repeat(64),
    rowCounts: Object.fromEntries(names.map((n) => [n, '0'])),
    observedAt: '2026-10-17T00:00:00.000Z',
  };
}
test('external oracle preserves explicit zeros and full uint64 precision, refuses unbound/inferred expectations', async () => {
  const { parseExpectations } =
    await import('../infrastructure/scripts/postgres-restore-oracle.mjs');
  const o = oracle();
  o.rowCounts['public.user'] = '18446744073709551615';
  const bytes = JSON.stringify(o);
  expect(parseExpectations(bytes, sha(bytes), binding)).toEqual(o);
  for (const mutate of [
    (o) => {
      delete o.rowCounts['public.user'];
    },
    (o) => {
      o.rowCounts['public.user'] = 0;
    },
    (o) => {
      o.rowCounts['public.user'] = '01';
    },
    (o) => {
      o.rowCounts['public.user'] = '18446744073709551616';
    },
    (o) => {
      o.rowCounts.extra = '0';
    },
    (o) => {
      o.extra = true;
    },
    (o) => {
      o.archiveSha256 = 'e'.repeat(64);
    },
    (o) => {
      o.releaseCommit = 'e'.repeat(40);
    },
    (o) => {
      o.releaseTree = 'e'.repeat(40);
    },
    (o) => {
      o.catalogSha256 = 'D'.repeat(64);
    },
    (o) => {
      o.observedAt = '2026-02-30T00:00:00.000Z';
    },
    (o) => {
      o.version = '1';
    },
  ]) {
    const invalid = oracle();
    mutate(invalid);
    const bytes = JSON.stringify(invalid);
    expect(() => parseExpectations(bytes, sha(bytes), binding)).toThrow('restore refused');
  }
  expect(() => parseExpectations(bytes, '0'.repeat(64), binding)).toThrow();
});

function catalog() {
  return {
    version: 2,
    tables: names.map((n) => [...n.split('.'), 'r', 'p', false, false]),
    columns: names.map((n) => [...n.split('.'), 1, 'id', 'text', true, null, '', '']),
    constraints: names.map((n) => [
      ...n.split('.'),
      'synthetic_pk',
      'p',
      'PRIMARY KEY (id)',
      true,
      false,
      false,
    ]),
    indexes: names.map((n) => [
      ...n.split('.'),
      'synthetic_pk',
      'CREATE UNIQUE INDEX synthetic',
      true,
      true,
      true,
      true,
    ]),
  };
}
test('canonical catalog ordering is stable and typed; oracle detects any definition corruption', async () => {
  const { canonicalCatalog } =
    await import('../infrastructure/scripts/postgres-restore-oracle.mjs');
  const c = catalog();
  const canonical = canonicalCatalog(c);
  const reverse = globalThis.structuredClone(c);
  for (const k of ['tables', 'columns', 'constraints', 'indexes']) reverse[k].reverse();
  expect(canonicalCatalog(reverse)).toBe(canonical);
  for (const [array, field, value] of [
    ['columns', 4, 'integer'],
    ['columns', 6, 'now()'],
    ['constraints', 4, 'PRIMARY KEY (other)'],
    ['indexes', 3, 'corrupted'],
  ]) {
    const changed = catalog();
    changed[array][0][field] = value;
    expect(sha(canonicalCatalog(changed))).not.toBe(sha(canonical));
  }
  for (const mutate of [
    (c) => {
      c.tables[0][4] = true;
    },
    (c) => {
      c.tables.push(['public', 'extra', 'r', 'p', false, false]);
    },
    (c) => {
      c.columns[0][2] = '1';
    },
    (c) => {
      c.constraints[0][5] = false;
    },
    (c) => {
      c.indexes[0][6] = false;
    },
    (c) => {
      c.constraints = [];
    },
    (c) => {
      c.columns[0][4] = null;
    },
    (c) => {
      c.tables[0][3] = 'u';
    },
    (c) => {
      c.columns.push(c.columns[0]);
    },
  ]) {
    const invalid = catalog();
    mutate(invalid);
    expect(() => canonicalCatalog(invalid)).toThrow();
  }
});

test('v2 refuses original v1 expectations and catalog rather than reinterpreting their bytes', async () => {
  const { parseExpectations, canonicalCatalog } =
    await import('../infrastructure/scripts/postgres-restore-oracle.mjs');
  const legacy = JSON.stringify({ ...oracle(), version: 1 });
  expect(() => parseExpectations(legacy, sha(legacy), binding)).toThrow('restore refused');
  expect(() => canonicalCatalog({ ...catalog(), version: 1 })).toThrow('restore refused');
  expect(JSON.parse(canonicalCatalog(catalog())).version).toBe(2);
});

test('v2 fingerprints native CHECK semantics exactly and retains every constraint metadata field', async () => {
  const { canonicalCatalog } =
    await import('../infrastructure/scripts/postgres-restore-oracle.mjs');
  const source = catalog();
  source.constraints.push([
    'cupmemo',
    'brews',
    'same_check',
    'c',
    'CHECK (dose_grams > 0::numeric)',
    true,
    false,
    false,
  ]);
  const baseline = canonicalCatalog(source);
  expect(JSON.parse(baseline).constraints).toContainEqual(source.constraints.at(-1));
  const mutated = globalThis.structuredClone(source);
  mutated.constraints.at(-1)[4] = 'CHECK (dose_grams > 1::numeric)';
  expect(sha(canonicalCatalog(mutated))).not.toBe(sha(baseline));
  for (const [field, value] of [
    [5, false],
    [6, true],
    [7, true],
  ]) {
    const invalid = globalThis.structuredClone(source);
    invalid.constraints.at(-1)[field] = value;
    expect(() => canonicalCatalog(invalid)).toThrow('restore refused');
  }
});
