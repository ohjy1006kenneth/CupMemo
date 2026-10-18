// Synthetic DB boundary only; no PostgreSQL connection or real catalog/data proof.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
export const directory = fileURLToPath(
  new URL('../../packages/database/drizzle/', import.meta.url),
);
export const names = [
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
export function syntheticCatalog() {
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
export async function databaseFixture(overrides = {}) {
  const journal = JSON.parse(await readFile(`${directory}meta/_journal.json`, 'utf8'));
  const history = await Promise.all(
    journal.entries.map(async (e) => ({
      hash: createHash('sha256')
        .update(await readFile(`${directory}${e.tag}.sql`))
        .digest('hex'),
      created_at: String(e.when),
    })),
  );
  const seen = [];
  const identity = {
    version: '170009',
    database: 'cupmemo_test_restore48',
    username: 'fixture',
    address: '127.0.0.1',
    port: 55499,
    owner: true,
    safe_role: true,
  };
  const c = syntheticCatalog();
  const query = async (sql) => {
    seen.push(sql);
    if (overrides.denied) throw new Error('private SQL/password must never escape');
    let rows = [];
    if (sql.includes('restore:identity')) rows = [{ ...identity, ...overrides.identity }];
    else if (sql.includes('restore:inventory'))
      rows = [
        {
          schemas: ['public'],
          extensions: ['plpgsql'],
          unsupported: '0',
          relations: '0',
          sequences: [],
          ...overrides.inventory,
        },
      ];
    else if (sql.includes('restore:catalog:')) {
      const key = /restore:catalog:(\w+)/.exec(sql)[1];
      rows = (overrides.catalog ?? c)[key].map((tuple) => ({ tuple }));
    } else if (sql.includes('restore:count:')) {
      const name = /restore:count:([^ *]+)/.exec(sql)[1];
      rows = [{ count: overrides.count ?? (name === 'drizzle.__drizzle_migrations' ? '3' : '0') }];
    } else if (sql.includes('restore:orphan:')) rows = [{ count: overrides.orphan ?? '0' }];
    else if (sql.includes('AS table_name')) rows = [{ table_name: 'drizzle.__drizzle_migrations' }];
    else if (sql.includes('SELECT hash, created_at')) rows = overrides.history ?? history;
    return { rows };
  };
  return { query, seen, catalog: c, identity };
}
