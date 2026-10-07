import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import process from 'node:process';
import { resolveDatabaseConfig } from '../dist/config.js';
import { createDatabase } from '../dist/index.js';
import { inspectMigrationStatus } from '../dist/status.js';
import { readFile } from 'node:fs/promises';

let config;
try {
  config = resolveDatabaseConfig(process.env);
  if (config.environment !== 'test' || process.env.NODE_ENV === 'production') {
    throw new Error('Integration tests require test mode outside production NODE_ENV');
  }
} catch {
  process.stderr.write(
    'Database integration configuration refused; configure an isolated local test database.\n',
  );
  process.exit(1);
}

const connection = createDatabase(config.databaseUrl);
let phase = 'PostgreSQL identity';
try {
  const identity = await connection.db.execute(sql`select current_database(), version()`);
  assert.equal(identity.rows[0]?.current_database, config.databaseName);
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
  const journal = JSON.parse(
    await readFile(new globalThis.URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
  );
  assert.equal(history.rows[0]?.count, String(journal.entries.length));
  const migrationStatus = await inspectMigrationStatus((query) => connection.pool.query(query));
  assert.equal(migrationStatus.status, 'current');

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
  process.stderr.write(`Database integration assertion failed at: ${phase}.\n`);
  process.exitCode = 1;
} finally {
  await connection.close();
}

if (process.exitCode !== 1) {
  process.stdout.write(
    `Database integration checks passed (${config.environment} mode, PostgreSQL 17, ${config.databaseName}, migration, query, transaction, pool shutdown).\n`,
  );
}
