import { createApp, parseApiConfig } from './app.js';
import { createDatabase, resolveDatabaseConfig } from '@cupmemo/database';

let connection: ReturnType<typeof createDatabase> | undefined;
const app = createApp({
  probe: async () => {
    if (!connection) throw new Error('Database is unavailable');
    await connection.pool.query('SELECT 1');
  },
  close: async () => {
    if (connection) await connection.close();
  },
});

try {
  const databaseConfig = resolveDatabaseConfig(process.env);
  connection = createDatabase(databaseConfig.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 900,
    query_timeout: 900,
    statement_timeout: 900,
    idleTimeoutMillis: 1000,
  });
  const { host, port } = parseApiConfig();
  await app.listen({ host, port });
} catch {
  process.stderr.write(
    'API startup failed. Check non-secret configuration and port availability.\n',
  );
  process.exitCode = 1;
  await app.close().catch(() => undefined);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => {
        process.exitCode = 1;
        process.exit(1);
      });
  });
}
