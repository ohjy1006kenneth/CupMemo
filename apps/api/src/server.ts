import { createAuth, resolveAuthConfig } from './auth.js';
import { createApp, parseApiConfig } from './app.js';
import { createDatabase, resolveDatabaseConfig } from '@cupmemo/database';

let connection: ReturnType<typeof createDatabase> | undefined;
let app: ReturnType<typeof createApp> | undefined;

try {
  // Fail closed on all explicit configuration before creating pools or listening.
  const databaseConfig = resolveDatabaseConfig(process.env);
  const authConfig = resolveAuthConfig(process.env);
  const apiConfig = parseApiConfig();
  connection = createDatabase(databaseConfig.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 900,
    query_timeout: 900,
    statement_timeout: 900,
    idleTimeoutMillis: 1000,
  });
  const auth = createAuth(connection.db, authConfig);
  app = createApp({
    auth: { origin: authConfig.origin, handler: auth.handler, getSession: auth.api.getSession },
    probe: async () => {
      if (!connection) throw new Error('Database is unavailable');
      await connection.pool.query('SELECT 1');
    },
    close: async () => {
      if (connection) await connection.close();
    },
  });
  await app.listen(apiConfig);
} catch {
  process.stderr.write(
    'API startup failed. Check non-secret configuration and port availability.\n',
  );
  process.exitCode = 1;
  if (app) await app.close().catch(() => undefined);
  else if (connection) await connection.close().catch(() => undefined);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (!app) return;
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => {
        process.exitCode = 1;
        process.exit(1);
      });
  });
}
