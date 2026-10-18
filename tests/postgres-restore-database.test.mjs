import { expect, test } from 'vitest';
import { directory, names, databaseFixture } from './helpers/restore-fixture.mjs';

test('read-only snapshot validates exact target, PG17, ownership, empty inventory and role', async () => {
  const { preflight } = await import('../infrastructure/scripts/postgres-restore-database.mjs');
  const f = await databaseFixture();
  await preflight(f.query, f.identity);
  expect(f.seen[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  expect(f.seen).toContain('SET LOCAL search_path = pg_catalog');
  expect(f.seen.at(-1)).toBe('ROLLBACK');
  const inventory = f.seen.find((s) => s.includes('restore:inventory'));
  for (const catalog of [
    'pg_rewrite',
    'pg_inherits',
    'pg_ts_config',
    'pg_ts_dict',
    'pg_ts_parser',
    'pg_ts_template',
    'pg_sequence',
  ])
    expect(inventory).toContain(`pg_catalog.${catalog}`);
  for (const overrides of [
    { identity: { version: '160009' } },
    { identity: { database: 'production' } },
    { identity: { username: 'other' } },
    { identity: { address: '192.0.2.1' } },
    { identity: { port: 5432 } },
    { identity: { owner: false } },
    { identity: { safe_role: false } },
    { inventory: { relations: '1' } },
    { inventory: { schemas: ['public', 'cupmemo'] } },
    { inventory: { unsupported: '1' } },
    { inventory: { extensions: ['plpgsql', 'dblink'] } },
    { denied: true },
  ]) {
    const bad = await databaseFixture(overrides);
    await expect(preflight(bad.query, f.identity)).rejects.toThrow();
  }
});

test('postchecks compare trusted catalog, all exact counts, journal and eight zero-orphan relationships', async () => {
  const { verifyRestored } =
    await import('../infrastructure/scripts/postgres-restore-database.mjs');
  const { canonicalCatalog, sha256 } =
    await import('../infrastructure/scripts/postgres-restore-oracle.mjs');
  const f = await databaseFixture({
    inventory: {
      schemas: ['public', 'cupmemo', 'drizzle'],
      relations: '33',
      sequences: [['drizzle', '__drizzle_migrations_id_seq', true]],
    },
  });
  const oracle = {
    catalogSha256: sha256(canonicalCatalog(f.catalog)),
    rowCounts: Object.fromEntries(
      names.map((n) => [n, n === 'drizzle.__drizzle_migrations' ? '3' : '0']),
    ),
  };
  await verifyRestored(f.query, f.identity, oracle, directory);
  expect(f.seen.filter((s) => s.includes('restore:count:'))).toHaveLength(10);
  expect(f.seen.filter((s) => s.includes('restore:orphan:'))).toHaveLength(8);
  expect(f.seen.every((s) => !/^(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|TRUNCATE)/i.test(s))).toBe(
    true,
  );
  for (const overrides of [
    { count: '9007199254740993' },
    { orphan: '1' },
    { history: [] },
    { catalog: { ...f.catalog, indexes: [] } },
    { inventory: { unsupported: '1' } },
    { denied: true },
  ]) {
    const bad = await databaseFixture(overrides);
    await expect(verifyRestored(bad.query, f.identity, oracle, directory)).rejects.toThrow();
  }
});
