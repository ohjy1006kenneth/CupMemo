import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import process from 'node:process';
import { URL } from 'node:url';
import { createDatabase } from '../dist/index.js';

const databaseUrl = process.env.DATABASE_URL;
const expectedDatabase = process.env.CUPMEMO_TEST_DATABASE;
if (!databaseUrl || !expectedDatabase || !/^cupmemo_test_[a-z0-9_]+$/.test(expectedDatabase)) {
  throw new Error(
    'Set DATABASE_URL and CUPMEMO_TEST_DATABASE to the isolated cupmemo_test_<task> database.',
  );
}

const parsed = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) ||
  parsed.pathname.slice(1) !== expectedDatabase
) {
  throw new Error('Integration tests require the named isolated local test database.');
}

assert.throws(() => createDatabase(undefined), /DATABASE_URL is required/);
assert.throws(() => createDatabase('not-a-url'), /valid PostgreSQL connection URL/);
assert.throws(() => createDatabase('mysql://localhost/example'), /valid PostgreSQL connection URL/);

const connection = createDatabase(databaseUrl);
let phase = 'PostgreSQL identity';
let failed = false;
try {
  const identity = await connection.db.execute(sql`select current_database(), version()`);
  assert.equal(identity.rows[0]?.current_database, expectedDatabase);
  assert.match(identity.rows[0]?.version ?? '', /^PostgreSQL 17\./);

  phase = 'cupmemo namespace';
  const namespace = await connection.db.execute(
    sql`select schema_name from information_schema.schemata where schema_name = 'cupmemo'`,
  );
  assert.equal(namespace.rows.length, 1);

  phase = 'migration journal';
  const history = await connection.db.execute(
    sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
  );
  assert.equal(history.rows[0]?.count, '1');

  phase = 'transaction query round-trip';
  const transactionResult = await connection.db.transaction(async (tx) => {
    await tx.execute(
      sql`create temporary table cupmemo_integration_probe (value text) on commit drop`,
    );
    await tx.execute(sql`insert into cupmemo_integration_probe values ('round-trip')`);
    return tx.execute(sql`select value from cupmemo_integration_probe`);
  });
  assert.equal(transactionResult.rows[0]?.value, 'round-trip');
} catch {
  failed = true;
  process.stderr.write(`Database integration assertion failed at: ${phase}.\n`);
} finally {
  await connection.close();
}

const unavailable = createDatabase(
  'postgresql://cupmemo:integration-secret@127.0.0.1:55439/cupmemo_test_unavailable',
);
try {
  await unavailable.db.execute(sql`select 1`);
  failed = true;
  process.stderr.write('Unavailable PostgreSQL connection unexpectedly succeeded.\n');
} catch (error) {
  if (!failed) assert.doesNotMatch(String(error), /integration-secret/);
} finally {
  await unavailable.close();
}

if (!failed) {
  process.stdout.write(
    'Database integration checks passed (isolated PostgreSQL 17, migration, query, transaction, refusal paths, pool shutdown).\n',
  );
}
process.exitCode = failed ? 1 : 0;
