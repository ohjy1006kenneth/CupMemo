import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import process from 'node:process';
import { Pool } from 'pg';
import * as schema from './schema.js';

export { schema };
export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDatabase(databaseUrl: string | undefined): DatabaseConnection {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  pool.on('error', () => {
    process.stderr.write('PostgreSQL pool encountered an idle-client error.\n');
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
