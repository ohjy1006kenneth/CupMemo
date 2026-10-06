import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

export const portSchema = z.coerce.number().int().min(1).max(65_535).default(4101);

export function parseApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = portSchema.parse(env.CUPMEMO_API_PORT ?? '4101');
  const host = z
    .union([z.ipv4(), z.ipv6()])
    .default('127.0.0.1')
    .parse(env.CUPMEMO_API_HOST ?? '127.0.0.1');
  return { port, host };
}

export function createApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.set-cookie'],
        censor: '[REDACTED]',
      },
    },
  });

  const health = async () => ({ status: 'ok' as const });
  app.get('/health', health);
  app.get('/ready', health);
  app.get('/api/v1/health', health);

  return app;
}
