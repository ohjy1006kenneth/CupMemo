import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDatabaseConfig } from './config.js';
import { createDatabase } from './index.js';

const migrationsDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));

type Journal = { entries: Array<{ when: number; tag: string }> };

export async function inspectMigrationStatus(
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>,
  directory = migrationsDirectory,
): Promise<{ status: 'current' | 'pending' | 'mismatch'; applied: number; total: number }> {
  const journal = JSON.parse(
    await readFile(path.join(directory, 'meta/_journal.json'), 'utf8'),
  ) as Journal;
  const files = await readdir(directory);
  const sqlFiles = files.filter((file) => file.endsWith('.sql'));
  const migrations = await Promise.all(
    journal.entries.map(async (entry) => {
      const name = `${entry.tag}.sql`;
      if (!sqlFiles.includes(name)) throw new Error('Migration journal is inconsistent');
      const sql = await readFile(path.join(directory, name), 'utf8');
      return { hash: createHash('sha256').update(sql).digest('hex'), createdAt: entry.when };
    }),
  );
  if (sqlFiles.length !== migrations.length) throw new Error('Migration files are inconsistent');

  const schema = await query("SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name");
  if (!schema.rows[0]?.table_name)
    return { status: 'pending', applied: 0, total: migrations.length };
  const history = await query(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  const applied = history.rows;
  const matches = applied.every((row, index) => {
    const migration = migrations[index];
    return (
      migration && row.hash === migration.hash && Number(row.created_at) === migration.createdAt
    );
  });
  if (!matches || applied.length > migrations.length) {
    return { status: 'mismatch', applied: applied.length, total: migrations.length };
  }
  return {
    status: applied.length === migrations.length ? 'current' : 'pending',
    applied: applied.length,
    total: migrations.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const config = resolveDatabaseConfig(process.env);
    connection = createDatabase(config.databaseUrl, {
      max: 1,
      connectionTimeoutMillis: 1500,
      query_timeout: 1500,
      statement_timeout: 1500,
    });
    const result = await inspectMigrationStatus((sql) => connection!.pool.query(sql));
    process.stdout.write(
      `Migration status: ${result.status} (${result.applied}/${result.total} applied).\n`,
    );
    if (result.status !== 'current') process.exitCode = 1;
  } catch {
    process.stderr.write(
      'Database status failed. Check non-secret configuration and database availability.\n',
    );
    process.exitCode = 1;
  } finally {
    if (connection) await connection.close();
  }
}
