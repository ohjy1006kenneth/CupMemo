// Real synthetic-data integration worker. Invoked only inside the owned hosted
// container by recovery-drill.py; no production inputs or environment loading.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../packages/database/dist/index.js';
import { createAuth } from '../../apps/api/dist/auth.js';
import { createApp } from '../../apps/api/dist/app.js';
import { runBackup } from './postgres-backup.mjs';
import { runRestore } from './postgres-restore.mjs';
import { preflight } from './postgres-restore-database.mjs';
import { canonicalCatalog, sha256, tableNames } from './postgres-restore-oracle.mjs';

const root = '/drill';
const stage = process.argv[2];
const stages = ['prepare', 'restore', 'application', 'persistence'];
const origin = 'http://127.0.0.1:4101';
const directory = '/candidate/packages/database/drizzle';
const connections = [],
  apps = [];
let phase = 'configuration';
const checks = [];
const mark = (name, value = true) => checks.push({ check: name, value });
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
function write(name, value) {
  fs.writeFileSync(path.join(root, name), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
}
function env(kind, fixture) {
  const name = `cupmemo_test_t_b2e9cc04_${kind}`;
  return {
    NODE_ENV: 'development',
    CUPMEMO_DB_ENV: 'test',
    CUPMEMO_TEST_DATABASE: name,
    CUPMEMO_DATABASE_URL_TEST: `postgresql://drill_${kind}:${fixture.passwords[kind]}@127.0.0.1:5432/${name}?sslmode=disable`,
  };
}
function connect(kind, fixture) {
  const connection = createDatabase(env(kind, fixture).CUPMEMO_DATABASE_URL_TEST, {
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
  });
  connections.push(connection);
  return connection;
}
async function empty(connection, kind) {
  await preflight(
    async (sql) => {
      if (sql.includes('restore:identity')) phase = 'empty_' + kind + '_identity';
      if (sql.includes('restore:inventory')) phase = 'empty_' + kind + '_inventory';
      const result = await connection.pool.query(sql);
      if (sql.includes('restore:identity')) {
        const r = result.rows[0];
        mark('empty_' + kind + '_identity', {
          pg17: /^17[0-9]{4}$/.test(r?.version),
          exactDatabase: r?.database === `cupmemo_test_t_b2e9cc04_${kind}`,
          exactRole: r?.username === `drill_${kind}`,
          owner: r?.owner === true,
          safeRole: r?.safe_role === true,
          loopback: r?.address === '127.0.0.1',
          exactPort: r?.port === 5432,
        });
      }
      if (sql.includes('restore:inventory')) {
        const r = result.rows[0];
        mark('empty_' + kind + '_inventory', {
          relations: r?.relations,
          unsupported: r?.unsupported,
          onlyPublic: JSON.stringify(r?.schemas) === '["public"]',
          onlyPlpgsql: JSON.stringify(r?.extensions) === '["plpgsql"]',
          sequences: r?.sequences?.length,
        });
      }
      return result;
    },
    {
      database: `cupmemo_test_t_b2e9cc04_${kind}`,
      username: `drill_${kind}`,
      address: '127.0.0.1',
      port: 5432,
    },
  );
}
function runtime(connection, fixture) {
  const authority = createAuth(connection.db, {
    secret: fixture.authSecret,
    origin,
    production: false,
  });
  const app = createApp({
    db: connection.db,
    auth: {
      origin,
      handler: authority.handler,
      getSession: authority.api.getSession,
    },
  });
  app.log.level = 'silent';
  apps.push(app);
  return app;
}
async function request(app, method, url, payload, cookie) {
  return app.inject({
    method,
    url,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });
}
function cookies(response) {
  const list = response.headers['set-cookie'];
  assert.ok(list);
  return (Array.isArray(list) ? list : [list]).map((v) => v.split(';', 1)[0]).join('; ');
}
async function signin(app, fixture, email) {
  const r = await request(app, 'POST', '/api/v1/auth/sign-in/email', {
    email,
    password: fixture.accountPassword,
  });
  assert.equal(r.statusCode, 200);
  return cookies(r);
}
async function session(app, cookie, email) {
  const r = await request(app, 'GET', '/api/v1/auth/get-session', undefined, cookie);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json()?.user.email, email);
}
const recipe = (coffeeId) => ({
  coffeeId,
  brewer: 'V60',
  grinder: 'Synthetic mill',
  grindSetting: '22 clicks',
  doseGrams: 18.5,
  waterGrams: 300,
  waterTemperatureC: 94,
  totalBrewTimeSeconds: 180,
  overallScore: 87.25,
  brewedAt: '2026-01-02T03:04:05.000Z',
  tastingMode: 'sensory',
  acidity: 7.25,
  body: 6.5,
  aftertaste: 7,
  sweetness: 8,
  notes: 'Synthetic recovery witness',
  tastingTags: ['Floral', 'Peach'],
  pours: [
    { waterGrams: 50, startTimeSeconds: 0 },
    { waterGrams: 250, startTimeSeconds: 40 },
  ],
});
const identifier = (name) =>
  name
    .split('.')
    .map((v) => `"${v}"`)
    .join('.');

