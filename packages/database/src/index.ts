import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import process from 'node:process';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.js';

export { resolveDatabaseConfig } from './config.js';
export type { DatabaseConfig, DatabaseEnvironment, DatabaseEnvironmentMap } from './config.js';

export { schema };
export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDatabase(
  databaseUrl: string | undefined,
  options: Omit<PoolConfig, 'connectionString'> = {},
): DatabaseConnection {
  if (!databaseUrl) {
    throw new Error('A PostgreSQL connection URL is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('Connection URL must be a valid PostgreSQL connection URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error('Connection URL must be a valid PostgreSQL connection URL');
  }

  const pool = new Pool({ connectionString: databaseUrl, ...options });
  pool.on('error', () => {
    process.stderr.write('PostgreSQL pool encountered an idle-client error.\n');
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
