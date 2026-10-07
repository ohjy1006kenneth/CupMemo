import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { schema, type Database } from '@cupmemo/database';
import {
  brewCreateSchema,
  brewPatchSchema,
  brewIdSchema,
  brewListQuerySchema,
  brewSchema,
  brewResponseSchema,
  brewListResponseSchema,
  type BrewCreate,
} from '@cupmemo/contracts';
import {
  ownerScope,
  ownedResourceScope,
  requireAuthenticatedUser,
  type SessionLookup,
} from './authorization.js';

const { brews, coffees, brewPours, brewTastingTags } = schema;
// No owner, auth, or hidden expanded sensory columns cross this boundary.
const fields = {
  id: brews.id,
  coffeeId: brews.coffeeId,
  brewer: brews.brewer,
  grinder: brews.grinder,
  grindSetting: brews.grindSetting,
  doseGrams: brews.doseGrams,
  waterGrams: brews.waterGrams,
  waterTemperatureC: brews.waterTemperatureC,
  totalBrewTimeSeconds: brews.totalBrewTimeSeconds,
  brewedAt: brews.brewedAt,
  overallScore: brews.overallScore,
  tastingMode: brews.tastingMode,
  acidity: brews.acidity,
  body: brews.body,
  aftertaste: brews.aftertaste,
  notes: brews.notes,
  createdAt: brews.createdAt,
  updatedAt: brews.updatedAt,
};
type Row = Pick<typeof brews.$inferSelect, keyof typeof fields>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Pour = { position: number; waterGrams: number; startTimeSeconds: number };
function project(row: Row, pours: Pour[], tastingTags: string[]) {
  return brewSchema.parse({
    ...row,
    doseGrams: Number(row.doseGrams),
    waterGrams: Number(row.waterGrams),
    waterTemperatureC: Number(row.waterTemperatureC),
    overallScore: Number(row.overallScore),
    acidity: row.acidity === null ? null : Number(row.acidity),
    body: row.body === null ? null : Number(row.body),
    aftertaste: row.aftertaste === null ? null : Number(row.aftertaste),
    brewedAt: row.brewedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    pours,
    tastingTags: tastingTags.sort(),
  });
}
async function children(tx: Transaction, scope: SQL) {
  const pours = await tx
    .select({
      brewId: brewPours.brewId,
      position: brewPours.position,
      waterGrams: brewPours.waterGrams,
      startTimeSeconds: brewPours.startTimeSeconds,
    })
    .from(brewPours)
    .innerJoin(brews, eq(brews.id, brewPours.brewId))
    .where(scope)
    .orderBy(asc(brewPours.position));
  const tags = await tx
    .select({ brewId: brewTastingTags.brewId, tag: brewTastingTags.tag })
    .from(brewTastingTags)
    .innerJoin(brews, eq(brews.id, brewTastingTags.brewId))
    .where(scope);
  const pourMap = new Map<string, Pour[]>();
  const tagMap = new Map<string, string[]>();
  for (const item of pours) {
    const values = pourMap.get(item.brewId) ?? [];
    values.push({
      position: item.position,
      waterGrams: Number(item.waterGrams),
      startTimeSeconds: item.startTimeSeconds,
    });
    pourMap.set(item.brewId, values);
  }
  for (const item of tags) {
    const values = tagMap.get(item.brewId) ?? [];
    values.push(item.tag);
    tagMap.set(item.brewId, values);
  }
  return { pourMap, tagMap };
}
function parentValues(input: Omit<BrewCreate, 'pours' | 'tastingTags' | 'coffeeId'>) {
  return {
    brewer: input.brewer,
    grinder: input.grinder,
    grindSetting: input.grindSetting,
    totalBrewTimeSeconds: input.totalBrewTimeSeconds,
    notes: input.notes,
    doseGrams: String(input.doseGrams),
    waterGrams: String(input.waterGrams),
    waterTemperatureC: String(input.waterTemperatureC),
    overallScore: String(input.overallScore),
    acidity: input.acidity === null ? null : String(input.acidity),
    body: input.body === null ? null : String(input.body),
    aftertaste: input.aftertaste === null ? null : String(input.aftertaste),
    brewedAt: new Date(input.brewedAt),
  };
}
async function insertPours(tx: Transaction, id: string, pours: BrewCreate['pours']) {
  await tx.insert(brewPours).values(
    pours.map((pour, position) => ({
      brewId: id,
      position,
      waterGrams: String(pour.waterGrams),
      startTimeSeconds: pour.startTimeSeconds,
    })),
  );
}
async function insertTags(tx: Transaction, id: string, tags: string[]) {
  if (tags.length)
    await tx.insert(brewTastingTags).values(tags.map((tag) => ({ brewId: id, tag })));
}
class InvalidMergedRecipe extends Error {}