// ORIGINAL SOURCE only, before mutation of the target. These are fixed PG17
// catalog queries, not generated from target output or expectation-file SQL.
async function sourceCatalog(query) {
  const from = `FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace`;
  const scope = `n.nspname IN ('public','cupmemo','drizzle')`;
  const statements = {
    tables: `SELECT json_build_array(n.nspname,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity) AS tuple ${from} WHERE ${scope} AND c.relkind NOT IN ('i','S')`,
    columns: `SELECT json_build_array(n.nspname,c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated) AS tuple ${from} JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${scope} AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped`,
    constraints: `SELECT json_build_array(n.nspname,c.relname,k.conname,k.contype,pg_catalog.pg_get_constraintdef(k.oid,false),k.convalidated,k.condeferrable,k.condeferred) AS tuple ${from} JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid WHERE ${scope}`,
    indexes: `SELECT json_build_array(n.nspname,c.relname,ic.relname,pg_catalog.pg_get_indexdef(i.indexrelid),i.indisunique,i.indisprimary,i.indisvalid,i.indisready) AS tuple ${from} JOIN pg_catalog.pg_index i ON i.indrelid=c.oid JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid WHERE ${scope}`,
  };
  const catalog = { version: 1 };
  for (const [key, sql] of Object.entries(statements))
    catalog[key] = (await query(sql)).rows.map((r) => r.tuple);
  return sha256(canonicalCatalog(catalog));
}
async function snapshot(connection) {
  const query = (sql) => connection.pool.query(sql);
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await query('SET LOCAL search_path=pg_catalog');
    const rows = {},
      rowCounts = {};
    for (const table of tableNames) {
      // All synthetic row values, including credentials, remain in private RAM /
      // mode0600 files; never stdout/artifacts. Compare exact original bytes.
      rows[table] = (
        await query(
          `SELECT row_to_json(t)::text AS value FROM ${identifier(table)} t ORDER BY row_to_json(t)::text COLLATE "C"`,
        )
      ).rows.map((r) => r.value);
      rowCounts[table] = (
        await query(`SELECT count(*)::text AS count FROM ${identifier(table)}`)
      ).rows[0].count;
    }
    const sequence = (
      await query('SELECT last_value::text, is_called FROM drizzle.__drizzle_migrations_id_seq')
    ).rows;
    return { rows, rowCounts, sequence, catalogSha256: await sourceCatalog(query) };
  } finally {
    await query('ROLLBACK');
  }
}
function restoreEnv(fixture, input) {
  return {
    ...env('restore', fixture),
    CUPMEMO_RESTORE_CONFIRM_DATABASE: 'cupmemo_test_t_b2e9cc04_restore',
    CUPMEMO_PG_RESTORE_BIN: '/usr/lib/postgresql/17/bin/pg_restore',
    CUPMEMO_RESTORE_BUNDLE_DIR: input.bundle,
    CUPMEMO_RESTORE_EXPECTED_SHA256: input.archiveSha256,
    CUPMEMO_RESTORE_RELEASE_DIR: '/candidate',
    CUPMEMO_RESTORE_EXPECTATIONS_FILE: '/drill/expectations.json',
    CUPMEMO_RESTORE_EXPECTATIONS_SHA256: input.expectationsSha256,
    CUPMEMO_RESTORE_STATE_DIR: '/drill/state',
    CUPMEMO_RESTORE_TIMEOUT_MS: '120000',
  };
}
async function refusal(config, expectedPhase) {
  let failed;
  try {
    await runRestore(config);
  } catch (error) {
    failed = error.message;
  }
  assert.equal(failed, `restore failed phase=${expectedPhase} outcome=not_started`);
}
async function prepare(fixture) {
  phase = 'empty_identities';
  const source = connect('source', fixture),
    target = connect('restore', fixture);
  const nativeAddress = await source.pool.query(`SELECT
    pg_catalog.inet_server_addr()::text = '127.0.0.1/32' AS text_includes_mask,
    pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1' AS host_is_exact_loopback`);
  assert.equal(nativeAddress.rows[0].text_includes_mask, true);
  assert.equal(nativeAddress.rows[0].host_is_exact_loopback, true);
  mark('native_pg17_inet_text_mask_and_host_loopback_verified');
  await empty(source, 'source');
  await empty(target, 'restore');
  mark('pg17_empty_nonsuperuser_source_and_target');
  phase = 'source_migrations';
  const require = createRequire('/candidate/packages/database/package.json');
  const { migrate } = await import(
    pathToFileURL(require.resolve('drizzle-orm/node-postgres/migrator')).href
  );
  await migrate(source.db, { migrationsFolder: directory });
  const app = runtime(source, fixture);
  const users = [];
  phase = 'source_fixture';
  for (const index of [0, 1]) {
    const email = `recovery-${index}@example.test`;
    const r = await request(app, 'POST', '/api/v1/auth/sign-up/email', {
      email,
      name: `Synthetic owner ${index}`,
      password: fixture.accountPassword,
    });
    assert.equal(r.statusCode, 200);
    const cookie = cookies(r);
    await session(app, cookie, email);
    const c = await request(
      app,
      'POST',
      '/api/v1/coffees',
      {
        name: `Recovery coffee ${index}`,
        roaster: 'Synthetic roaster',
        country: 'Ethiopia',
        roastDate: '2026-01-01',
        tastingNotes: ['Peach', 'Jasmine'],
      },
      cookie,
    );
    assert.equal(c.statusCode, 201);
    const coffee = c.json().coffee;
    assert.ok(coffee.id);
    const b = await request(app, 'POST', '/api/v1/brews', recipe(coffee.id), cookie);
    assert.equal(b.statusCode, 201);
    users.push({ email, cookie, coffee, brew: b.json().brew });
  }
  write('users.json', users);
  // Close all app activity BEFORE independent source capture and actual dump.
  await app.close();
  phase = 'source_oracle';
  const before = await snapshot(source);
  assert.equal(before.rowCounts['public.user'], '2');
  assert.equal(before.rowCounts['public.account'], '2');
  assert.equal(before.rowCounts['cupmemo.brews'], '2');
  assert.equal(before.rowCounts['cupmemo.brew_pours'], '4');
  assert.equal(before.rowCounts['cupmemo.coffee_tasting_notes'], '4');
  assert.equal(before.rowCounts['cupmemo.brew_tasting_tags'], '4');
  assert.equal(before.rowCounts['drizzle.__drizzle_migrations'], '3');
  write('original-source.json', before);
  fs.mkdirSync('/drill/backups', { mode: 0o700 });
  phase = 'real_backup';
  const result = await runBackup({
    ...env('source', fixture),
    BACKUP_DIR: '/drill/backups',
    CUPMEMO_PG_DUMP_BIN: '/usr/lib/postgresql/17/bin/pg_dump',
    CUPMEMO_BACKUP_TIMEOUT_MS: '120000',
    CUPMEMO_BACKUP_MAX_BYTES: '16777216',
  });
  const bundle = '/drill/backups/cupmemo-backups-v1/' + result.published;
  const manifest = JSON.parse(fs.readFileSync(bundle + '/manifest.json', 'utf8'));
  const archiveSha256 = sha256(fs.readFileSync(bundle + '/database.dump'));
  assert.equal(archiveSha256, manifest.sha256);
  assert.equal(manifest.release.status, 'verified');
  assert.deepEqual(await snapshot(source), before); // source stayed quiescent
  const oracle = {
    version: 1,
    archiveSha256,
    releaseCommit: manifest.release.commit,
    releaseTree: manifest.release.tree,
    catalogSha256: before.catalogSha256,
    rowCounts: before.rowCounts,
    observedAt: new Date().toISOString(),
  };
  write('expectations.json', oracle);
  const expectationsSha256 = sha256(fs.readFileSync('/drill/expectations.json'));
  write('inputs.json', { bundle, archiveSha256, expectationsSha256 });
  mark('actual_custom_pg17_backup_and_quiescent_original_source_oracle', {
    archiveSha256,
    expectationsSha256,
    releaseCommit: oracle.releaseCommit,
    releaseTree: oracle.releaseTree,
    catalogSha256: oracle.catalogSha256,
    tables: 10,
    rowCounts: before.rowCounts,
  });
}
async function restore(fixture) {
  const input = read('inputs.json'),
    config = restoreEnv(fixture, input);
  const target = connect('restore', fixture);
  phase = 'premutation_refusals';
  for (const [name, patch, expectedPhase] of [
    ['production_mode', { CUPMEMO_DB_ENV: 'production' }, 'configuration'],
    [
      'wrong_confirmation',
      { CUPMEMO_RESTORE_CONFIRM_DATABASE: 'cupmemo_test_wrong' },
      'configuration',
    ],
    ['wrong_archive_hash', { CUPMEMO_RESTORE_EXPECTED_SHA256: '0'.repeat(64) }, 'inputs'],
  ]) {
    await refusal({ ...config, ...patch }, expectedPhase);
    await empty(target, 'restore');
    mark(name + '_refused_empty_target_preserved');
  }
  phase = 'real_restore';
  const receipt = await runRestore(config, {
    report: (value) => {
      phase = 'restore_' + value;
    },
  });
  assert.equal(receipt.status, 'structural_checks_passed');
  assert.equal(receipt.recoveryVerified, false);
  assert.equal(receipt.applicationChecks, 'unperformed');
  phase = 'exact_original_values';
  const restored = await snapshot(target);
  assert.deepEqual(restored, read('original-source.json'));
  mark('all_ten_tables_exact_original_source_values_and_sequence_match');
  mark('structural_checks', {
    tables: receipt.tablesCompared,
    relationships: receipt.relationshipsCompared,
    durationMs: receipt.durationMs,
    archiveSha256: receipt.archiveSha256,
  });
  phase = 'nonempty_refusal';
  await refusal(config, 'preflight');
  assert.deepEqual(await snapshot(target), restored);
  mark('nonempty_refused_all_values_catalog_and_sequence_preserved');
}
async function application(fixture, persistence) {
  const target = connect('restore', fixture),
    app = runtime(target, fixture);
  const users = read('users.json');
  phase = persistence ? 'persisted_auth_and_brew' : 'restored_auth_and_brew';
  // Existing source sessions are restored, as well as password/account data.
  for (const u of users) await session(app, u.cookie, u.email);
  if (persistence) {
    const saved = read('application-state.json');
    const r = await request(
      app,
      'GET',
      '/api/v1/brews/' + users[0].brew.id,
      undefined,
      saved.cookie,
    );
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().brew, saved.brew);
    await session(app, saved.cookie, users[0].email);
    mark('edited_brew_and_active_session_persist_after_one_db_container_restart');
  }
  const cookiesByOwner = [];
  for (const u of users) {
    const cookie = await signin(app, fixture, u.email);
    await session(app, cookie, u.email);
    cookiesByOwner.push(cookie);
  }
  mark('real_restored_better_auth_signin_and_session_two_owners');
  phase = 'owner_isolation';
  for (const [index, u] of users.entries()) {
    const own = await request(
      app,
      'GET',
      '/api/v1/brews/' + u.brew.id,
      undefined,
      cookiesByOwner[index],
    );
    assert.equal(own.statusCode, 200);
    if (!persistence) assert.deepEqual(own.json().brew, u.brew);
    const foreign = users[1 - index];
    for (const [method, payload] of [
      ['GET', undefined],
      ['PATCH', { notes: 'must not persist' }],
    ]) {
      const denied = await request(
        app,
        method,
        '/api/v1/brews/' + foreign.brew.id,
        payload,
        cookiesByOwner[index],
      );
      assert.equal(denied.statusCode, 404);
    }
    const coffee = await request(
      app,
      'GET',
      '/api/v1/coffees/' + foreign.coffee.id,
      undefined,
      cookiesByOwner[index],
    );
    assert.equal(coffee.statusCode, 404);
  }
  mark('two_owner_brew_read_update_and_coffee_idor_denied');
  if (!persistence) {
    phase = 'brew_edit';
    const r = await request(
      app,
      'PATCH',
      '/api/v1/brews/' + users[0].brew.id,
      {
        notes: 'Synthetic persisted edit',
        overallScore: 88.5,
      },
      cookiesByOwner[0],
    );
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().brew.notes, 'Synthetic persisted edit');
    assert.equal(r.json().brew.overallScore, 88.5);
    write('application-state.json', { cookie: cookiesByOwner[0], brew: r.json().brew });
    mark('authenticated_restored_brew_edit');
  }
  phase = 'signout';
  const cookie = cookiesByOwner[1];
  const out = await request(app, 'POST', '/api/v1/auth/sign-out', {}, cookie);
  assert.equal(out.statusCode, 200);
  const revoked = await request(app, 'GET', '/api/v1/auth/get-session', undefined, cookie);
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json(), null);
  const denied = await request(app, 'GET', '/api/v1/brews', undefined, cookie);
  assert.equal(denied.statusCode, 401);
  mark('real_signout_revokes_restored_account_session');
  // Verify source still matches its independent pre-dump snapshot (no target oracle).
  assert.deepEqual(await snapshot(connect('source', fixture)), read('original-source.json'));
  mark('original_source_unchanged');
}

