import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export type SessionLookup = (options: {
  headers: Headers;
  query: { disableRefresh: true; disableCookieCache: true };
  returnHeaders: true;
}) => Promise<{ response: unknown; headers: Headers }>;

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
  }
}

const meaningfulId = z
  .string()
  .min(1)
  .refine((value) => !/\s/.test(value));
const sessionSchema = z
  .object({
    user: z.object({ id: meaningfulId, name: z.string(), email: z.email() }),
    session: z.object({ id: meaningfulId, userId: meaningfulId, expiresAt: z.date() }),
  })
  .refine((value) => value.user.id === value.session.userId);

type IdentityColumn = AnyPgColumn<{ data: string }>;

export function ownerScope(ownerColumn: IdentityColumn, user: AuthenticatedUser): SQL {
  return eq(ownerColumn, meaningfulId.parse(user?.id));
}

export function ownedResourceScope(
  idColumn: IdentityColumn,
  ownerColumn: IdentityColumn,
  resourceId: string,
  user: AuthenticatedUser,
): SQL {
  return and(eq(idColumn, meaningfulId.parse(resourceId)), ownerScope(ownerColumn, user))!;
}

export function requireAuthenticatedUser(auth?: { origin: string; getSession?: SessionLookup }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const vary = String(reply.getHeader('vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!vary.some((value) => value === '*' || value.toLowerCase() === 'cookie'))
      vary.push('Cookie');
    reply.header('vary', vary.join(', '));
    request.authenticatedUser = null;
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      (!auth?.origin ||
        request.headers.origin !== auth.origin ||
        request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      return reply.code(403).send({ message: 'Request origin not allowed' });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!auth?.getSession) throw new Error('Session dependency is required');
      // The response deadline does not cancel the driver. The existing bounded
      // pool enforces independent connection/query limits and drains on close.
      const result = await Promise.race([
        auth.getSession({
          headers: fromNodeHeaders(request.headers),
          query: { disableRefresh: true, disableCookieCache: true },
          returnHeaders: true,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Session lookup deadline')), 1500);
        }),
      ]);
      if (!(result.headers instanceof Headers)) throw new Error('Invalid session headers');
      if (result.response === null) {
        const cookies = result.headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
        return reply.code(401).send({ message: 'Authentication required' });
      }
      const response = sessionSchema.parse(result.response);
      if (response.session.expiresAt.getTime() <= Date.now()) {
        return reply.code(401).send({ message: 'Authentication required' });
      }
      request.authenticatedUser = {
        id: response.user.id,
        name: response.user.name,
        email: response.user.email,
      };
      // With cache/refresh disabled these are library cleanup cookies, not a
      // replacement credential. Do not discard stale-cache clears on success.
      const cookies = result.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
    } catch {
      return reply.code(503).send({ message: 'Authentication unavailable' });
    } finally {
      clearTimeout(timer);
    }
  };
}