export function registerBrewRoutes(
  app: FastifyInstance,
  options: {
    db?: Database;
    auth?: { origin: string; getSession?: SessionLookup };
  },
) {
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
      return reply
        .code(status)
        .send({ message: status === 503 ? 'Brew service unavailable' : 'Invalid brew request' });
    });
    const guard = requireAuthenticatedUser(options.auth);
    const invalid = (reply: Parameters<typeof guard>[1]) =>
      reply.code(400).send({ message: 'Invalid brew request' });
    const missing = (reply: Parameters<typeof guard>[1]) =>
      reply.code(404).send({ message: 'Resource not found' });
    const unavailable = (reply: Parameters<typeof guard>[1]) =>
      reply.code(503).send({ message: 'Brew service unavailable' });
    routes.post('/api/v1/brews', { preHandler: guard }, async (request, reply) => {
      const input = brewCreateSchema.safeParse(request.body);
      if (!input.success) return invalid(reply);
      if (!options.db || !request.authenticatedUser) return unavailable(reply);
      const user = request.authenticatedUser;
      try {
        const response = await options.db.transaction(async (tx) => {
          const { coffeeId, pours, tastingTags, ...values } = input.data;
          const [coffee] = await tx
            .select({ id: coffees.id })
            .from(coffees)
            .where(ownedResourceScope(coffees.id, coffees.ownerId, coffeeId, user))
            .for('update');
          if (!coffee) return null;
          const [row] = await tx
            .insert(brews)
            .values({
              ...parentValues(values),
              coffeeId: coffee.id,
              ownerId: user.id,
              tastingMode: 'quick',
            })
            .returning(fields);
          if (!row) throw new Error('Missing brew');
          await insertPours(tx, row.id, pours);
          await insertTags(tx, row.id, tastingTags);
          const stored = await children(
            tx,
            ownedResourceScope(brews.id, brews.ownerId, row.id, user),
          );
          return brewResponseSchema.parse({
            brew: project(row, stored.pourMap.get(row.id) ?? [], stored.tagMap.get(row.id) ?? []),
          });
        });
        if (response === null) return missing(reply);
        return reply.code(201).send(response);
      } catch {
        return unavailable(reply);
      }
    });
    routes.get('/api/v1/brews', { preHandler: guard }, async (request, reply) => {
      const input = brewListQuerySchema.safeParse(request.query);
      if (!input.success) return invalid(reply);
      if (!options.db || !request.authenticatedUser) return unavailable(reply);
      const user = request.authenticatedUser;
      try {
        return await options.db.transaction(async (tx) => {
          const { limit, offset, coffeeId } = input.data;
          const scope = and(
            ownerScope(brews.ownerId, user),
            coffeeId ? eq(brews.coffeeId, coffeeId) : undefined,
          )!;
          const rows = await tx
            .select(fields)
            .from(brews)
            .where(scope)
            .orderBy(desc(brews.brewedAt), desc(brews.id))
            .limit(limit + 1)
            .offset(offset)
            .for('share');
          const page = rows.slice(0, limit);
          const stored = page.length
            ? await children(
                tx,
                and(
                  ownerScope(brews.ownerId, user),
                  inArray(
                    brews.id,
                    page.map((row) => row.id),
                  ),
                )!,
              )
            : { pourMap: new Map<string, Pour[]>(), tagMap: new Map<string, string[]>() };
          return brewListResponseSchema.parse({
            brews: page.map((row) =>
              project(row, stored.pourMap.get(row.id) ?? [], stored.tagMap.get(row.id) ?? []),
            ),
            pagination: { limit, offset, hasMore: rows.length > limit },
          });
        });
      } catch {
        return unavailable(reply);
      }
    });
    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      routes.route<{ Params: { id: string } }>({
        method,
        url: '/api/v1/brews/:id',
        preHandler: guard,
        handler: async (request, reply) => {
          const id = brewIdSchema.safeParse(request.params.id);
          const patch = method === 'PATCH' ? brewPatchSchema.safeParse(request.body) : undefined;
          if (!id.success || (patch && !patch.success)) return invalid(reply);
          if (!options.db || !request.authenticatedUser) return unavailable(reply);
          const user = request.authenticatedUser;
          const scope = ownedResourceScope(brews.id, brews.ownerId, id.data, user);
          try {
            const response = await options.db.transaction(async (tx) => {
              const [parent] = await tx.select(fields).from(brews).where(scope).for('update');
              if (!parent) return null;
              if (method === 'DELETE') {
                await tx.delete(brews).where(scope);
                return undefined;
              }
              let stored = await children(tx, scope);
              const existing = project(
                parent,
                stored.pourMap.get(parent.id) ?? [],
                stored.tagMap.get(parent.id) ?? [],
              );
              let row = parent;
              if (patch?.success) {
                // Existing output is validated separately: corruption is 503, not caller error.
                const merged = brewCreateSchema.safeParse({
                  coffeeId: existing.coffeeId,
                  brewer: existing.brewer,
                  grinder: existing.grinder,
                  grindSetting: existing.grindSetting,
                  doseGrams: existing.doseGrams,
                  waterGrams: existing.waterGrams,
                  waterTemperatureC: existing.waterTemperatureC,
                  totalBrewTimeSeconds: existing.totalBrewTimeSeconds,
                  brewedAt: existing.brewedAt,
                  overallScore: existing.overallScore,
                  acidity: existing.acidity,
                  body: existing.body,
                  aftertaste: existing.aftertaste,
                  tastingTags: existing.tastingTags,
                  notes: existing.notes,
                  pours: existing.pours.map(({ waterGrams, startTimeSeconds }) => ({
                    waterGrams,
                    startTimeSeconds,
                  })),
                  ...patch.data,
                });
                if (!merged.success) throw new InvalidMergedRecipe();
                const { pours, tastingTags } = merged.data;
                const [updated] = await tx
                  .update(brews)
                  .set({ ...parentValues(merged.data), updatedAt: new Date() })
                  .where(scope)
                  .returning(fields);
                if (!updated) throw new Error('Missing brew');
                row = updated;
                // The same owner-filtered locked parent authorizes both replacements.
                if (patch.data.pours !== undefined) {
                  await tx.delete(brewPours).where(eq(brewPours.brewId, parent.id));
                  await insertPours(tx, parent.id, pours);
                }
                if (patch.data.tastingTags !== undefined) {
                  await tx.delete(brewTastingTags).where(eq(brewTastingTags.brewId, parent.id));
                  await insertTags(tx, parent.id, tastingTags);
                }
                stored = await children(tx, scope);
              }
              return brewResponseSchema.parse({
                brew: project(
                  row,
                  stored.pourMap.get(row.id) ?? [],
                  stored.tagMap.get(row.id) ?? [],
                ),
              });
            });
            if (response === null) return missing(reply);
            if (method === 'DELETE') return reply.code(204).send();
            return response;
          } catch (error) {
            if (error instanceof InvalidMergedRecipe) return invalid(reply);
            return unavailable(reply);
          }
        },
      });
    }
  });
}