if (!stages.includes(stage) || process.argv.length !== 3 || process.getuid() === 0) {
  process.stderr.write('recovery worker refused\n');
  process.exitCode = 1;
} else {
  process.umask(0o077);
  process.env.NODE_ENV = 'development';
  let status = 'failed';
  const started = Date.now();
  try {
    const fixture = read('fixture.json');
    if (stage === 'prepare') {
      fs.mkdirSync('/drill/state', { mode: 0o700 });
      await prepare(fixture);
    } else if (stage === 'restore') await restore(fixture);
    else await application(fixture, stage === 'persistence');
    status = 'passed';
  } catch (error) {
    // Never include an assertion/error value: it may contain private synthetic rows.
    const categories = {
      42501: 'query_denied',
      42883: 'undefined_function',
      42703: 'undefined_column',
      42601: 'query_syntax',
      '28P01': 'authentication',
      ECONNREFUSED: 'unavailable',
    };
    mark('failure_category', categories[error.code] ?? 'guard_or_assertion');
    process.exitCode = 1;
  } finally {
    for (const app of apps)
      await app.close().catch(() => {
        process.exitCode = 1;
      });
    for (const connection of connections)
      await connection.close().catch(() => {
        process.exitCode = 1;
      });
    if (process.exitCode) status = 'failed';
    write('result-' + stage + '.json', {
      status,
      stage,
      phase,
      checks,
      durationMs: Date.now() - started,
    });
  }
}
