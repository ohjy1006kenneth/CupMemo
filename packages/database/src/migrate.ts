import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolveDatabaseConfig } from './config.js';
import { createDatabase } from './index.js';

let connection: ReturnType<typeof createDatabase> | undefined;
try {
  const config = resolveDatabaseConfig(process.env);
  connection = createDatabase(config.databaseUrl);
  await migrate(connection.db, { migrationsFolder: './drizzle' });
  process.stdout.write(`Database migrations completed for ${config.environment} mode.\n`);
} catch {
  process.stderr.write(
    'Database configuration or migration failed. Check non-secret configuration and database availability.\n',
  );
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
}
