import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { requireAuthenticatedUser, type SessionLookup } from './authorization.js';
import type { Database } from '@cupmemo/database';
import { registerCoffeeRoutes } from './coffees.js';
import { registerBrewRoutes } from './brews.js';

export const portSchema = z.coerce.number().int().min(1).max(65_535).default(4101);

function privateNamespace(url: string) {
  const path = url.split('?')[0];
  for (const namespace of ['coffees', 'brews'] as const) {
    const root = `/api/v1/${namespace}`;
    if (path === root || path.startsWith(`${root}/`)) return namespace;
  }
  return undefined;
}

function varyCookie(value: unknown) {
  const tokens = String(value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.some((token) => token === '*' || token.toLowerCase() === 'cookie'))
    tokens.push('Cookie');
  return tokens.join(', ');
}

function privateNotFound(reply: FastifyReply) {
  return reply
    .header('cache-control', 'no-store')
    .header('vary', varyCookie(reply.getHeader('vary')))
    .code(404)
    .send({ message: 'Resource not found' });
}

export function parseApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = portSchema.parse(env.CUPMEMO_API_PORT ?? '4101');
  const host = z
    .union([z.ipv4(), z.ipv6()])
    .default('127.0.0.1')
    .parse(env.CUPMEMO_API_HOST ?? '127.0.0.1');
  return { port, host };
}

export function createApp(
  options: {
    db?: Database;
    probe?: () => Promise<unknown>;
    close?: () => Promise<unknown>;
    auth?: {
      origin: string;
      handler: (request: Request) => Promise<Response>;
      getSession?: SessionLookup;
    };
  } = {},
): FastifyInstance {
  const app = Fastify({
    routerOptions: {
      // Router decoding errors precede Fastify hooks and route error handlers.
      onBadUrl: (path, request, response) => {
        const namespace = privateNamespace(request.url ?? '');
        const body = JSON.stringify(
          namespace
            ? {
                message:
                  namespace === 'coffees' ? 'Invalid coffee request' : 'Invalid brew request',
              }
            : {
                error: 'Bad Request',
                code: 'FST_ERR_BAD_URL',
                message: `'${path}' is not a valid url component`,
                statusCode: 400,
              },
        );
        response.writeHead(400, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(namespace
            ? { 'Cache-Control': 'no-store', Vary: varyCookie(response.getHeader('vary')) }
            : {}),
        });
        response.end(body);
      },
    },
    logger: {
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url.startsWith('/api/v1/auth')
            ? '/api/v1/auth/[redacted]'
            : request.url.startsWith('/api/v1/coffees')
              ? '/api/v1/coffees/[redacted]'
              : request.url.startsWith('/api/v1/brews')
                ? '/api/v1/brews/[redacted]'
                : request.url.split('?')[0],
          remoteAddress: request.ip,
        }),
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.set-cookie',
          'res.headers.set-cookie',
        ],
        censor: '[REDACTED]',
      },
    },
  });
  // Early generic404 avoids parsing unmatched private bodies. The supported
  // not-found handler also covers the internal404 router's decoding branch,
  // which bypasses lifecycle hooks for unsupported malformed method targets.
  app.addHook('onRequest', async (request, reply) => {
    if (request.is404 && privateNamespace(request.url)) return privateNotFound(reply);
  });
  app.setNotFoundHandler((request, reply) => {
    if (privateNamespace(request.raw.url ?? '')) return privateNotFound(reply);
    // Preserve Fastify's default public404 envelope and structured info event.
    const message = `Route ${request.raw.method}:${request.raw.url} not found`;
    request.log.info(message);
    return reply.code(404).send({ message, error: 'Not Found', statusCode: 404 });
  });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  const health = async () => ({ status: 'ok' as const });
  const readiness = async (_request: unknown, reply: { code: (status: number) => unknown }) => {
    try {
      if (!options.probe) throw new Error('Readiness probe is not configured');
      await options.probe();
      return { status: 'ok' as const };
    } catch {
      reply.code(503);
      return { status: 'unavailable' as const };
    }
  };
  app.get('/health', health);
  app.get('/ready', readiness);
  app.get('/api/v1/health', health);
  app.decorateRequest('authenticatedUser', null);
  registerCoffeeRoutes(app, options);
  registerBrewRoutes(app, options);
  app.get(
    '/api/v1/me',
    { preHandler: requireAuthenticatedUser(options.auth) },
    async (request) => ({
      user: request.authenticatedUser,
    }),
  );
  if (options.auth) {
    const auth = options.auth;
    const handleAuth = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const path = request.url;
        if (!path.startsWith('/') || path.startsWith('//')) {
          return reply.code(400).send({ message: 'Invalid authentication request' });
        }
        const headers = fromNodeHeaders(request.headers);
        headers.delete('host');
        headers.delete('content-length');
        headers.delete('connection');
        let body: BodyInit | undefined;
        if (request.body !== undefined && request.body !== null) {
          if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
            body = Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : request.body;
          } else {
            body = JSON.stringify(request.body);
          }
        }
        const fetchRequest = new Request(`${auth.origin}${path}`, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
        });
        const response = await auth.handler(fetchRequest);
        reply.code(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'set-cookie' && key.toLowerCase() !== 'content-length') {
            reply.header(key, value);
          }
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
        return reply.send(Buffer.from(await response.arrayBuffer()));
      } catch {
        return reply.code(500).send({ message: 'Authentication request failed' });
      }
    };
    app.route({ method: ['GET', 'POST'], url: '/api/v1/auth', handler: handleAuth });
    app.route({ method: ['GET', 'POST'], url: '/api/v1/auth/*', handler: handleAuth });
  }
  if (options.close) {
    app.addHook('onClose', async () => {
      await options.close?.();
    });
  }

  return app;
}
