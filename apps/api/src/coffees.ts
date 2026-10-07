import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@cupmemo/database';
import {
  coffeeCreateSchema,
  coffeePatchSchema,
  coffeeIdSchema,
  coffeeListQuerySchema,
  coffeeResponseSchema,
  coffeeListResponseSchema,
} from '@cupmemo/contracts';
import {
  ownerScope,
  ownedResourceScope,
  requireAuthenticatedUser,
  type SessionLookup,
} from './authorization.js';

const { coffees, coffeeTastingNotes } = schema;
// Deliberately exclude ownership/internal columns at the SQL projection boundary.
const fields = {
  id: coffees.id,
  name: coffees.name,
  roaster: coffees.roaster,
  country: coffees.country,
  region: coffees.region,
  farmStation: coffees.farmStation,
  producer: coffees.producer,
  variety: coffees.variety,
  process: coffees.process,
  elevation: coffees.elevation,
  roastDate: coffees.roastDate,
  createdAt: coffees.createdAt,
  updatedAt: coffees.updatedAt,
};
type Row = Pick<typeof coffees.$inferSelect, keyof typeof fields>;
function project(row: Row, tastingNotes: string[]) {
  return {
    ...row,
    tastingNotes: tastingNotes.sort(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function historyConflict(error: unknown): boolean {
  // Drizzle wraps the driver error; inspect only the known PostgreSQL constraint.
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    if (
      'code' in error &&
      error.code === '23503' &&
      'constraint' in error &&
      error.constraint === 'brews_coffee_owner_fk'
    )
      return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}

export function registerCoffeeRoutes(
  app: FastifyInstance,
  options: {
    db?: Database;
    auth?: { origin: string; getSession?: SessionLookup };
  },
) {
  // Encapsulation keeps parser policy and sanitized errors off auth/health routes.
  void app.register(async (routes) => {
    routes.addHook('onRequest', async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      const vary = String(reply.getHeader('vary') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!vary.some((value) => value === '*' || value.toLowerCase() === 'cookie'))
        vary.push('Cookie');
      reply.header('vary', vary.join(', '));
    });
    routes.setErrorHandler((error, _request, reply) => {
      const code =
        error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      const status = typeof code === 'number' && [400, 413, 415].includes(code) ? code : 503;
      return reply.code(status).send({
        message: status === 503 ? 'Coffee service unavailable' : 'Invalid coffee request',
      });
    });
    const guard = requireAuthenticatedUser(options.auth);
    const invalid = (reply: Parameters<typeof guard>[1]) =>
      reply.code(400).send({ message: 'Invalid coffee request' });
    const missing = (reply: Parameters<typeof guard>[1]) =>
      reply.code(404).send({ message: 'Resource not found' });
    const unavailable = (reply: Parameters<typeof guard>[1]) =>
      reply.code(503).send({ message: 'Coffee service unavailable' });

    routes.post('/api/v1/coffees', { preHandler: guard }, async (request, reply) => {
      const input = coffeeCreateSchema.safeParse(request.body);
      if (!input.success) return invalid(reply);
      if (!options.db || !request.authenticatedUser) return unavailable(reply);
      const user = request.authenticatedUser;
      try {
        const response = await options.db.transaction(async (tx) => {
          const { tastingNotes, ...values } = input.data;
          const [row] = await tx
            .insert(coffees)
            .values({ ...values, ownerId: user.id })
            .returning(fields);
          if (!row) throw new Error('Missing coffee');
          // The newly inserted parent is owned and locked by this transaction.
          if (tastingNotes.length)
            await tx
              .insert(coffeeTastingNotes)
              .values(tastingNotes.map((note) => ({ coffeeId: row.id, note })));
          return coffeeResponseSchema.parse({ coffee: project(row, tastingNotes) });
        });
        return reply.code(201).send(response);
      } catch {
        return unavailable(reply);
      }
    });

    routes.get('/api/v1/coffees', { preHandler: guard }, async (request, reply) => {
      const input = coffeeListQuerySchema.safeParse(request.query);
      if (!input.success) return invalid(reply);
      if (!options.db || !request.authenticatedUser) return unavailable(reply);
      const user = request.authenticatedUser;
      try {
        const { limit, offset } = input.data;
        const rows = await options.db
          .select(fields)
          .from(coffees)
          .where(ownerScope(coffees.ownerId, user))
          .orderBy(desc(coffees.createdAt), desc(coffees.id))
          .limit(limit + 1)
          .offset(offset);
        const page = rows.slice(0, limit);
        const notes = page.length
          ? await options.db
              .select({ coffeeId: coffeeTastingNotes.coffeeId, note: coffeeTastingNotes.note })
              .from(coffeeTastingNotes)
              .innerJoin(coffees, eq(coffees.id, coffeeTastingNotes.coffeeId))
              .where(
                and(
                  ownerScope(coffees.ownerId, user),
                  inArray(
                    coffees.id,
                    page.map((row) => row.id),
                  ),
                ),
              )
          : [];
        const grouped = new Map<string, string[]>();
        for (const note of notes)
          grouped.set(note.coffeeId, [...(grouped.get(note.coffeeId) ?? []), note.note]);
        return coffeeListResponseSchema.parse({
          coffees: page.map((row) => project(row, grouped.get(row.id) ?? [])),
          pagination: { limit, offset, hasMore: rows.length > limit },
        });
      } catch {
        return unavailable(reply);
      }
    });

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      routes.route<{ Params: { id: string } }>({
        method,
        url: '/api/v1/coffees/:id',
        preHandler: guard,
        handler: async (request, reply) => {
          const id = coffeeIdSchema.safeParse(request.params.id);
          const patch = method === 'PATCH' ? coffeePatchSchema.safeParse(request.body) : undefined;
          if (!id.success || (patch && !patch.success)) return invalid(reply);
          if (!options.db || !request.authenticatedUser) return unavailable(reply);
          const user = request.authenticatedUser;
          const scope = ownedResourceScope(coffees.id, coffees.ownerId, id.data, user);
          try {
            const response = await options.db.transaction(async (tx) => {
              // Lock also GET to return a consistent parent/descriptor projection.
              const [parent] = await tx.select(fields).from(coffees).where(scope).for('update');
              if (!parent) return null;
              if (method === 'DELETE') {
                await tx.delete(coffees).where(scope);
                return undefined;
              }
              let row = parent;
              if (patch?.success) {
                const { tastingNotes, ...values } = patch.data;
                const [updated] = await tx
                  .update(coffees)
                  .set({ ...values, updatedAt: new Date() })
                  .where(scope)
                  .returning(fields);
                if (!updated) throw new Error('Missing coffee');
                row = updated;
                if (tastingNotes !== undefined) {
                  // Only the owner-scoped parent locked above authorizes children.
                  await tx
                    .delete(coffeeTastingNotes)
                    .where(eq(coffeeTastingNotes.coffeeId, parent.id));
                  if (tastingNotes.length)
                    await tx
                      .insert(coffeeTastingNotes)
                      .values(tastingNotes.map((note) => ({ coffeeId: parent.id, note })));
                }
              }
              const notes = await tx
                .select({ note: coffeeTastingNotes.note })
                .from(coffeeTastingNotes)
                .innerJoin(coffees, eq(coffees.id, coffeeTastingNotes.coffeeId))
                .where(scope);
              return coffeeResponseSchema.parse({
                coffee: project(
                  row,
                  notes.map((note) => note.note),
                ),
              });
            });
            if (response === null) return missing(reply);
            if (method === 'DELETE') return reply.code(204).send();
            return response;
          } catch (error) {
            if (method === 'DELETE' && historyConflict(error))
              return reply.code(409).send({ message: 'Coffee has saved brews' });
            return unavailable(reply);
          }
        },
      });
    }
  });
}
