import { createApp, parseApiConfig } from './app.js';

const app = createApp();

try {
  const { host, port } = parseApiConfig();
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ err: error }, 'API startup failed');
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
