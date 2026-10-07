import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createDatabase, resolveDatabaseConfig, schema } from '../dist/index.js';

let connection;
let client;
let phase = 'guarded configuration';
let assertions = 0;
const qualities = [
  'acidity',
  'body',
  'aftertaste',
  'fragranceAroma',
  'flavor',
  'balance',
  'sweetness',
  'overallImpression',
];
try {
  const config = resolveDatabaseConfig(process.env);
  assert.equal(config.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  connection = createDatabase(config.databaseUrl, {
    max: 1,
    connectionTimeoutMillis: 1500,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  client = await connection.pool.connect();
  phase = 'PostgreSQL identity';
  const identity = (await client.query('select current_database(), version()')).rows[0];
  assert.equal(identity.current_database, config.databaseName);
  assert.match(identity.version, /^PostgreSQL 17\./);
  phase = 'owner FK delete policy';
  const policy = (
    await client.query(
      "SELECT condeferrable, condeferred, confdeltype FROM pg_constraint WHERE conrelid = 'cupmemo.brews'::regclass AND conname = 'brews_coffee_owner_fk'",
    )
  ).rows[0];
  assert.deepEqual(policy, { condeferrable: false, condeferred: false, confdeltype: 'a' });
  await client.query('BEGIN');
  const db = drizzle(client, { schema });
  const { user, coffees, brews, brewPours, coffeeTastingNotes, brewTastingTags } = schema;
  // Optional deliberate mutation is transaction-local, always rolled back. It must
  // fail the ordinary cross-owner assertion, not a special mock assertion.
  if (process.argv.includes('--omit-owner-fk')) {
    await client.query('ALTER TABLE cupmemo.brews DROP CONSTRAINT brews_coffee_owner_fk');
  }
  async function rejects(label, action, codes) {
    phase = label;
    await client.query('SAVEPOINT expected_violation');
    let error;
    try {
      await action();
    } catch (caught) {
      error = caught;
    }
    await client.query('ROLLBACK TO SAVEPOINT expected_violation');
    await client.query('RELEASE SAVEPOINT expected_violation');
    assert.ok(error, 'database must reject invalid input');
    assert.ok(
      codes.includes(error.code ?? error.cause?.code),
      'expected PostgreSQL constraint violation',
    );
    assertions++;
  }
  phase = 'transaction-only fixture users';
  const a = `domain-a-${randomUUID()}`;
  const b = `domain-b-${randomUUID()}`;
  await db
    .insert(user)
    .values([a, b].map((id) => ({ id, name: 'Domain fixture', email: `${id}@example.test` })));
  const [coffeeA] = await db
    .insert(coffees)
    .values({ ownerId: a, name: 'Manual coffee', roaster: 'Manual roaster' })
    .returning();
  const [coffeeB] = await db
    .insert(coffees)
    .values({
      ownerId: b,
      name: 'Manual coffee',
      roaster: 'Manual roaster',
      elevation: '2,200–2,350 m',
      roastDate: '2026-09-28',
    })
    .returning();
  assert.match(coffeeA.id, /^[0-9a-f-]{36}$/);
  for (const field of [
    'country',
    'region',
    'farmStation',
    'producer',
    'variety',
    'process',
    'elevation',
    'roastDate',
  ])
    assert.equal(coffeeA[field], null);
  assert.equal(coffeeB.elevation, '2,200–2,350 m');
  assert.equal(coffeeB.roastDate, '2026-09-28');
  const recipe = {
    ownerId: a,
    coffeeId: coffeeA.id,
    brewer: 'V60',
    grinder: 'K-Ultra',
    grindSetting: '6.2',
    doseGrams: '15.00',
    waterGrams: '250.00',
    waterTemperatureC: '93.00',
    totalBrewTimeSeconds: 168,
    overallScore: '87.25',
    brewedAt: new Date('2026-09-28T12:00:00Z'),
  };
  const insertBrew = (patch = {}) =>
    db
      .insert(brews)
      .values({ ...recipe, ...patch })
      .returning();
  phase = 'minimal quick and full sensory round-trip';
  const [quick] = await insertBrew();
  assert.equal(quick.tastingMode, 'quick');
  assert.equal(quick.overallScore, '87.25');
  assert.equal(quick.grindSetting, '6.2');
  assert.equal(quick.brewedAt.toISOString(), recipe.brewedAt.toISOString());
  for (const field of qualities) assert.equal(quick[field], null);
  assert.equal(quick.notes, null);
  const detail = {
    acidity: '8.25',
    body: '8.00',
    aftertaste: '8.25',
    fragranceAroma: '8.50',
    flavor: '8.50',
    balance: '8.00',
    sweetness: '8.00',
    overallImpression: '7.75',
  };
  const [sensory] = await insertBrew({
    ...detail,
    tastingMode: 'sensory',
    grindSetting: '22 clicks',
    notes: 'Personal notes',
  });
  for (const field of qualities) assert.equal(sensory[field], detail[field]);
  assert.equal(sensory.grindSetting, '22 clicks');
  assert.equal(sensory.notes, 'Personal notes');
  await db.insert(brewPours).values(
    [
      { position: 2, waterGrams: '100.00', startTimeSeconds: 90 },
      { position: 0, waterGrams: '50.00', startTimeSeconds: 0 },
      { position: 1, waterGrams: '100.00', startTimeSeconds: 45 },
    ].map((pour) => ({ brewId: quick.id, ...pour })),
  );
  const pours = await db
    .select()
    .from(brewPours)
    .where(eq(brewPours.brewId, quick.id))
    .orderBy(asc(brewPours.position));
  assert.deepEqual(
    pours.map((p) => [p.position, p.waterGrams, p.startTimeSeconds]),
    [
      [0, '50.00', 0],
      [1, '100.00', 45],
      [2, '100.00', 90],
    ],
  );
  assert.equal(Number(quick.waterGrams) / Number(quick.doseGrams), 250 / 15);
  let cumulative = 0;
  assert.deepEqual(
    pours.map((p) => (cumulative += Number(p.waterGrams))),
    [50, 150, 250],
  );
  assert.equal(quick.totalBrewTimeSeconds, 168);
  await db.insert(coffeeTastingNotes).values({ coffeeId: coffeeA.id, note: 'Roaster descriptor' });
  await db.insert(brewTastingTags).values([
    { brewId: quick.id, tag: 'User chip' },
    { brewId: sensory.id, tag: 'Preserved chip' },
  ]);
  phase = 'same-ID edit, mode preservation and new-ID copy';
  const beforeCount = (await db.select().from(brews)).length;
  const [edited] = await db
    .update(brews)
    .set({
      tastingMode: 'quick',
      overallScore: '88.00',
      updatedAt: new Date(sensory.updatedAt.getTime() + 1000),
    })
    .where(eq(brews.id, sensory.id))
    .returning();
  assert.equal(edited.id, sensory.id);
  assert.equal((await db.select().from(brews)).length, beforeCount);
  assert.ok(edited.updatedAt > sensory.updatedAt);
  for (const field of qualities) assert.equal(edited[field], detail[field]);
  const [copy] = await insertBrew({ ...detail });
  assert.notEqual(copy.id, sensory.id);
  assert.equal((await db.select().from(brews)).length, beforeCount + 1);
  await rejects('cross-owner coffee association', () => insertBrew({ ownerId: b }), ['23503']);
  await rejects('missing coffee', () => insertBrew({ coffeeId: randomUUID() }), ['23503']);
  await rejects('missing brew owner', () => insertBrew({ ownerId: 'nonexistent-user' }), ['23503']);
  await rejects(
    'missing coffee owner',
    () =>
      db
        .insert(coffees)
        .values({ ownerId: 'nonexistent-user', name: 'Coffee', roaster: 'Roaster' }),
    ['23503'],
  );
  for (const field of ['name', 'roaster']) {
    for (const value of [null, '', '   ', '\t\n'])
      await rejects(
        `coffee ${field} invalid`,
        () =>
          db
            .insert(coffees)
            .values({ ownerId: a, name: 'Coffee', roaster: 'Roaster', [field]: value }),
        [value === null ? '23502' : '23514'],
      );
  }
  for (const field of ['brewer', 'grinder', 'grindSetting'])
    for (const value of ['   ', '\t\n'])
      await rejects(`blank ${field}`, () => insertBrew({ [field]: value }), ['23514']);
  for (const field of ['doseGrams', 'waterGrams'])
    for (const value of ['0', '-1', 'NaN', 'Infinity', '-Infinity'])
      await rejects(`invalid ${field} ${value}`, () => insertBrew({ [field]: value }), [
        '23514',
        '22003',
      ]);
  for (const value of ['-0.01', '100.01', 'NaN', 'Infinity', '-Infinity'])
    await rejects(`invalid temperature ${value}`, () => insertBrew({ waterTemperatureC: value }), [
      '23514',
      '22003',
    ]);
  await rejects('negative brew duration', () => insertBrew({ totalBrewTimeSeconds: -1 }), [
    '23514',
  ]);
  await rejects('invalid tasting mode', () => insertBrew({ tastingMode: 'cupping' }), ['23514']);
  for (const [field, max] of [['overallScore', 100], ...qualities.map((field) => [field, 10])]) {
    for (const value of ['-0.25', String(max + 0.25), '8.10', 'NaN', 'Infinity', '-Infinity'])
      await rejects(`invalid ${field} ${value}`, () => insertBrew({ [field]: value }), [
        '23514',
        '22003',
      ]);
    for (const value of ['0.00', `${max}.00`]) {
      phase = `${field} inclusive boundary`;
      const [row] = await insertBrew({ [field]: value });
      assert.equal(row[field], value);
      await db.delete(brews).where(eq(brews.id, row.id));
    }
  }
  for (const [table, valid, key] of [
    [brewPours, { brewId: quick.id, position: 0, waterGrams: '50', startTimeSeconds: 0 }, 'brewId'],
    [coffeeTastingNotes, { coffeeId: coffeeA.id, note: 'Roaster descriptor' }, 'coffeeId'],
    [brewTastingTags, { brewId: quick.id, tag: 'User chip' }, 'brewId'],
  ]) {
    await rejects('duplicate child key', () => db.insert(table).values(valid), ['23505']);
    await rejects(
      'missing child parent',
      () => db.insert(table).values({ ...valid, [key]: randomUUID() }),
      ['23503'],
    );
  }
  for (const [table, key, field] of [
    [coffeeTastingNotes, 'coffeeId', 'note'],
    [brewTastingTags, 'brewId', 'tag'],
  ])
    await rejects(
      'blank descriptor or tag',
      () =>
        db
          .insert(table)
          .values({ [key]: key === 'coffeeId' ? coffeeA.id : quick.id, [field]: '\t\n' }),
      ['23514'],
    );
  for (const patch of [
    { position: -1 },
    { startTimeSeconds: -1 },
    ...['0', '-1', 'NaN', 'Infinity', '-Infinity'].map((value) => ({ waterGrams: value })),
  ])
    await rejects(
      'invalid pour scalar',
      () =>
        db.insert(brewPours).values({
          brewId: quick.id,
          position: 3,
          waterGrams: '1',
          startTimeSeconds: 0,
          ...patch,
        }),
      ['23514', '22003'],
    );
  phase = 'documented cross-row API validation boundary';
  // This legal per-row insert deliberately violates contiguity, chronology,
  // total water and duration. Future #18 must reject it transactionally.
  await db
    .insert(brewPours)
    .values({ brewId: quick.id, position: 9, waterGrams: '1', startTimeSeconds: 999 });
  await db.delete(brewPours).where(eq(brewPours.position, 9));
  const [emptySchedule] = await insertBrew();
  assert.equal(
    (await db.select().from(brewPours).where(eq(brewPours.brewId, emptySchedule.id))).length,
    0,
  );
  await db.delete(brews).where(eq(brews.id, emptySchedule.id));
  await rejects(
    'coffee history deletion protected',
    () => db.delete(coffees).where(eq(coffees.id, coffeeA.id)),
    ['23503'],
  );
  phase = 'brew child cascade without foreign damage';
  await db.delete(brews).where(eq(brews.id, quick.id));
  assert.equal((await db.select().from(brewPours).where(eq(brewPours.brewId, quick.id))).length, 0);
  assert.equal(
    (await db.select().from(brewTastingTags).where(eq(brewTastingTags.brewId, quick.id))).length,
    0,
  );
  assert.equal(
    (await db.select().from(brewTastingTags).where(eq(brewTastingTags.brewId, sensory.id))).length,
    1,
  );
  const [brewB] = await insertBrew({ ownerId: b, coffeeId: coffeeB.id });
  await db
    .insert(brewPours)
    .values({ brewId: brewB.id, position: 0, waterGrams: '250', startTimeSeconds: 0 });
  await db.insert(brewTastingTags).values({ brewId: brewB.id, tag: 'B only' });
  await db.insert(coffeeTastingNotes).values({ coffeeId: coffeeB.id, note: 'B only' });
  phase = 'user graph cascade with non-deferrable NO ACTION';
  await db.delete(user).where(eq(user.id, a));
  assert.equal((await db.select().from(coffees).where(eq(coffees.ownerId, a))).length, 0);
  assert.equal((await db.select().from(brews).where(eq(brews.ownerId, a))).length, 0);
  assert.equal(
    (await db.select().from(coffeeTastingNotes).where(eq(coffeeTastingNotes.coffeeId, coffeeA.id)))
      .length,
    0,
  );
  assert.equal(
    (await db.select().from(brewTastingTags).where(eq(brewTastingTags.brewId, sensory.id))).length,
    0,
  );
  assert.equal((await db.select().from(user).where(eq(user.id, b))).length, 1);
  assert.deepEqual((await db.select().from(coffees).where(eq(coffees.id, coffeeB.id)))[0], coffeeB);
  assert.deepEqual((await db.select().from(brews).where(eq(brews.id, brewB.id)))[0], brewB);
  assert.equal((await db.select().from(brewPours).where(eq(brewPours.brewId, brewB.id))).length, 1);
  assert.equal(
    (await db.select().from(brewTastingTags).where(eq(brewTastingTags.brewId, brewB.id))).length,
    1,
  );
  assert.equal(
    (await db.select().from(coffeeTastingNotes).where(eq(coffeeTastingNotes.coffeeId, coffeeB.id)))
      .length,
    1,
  );
  await client.query('ROLLBACK');
  phase = 'rollback leaves no fixture rows';
  assert.equal(
    (
      await client.query('SELECT count(*)::int AS count FROM public."user" WHERE id = ANY($1)', [
        [a, b],
      ])
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int AS count FROM cupmemo.coffees WHERE owner_id = ANY($1)',
        [[a, b]],
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await client.query(
        'SELECT count(*)::int AS count FROM cupmemo.brews WHERE owner_id = ANY($1)',
        [[a, b]],
      )
    ).rows[0].count,
    0,
  );
  process.stdout.write(
    `Domain integration passed (${assertions} real constraint rejections; recipe, assessment, edit/copy, ownership, cascades, API boundary, rollback).\n`,
  );
} catch {
  process.stderr.write(`Domain integration failed at: ${phase}.\n`);
  process.exitCode = 1;
} finally {
  if (client) {
    await client.query('ROLLBACK').catch(() => {
      process.exitCode = 1;
    });
    client.release();
  }
  await connection?.close();
}
