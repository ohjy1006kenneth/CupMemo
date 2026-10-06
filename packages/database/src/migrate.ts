import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './index.js';

const connection = createDatabase(process.env.DATABASE_URL);
try {
  await migrate(connection.db, { migrationsFolder: './drizzle' });
} catch {
  process.stderr.write(
    'Database migration failed. Check the database connection and migration files.\n',
  );
  process.exitCode = 1;
} finally {
  await connection.close();
}
