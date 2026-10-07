import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { URL } from 'node:url';
import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { createDatabase, resolveDatabaseConfig, schema } from '@cupmemo/database';
import { eq } from 'drizzle-orm';

let connection, app, authority, authConfig, config;
let phase = 'explicit isolated configuration',
  failureLocation = '';
const users = [],
  extraConnections = [],
  extraApps = [],
  sockets = new Set();
let tcp;
const captured = [],
  secrets = ['private-error-sentinel', 'parser-private-sentinel'];
const stdout = process.stdout.write,
  stderr = process.stderr.write;
const capture = function (chunk, encoding, callback) {
  captured.push(String(chunk));
  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
};
const suffix = randomUUID().replaceAll('-', '');
const triggerName = `coffee_failure_${suffix}`;
const functionName = `coffee_failure_${suffix}`;
let instrumented = false;
let functionCreated = false;
let domainWork = 0;
function trackedDatabase() {
  return new Proxy(connection.db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (['select', 'transaction', 'insert', 'update', 'delete'].includes(property)) {
        return (...args) => {
          domainWork++;
          return value.apply(target, args);
        };
      }
      return value;
    },
  });
}
const bounds = {
  max: 2,
  connectionTimeoutMillis: 900,
  query_timeout: 900,
  statement_timeout: 900,
  idleTimeoutMillis: 1000,
};
const base = '/api/v1/coffees';
let createApp, createAuth;
async function verifyDatabase() {
  const result = await connection.pool.query(
    "SELECT current_database() AS name, current_setting('server_version_num')::integer AS version",
  );
  assert.equal(result.rows[0].name, config.databaseName);
  assert.ok(result.rows[0].version >= 170000 && result.rows[0].version < 180000);
}
function authOptions() {
  return {
    origin: authConfig.origin,
    handler: authority.handler,
    getSession: authority.api.getSession,
  };
}
async function request(user, method, url = base, payload, extra = {}, target = app) {
  const response = await target.inject({
    method,
    url,
    headers: Object.fromEntries(
      Object.entries({
        origin: authConfig.origin,
        ...(user ? { cookie: user.cookie } : {}),
        ...extra,
      }).filter(([, value]) => value !== undefined),
    ),
    ...(payload === undefined ? {} : { payload }),
  });
  if (url.startsWith(base)) {
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.headers.vary?.toLowerCase().includes('cookie'));
    for (const secret of secrets) assert.ok(!response.body.includes(secret));
    for (const key of ['ownerId', 'userId', 'password', 'token', 'session'])
      assert.ok(!response.body.includes(`"${key}":`));
  }
  return response;
}
async function create(user, payload) {
  const response = await request(user, 'POST', base, payload);
  assert.equal(response.statusCode, 201);
  const coffee = response.json().coffee;
  assert.deepEqual(
    Object.keys(coffee).sort(),
    [
      'id',
      'name',
      'roaster',
      'country',
      'region',
      'farmStation',
      'producer',
      'variety',
      'process',
      'elevation',
      'roastDate',
      'tastingNotes',
      'createdAt',
      'updatedAt',
    ].sort(),
  );
  assert.match(coffee.id, /^[0-9a-f-]{36}$/);
  assert.equal(new Date(coffee.createdAt).toISOString(), coffee.createdAt);
  assert.equal(new Date(coffee.updatedAt).toISOString(), coffee.updatedAt);
  return coffee;
}
async function snapshot() {
  const result = {};
  for (const table of [
    'coffees',
    'coffee_tasting_notes',
    'brews',
    'brew_pours',
    'brew_tasting_tags',
  ]) {
    // Fixed harness-controlled identifiers, never request or credential interpolation.
    result[table] = (
      await connection.pool.query(`SELECT * FROM cupmemo.${table} ORDER BY 1,2`)
    ).rows;
  }
  return result;
}
async function denied(user, status = 401) {
  const before = await snapshot();
  const beforeWork = domainWork;
  for (const [method, url, payload] of [
    ['GET', base],
    ['POST', base, { name: 'denied', roaster: 'denied' }],
    ['GET', `${base}/${randomUUID()}`],
    ['PATCH', `${base}/${randomUUID()}`, { name: 'denied' }],
    ['DELETE', `${base}/${randomUUID()}`],
  ]) {
    const response = await request(user, method, url, payload);
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), {
      message: status === 401 ? 'Authentication required' : 'Authentication unavailable',
    });
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal(domainWork, beforeWork);
}
async function signIn(user) {
  const response = await request(null, 'POST', '/api/v1/auth/sign-in/email', {
    email: user.email,
    password: user.password,
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers['set-cookie'].map((value) => value.split(';', 1)[0]).join('; ');
  secrets.push(cookie, response.json().token);
  return { cookie, token: response.json().token };
}
async function removeInstrumentation() {
  if (!functionCreated) return;
  await verifyDatabase();
  if (instrumented) {
    const result = await connection.pool.query(
      'SELECT tgname FROM pg_trigger WHERE tgname=$1 AND tgrelid=$2::regclass',
      [triggerName, 'cupmemo.coffee_tasting_notes'],
    );
    assert.equal(result.rows.length, 1);
    await connection.pool.query(`DROP TRIGGER "${triggerName}" ON cupmemo.coffee_tasting_notes`);
  }
  await connection.pool.query(`DROP FUNCTION cupmemo."${functionName}"()`);
  instrumented = false;
  functionCreated = false;
}
try {
  config = resolveDatabaseConfig(process.env);
  assert.equal(config.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  process.env.NODE_ENV = 'development';
  ({ createAuth, resolveAuthConfig: authConfig } = await import('../dist/auth.js'));
  authConfig = authConfig(process.env);
  assert.equal(authConfig.production, false);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(authConfig.origin).hostname));
  ({ createApp } = await import('../dist/app.js'));
  connection = createDatabase(config.databaseUrl, bounds);
  await verifyDatabase();
  authority = createAuth(connection.db, authConfig);
  process.stdout.write = capture;
  process.stderr.write = capture;
  app = createApp({ db: trackedDatabase(), auth: authOptions() });
  phase = 'real users/cookies and empty private collections';
  for (const name of ['A', 'B']) {
    const user = {
      email: `coffee-${suffix}-${name.toLowerCase()}@example.test`,
      password: `coffee-${randomUUID()}-Strong!`,
    };
    users.push(user);
    secrets.push(user.password);
    const response = await request(null, 'POST', '/api/v1/auth/sign-up/email', {
      name,
      email: user.email,
      password: user.password,
    });
    assert.equal(response.statusCode, 200);
    user.id = response.json().user.id;
    user.cookie = response.headers['set-cookie'].map((value) => value.split(';', 1)[0]).join('; ');
    secrets.push(user.cookie, response.json().token, user.id);
    const empty = await request(user, 'GET');
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), {
      coffees: [],
      pagination: { limit: 50, offset: 0, hasMore: false },
    });
  }
  const [a, b] = users;
  phase = 'manual create projection persistence and null metadata';
  a.coffee = await create(a, { name: ' Lot ', roaster: ' Roaster ' });
  b.coffee = await create(b, {
    name: ' Lot ',
    roaster: ' Roaster ',
    country: ' Ethiopia ',
    region: ' Sidama ',
    farmStation: ' Hamasho ',
    producer: ' Producer ',
    variety: ' Heirloom ',
    process: ' Washed ',
    elevation: ' 1900–2200 m ',
    roastDate: '2024-02-29',
    tastingNotes: [' zesty ', 'Apple', 'apple'],
  });
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
    assert.equal(a.coffee[field], null);
  assert.deepEqual(a.coffee.tastingNotes, []);
  assert.equal(b.coffee.farmStation, 'Hamasho');
  assert.equal(b.coffee.elevation, '1900–2200 m');
  assert.equal(b.coffee.roastDate, '2024-02-29');
  assert.deepEqual(b.coffee.tastingNotes, ['Apple', 'apple', 'zesty']);
  const duplicate = await create(a, { name: 'Lot', roaster: 'Roaster', tastingNotes: ['B', 'a'] });
  const third = await create(a, { name: 'Third', roaster: 'Roaster', country: ' ' });
  await app.close();
  app = undefined;
  await connection.close();
  connection = createDatabase(config.databaseUrl, bounds);
  await verifyDatabase();
  authority = createAuth(connection.db, authConfig);
  app = createApp({ db: trackedDatabase(), auth: authOptions() });
  assert.deepEqual((await request(b, 'GET', `${base}/${b.coffee.id}`)).json(), {
    coffee: b.coffee,
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const http = await globalThis.fetch(`${address}${base}/${a.coffee.id}`, {
    headers: { cookie: a.cookie },
  });
  assert.equal(http.status, 200);
  assert.deepEqual(await http.json(), { coffee: a.coffee });
  phase = 'stable bounded paging and correctly associated notes';
  await connection.pool.query('UPDATE cupmemo.coffees SET created_at=$1 WHERE owner_id=$2', [
    '2025-01-01T00:00:00Z',
    a.id,
  ]);
  const ordered = [a.coffee.id, duplicate.id, third.id].sort().reverse();
  const list = (await request(a, 'GET')).json();
  assert.deepEqual(
    list.coffees.map((c) => c.id),
    ordered,
  );
  assert.deepEqual(list.coffees.find((c) => c.id === duplicate.id).tastingNotes, ['B', 'a']);
  for (let offset = 0; offset < 4; offset++) {
    const page = await request(a, 'GET', `${base}?limit=1&offset=${offset}`);
    assert.equal(page.statusCode, 200);
    assert.deepEqual(
      page.json().coffees.map((c) => c.id),
      ordered.slice(offset, offset + 1),
    );
    assert.equal(page.json().pagination.hasMore, offset < 2);
  }
  assert.equal(
    (await request(a, 'GET', `${base}?limit=100&offset=100000`)).json().coffees.length,
    0,
  );
  assert.deepEqual((await request(b, 'GET')).json().coffees, [b.coffee]);
  phase = 'reciprocal actual coffee IDOR denial';
  for (const user of users) {
    const other = users.find((u) => u !== user);
    const before = await snapshot();
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const payload =
        method === 'PATCH' ? { name: 'intrusion', tastingNotes: ['intrusion'] } : undefined;
      const foreign = await request(user, method, `${base}/${other.coffee.id}`, payload);
      const absent = await request(user, method, `${base}/${randomUUID()}`, payload);
      assert.equal(foreign.statusCode, 404);
      assert.equal(absent.statusCode, 404);
      assert.equal(foreign.body, absent.body);
      assert.deepEqual(foreign.json(), { message: 'Resource not found' });
      assert.deepEqual(await snapshot(), before);
    }
  }
  phase = 'patch omission null clearing descriptors and timestamps';
  const beforePatch = b.coffee;
  await delay(5);
  const patched = await request(b, 'PATCH', `${base}/${b.coffee.id}`, { name: ' New name ' });
  assert.equal(patched.statusCode, 200);
  b.coffee = patched.json().coffee;
  assert.deepEqual(
    { ...b.coffee, name: beforePatch.name, updatedAt: beforePatch.updatedAt },
    beforePatch,
  );
  assert.ok(b.coffee.updatedAt > beforePatch.updatedAt);
  assert.equal(b.coffee.name, 'New name');
  const clear = await request(b, 'PATCH', `${base}/${b.coffee.id}`, {
    country: null,
    roastDate: null,
    tastingNotes: [],
  });
  assert.equal(clear.statusCode, 200);
  assert.equal(clear.json().coffee.country, null);
  assert.equal(clear.json().coffee.roastDate, null);
  assert.deepEqual(clear.json().coffee.tastingNotes, []);
  assert.deepEqual(
    (
      await request(b, 'PATCH', `${base}/${b.coffee.id}`, { tastingNotes: [' Pear ', 'Honey'] })
    ).json().coffee.tastingNotes,
    ['Honey', 'Pear'],
  );
  phase = 'strict input rejects with unchanged persisted graph';
  const rejectedSnapshot = await snapshot();
  const invalidBodies = [
    null,
    [],
    {},
    'wrong',
    { name: null },
    { name: ' ' },
    { roaster: '' },
    { name: 'x'.repeat(201) },
    { country: 'x'.repeat(501) },
    { roastDate: '2025-02-29' },
    { roastDate: '2024-04-31' },
    { roastDate: '' },
    { tastingNotes: [' a', 'a '] },
    { tastingNotes: [' '] },
    { tastingNotes: ['x'.repeat(101)] },
    { tastingNotes: Array.from({ length: 33 }, (_, i) => String(i)) },
    { tastingNotes: 'no' },
  ];
  for (const field of [
    'ownerId',
    'userId',
    'id',
    'createdAt',
    'updatedAt',
    'brew',
    'sharing',
    'archive',
    'sensory',
    'source',
  ])
    invalidBodies.push({ [field]: 'forbidden' });
  for (const payload of invalidBodies) {
    for (const method of ['POST', 'PATCH']) {
      phase = `strict input case ${invalidBodies.indexOf(payload)} ${method}`;
      const body =
        method === 'POST' && payload && typeof payload === 'object' && !Array.isArray(payload)
          ? { name: 'Valid', roaster: 'Valid', ...payload }
          : payload;
      // Empty POST plus defaults is a valid create, so use the original empty body.
      const actual =
        method === 'POST' && payload && Object.keys(payload).length === 0 ? payload : body;
      const r = await request(
        a,
        method,
        method === 'POST' ? base : `${base}/${a.coffee.id}`,
        JSON.stringify(actual),
        { 'content-type': 'application/json' },
      );
      assert.equal(r.statusCode, 400);
      assert.deepEqual(r.json(), { message: 'Invalid coffee request' });
    }
  }
  for (const query of [
    'ownerId=x',
    'limit=0',
    'limit=101',
    'offset=100001',
    'offset=-1',
    'limit=1e1',
    'limit=1.0',
    'limit=+1',
    'limit=',
    'limit=1&limit=2',
    'offset=0&offset=1',
    'limit[]=1',
  ])
    assert.equal((await request(a, 'GET', `${base}?${query}`)).statusCode, 400);
  for (const method of ['GET', 'PATCH', 'DELETE'])
    assert.equal(
      (await request(a, method, `${base}/not-uuid`, method === 'PATCH' ? { name: 'x' } : undefined))
        .statusCode,
      400,
    );
  const malformed = await request(a, 'POST', base, '{"parser-private-sentinel":', {
    'content-type': 'application/json',
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json(), { message: 'Invalid coffee request' });
  assert.equal(
    (await request(a, 'POST', base, 'parser-private-sentinel', { 'content-type': 'text/plain' }))
      .statusCode,
    400,
  );
  assert.deepEqual(await snapshot(), rejectedSnapshot);
  phase = 'origin and real session denials before private mutation';
  await denied(null);
  await denied({ cookie: 'better-auth.session_token=tampered' });
  await denied({ cookie: a.cookie.replace(/.$/, 'x') });
  for (const extra of [
    { origin: undefined },
    { origin: 'null' },
    { origin: authConfig.origin + '/' },
    { origin: 'https://foreign.test' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const before = await snapshot();
    for (const method of ['POST', 'PATCH', 'DELETE'])
      assert.equal(
        (
          await request(
            a,
            method,
            method === 'POST' ? base : `${base}/${a.coffee.id}`,
            method === 'DELETE' ? undefined : { name: 'unsafe', roaster: 'unsafe' },
            extra,
          )
        ).statusCode,
        403,
      );
    assert.deepEqual(await snapshot(), before);
  }
  await connection.pool.query(
    "UPDATE public.session SET expires_at=now()+interval '5 days',updated_at=now()-interval '2 days' WHERE user_id=$1",
    [a.id],
  );
  const sessions = async (id) =>
    (await connection.pool.query('SELECT * FROM public.session WHERE user_id=$1 ORDER BY id', [id]))
      .rows;
  const aged = await sessions(a.id);
  assert.equal((await request(a, 'GET')).headers['set-cookie'], undefined);
  assert.deepEqual(await sessions(a.id), aged);
  await connection.pool.query(
    "UPDATE public.session SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [a.id],
  );
  await denied(a);
  assert.deepEqual(await sessions(a.id), []);
  a.cookie = (await signIn(a)).cookie;
  const revoked = await signIn(a);
  await connection.pool.query('DELETE FROM public.session WHERE user_id=$1 AND token=$2', [
    a.id,
    revoked.token,
  ]);
  await denied(revoked);
  phase = 'unused delete cascade and saved history protection';
  const unused = await create(a, { name: 'Unused', roaster: 'Roaster', tastingNotes: ['child'] });
  const bSnapshot = (await request(b, 'GET', `${base}/${b.coffee.id}`)).body;
  const deleted = await request(a, 'DELETE', `${base}/${unused.id}`);
  assert.equal(deleted.statusCode, 204);
  assert.equal(deleted.body, '');
  assert.equal(
    (
      await connection.db
        .select()
        .from(schema.coffeeTastingNotes)
        .where(eq(schema.coffeeTastingNotes.coffeeId, unused.id))
    ).length,
    0,
  );
  assert.equal((await request(b, 'GET', `${base}/${b.coffee.id}`)).body, bSnapshot);
  const brewValues = {
    ownerId: b.id,
    coffeeId: b.coffee.id,
    brewer: 'V60',
    grinder: 'Model',
    grindSetting: '22 clicks',
    doseGrams: '15',
    waterGrams: '250',
    waterTemperatureC: '93',
    totalBrewTimeSeconds: 180,
    overallScore: '87.25',
    brewedAt: new Date(),
  };
  const [brew] = await connection.db.insert(schema.brews).values(brewValues).returning();
  await connection.db
    .insert(schema.brewPours)
    .values({ brewId: brew.id, position: 0, waterGrams: '250', startTimeSeconds: 0 });
  await connection.db.insert(schema.brewTastingTags).values({ brewId: brew.id, tag: 'history' });
  const history = await snapshot();
  const conflict = await request(b, 'DELETE', `${base}/${b.coffee.id}`);
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual(conflict.json(), { message: 'Coffee has saved brews' });
  assert.equal((await request(a, 'DELETE', `${base}/${b.coffee.id}`)).statusCode, 404);
  assert.deepEqual(await snapshot(), history);
  phase = 'FK protection against concurrent brew creation and deletion';
  const race = await create(a, { name: 'Race', roaster: 'Roaster' });
  const client = await connection.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO cupmemo.brews(owner_id,coffee_id,brewer,grinder,grind_setting,dose_grams,water_grams,water_temperature_c,total_brew_time_seconds,overall_score,brewed_at) VALUES($1,$2,$3,$4,$5,15,250,93,180,87,now())',
      [a.id, race.id, 'V60', 'Model', '22'],
    );
    const deletion = request(a, 'DELETE', `${base}/${race.id}`);
    await delay(50);
    await client.query('COMMIT');
    assert.equal((await deletion).statusCode, 409);
    assert.equal((await request(a, 'GET', `${base}/${race.id}`)).statusCode, 200);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  phase = 'concurrent descriptor replacements serialize complete sets';
  const sets = [
    ['A1', 'A2'],
    ['B1', 'B2', 'B3'],
  ];
  const concurrent = await Promise.all(
    sets.map((tastingNotes) => request(a, 'PATCH', `${base}/${duplicate.id}`, { tastingNotes })),
  );
  concurrent.forEach((r, i) => {
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().coffee.tastingNotes, sets[i]);
  });
  assert.ok(
    sets.some(
      (set) => JSON.stringify(set) === JSON.stringify(concurrent[0].json().coffee.tastingNotes),
    ),
  );
  const final = (await request(a, 'GET', `${base}/${duplicate.id}`)).json().coffee.tastingNotes;
  assert.ok(sets.some((set) => JSON.stringify(set) === JSON.stringify(final)));
  phase = 'real post-parent transaction fault rolls back POST and PATCH';
  await verifyDatabase();
  // Unique identifier and exact owner/descriptor filter confines instrumentation.
  await connection.pool.query(
    `CREATE FUNCTION cupmemo."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.note = '${suffix}' AND EXISTS(SELECT 1 FROM cupmemo.coffees WHERE id=NEW.coffee_id AND owner_id='${a.id.replaceAll("'", "''")}') THEN RAISE EXCEPTION 'private-error-sentinel'; END IF; RETURN NEW; END $$`,
  );
  functionCreated = true;
  await connection.pool.query(
    `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON cupmemo.coffee_tasting_notes FOR EACH ROW EXECUTE FUNCTION cupmemo."${functionName}"()`,
  );
  instrumented = true;
  const atomic = await snapshot();
  assert.equal(
    (await request(a, 'POST', base, { name: 'Atomic', roaster: 'Roaster', tastingNotes: [suffix] }))
      .statusCode,
    503,
  );
  assert.deepEqual(await snapshot(), atomic);
  assert.equal(
    (
      await request(a, 'PATCH', `${base}/${duplicate.id}`, {
        name: 'Atomic',
        tastingNotes: [suffix],
      })
    ).statusCode,
    503,
  );
  assert.deepEqual(await snapshot(), atomic);
  await removeInstrumentation();
  assert.equal(
    (
      await request(a, 'PATCH', `${base}/${duplicate.id}`, {
        name: 'Restored',
        tastingNotes: [suffix],
      })
    ).statusCode,
    200,
  );
  phase = 'invalid persisted projection fails generic service error';
  await connection.pool.query('UPDATE cupmemo.coffees SET name=$1 WHERE id=$2 AND owner_id=$3', [
    'x'.repeat(201),
    duplicate.id,
    a.id,
  ]);
  const outputFailure = await request(a, 'GET', `${base}/${duplicate.id}`);
  assert.equal(outputFailure.statusCode, 503);
  assert.deepEqual(outputFailure.json(), { message: 'Coffee service unavailable' });
  await connection.pool.query('UPDATE cupmemo.coffees SET name=$1 WHERE id=$2 AND owner_id=$3', [
    'Restored',
    duplicate.id,
    a.id,
  ]);
  phase = 'real bounded domain lock failure and recovery';
  const blocker = await connection.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE cupmemo.coffees IN ACCESS EXCLUSIVE MODE');
    const start = Date.now();
    const r = await request(a, 'GET');
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.json(), { message: 'Coffee service unavailable' });
    assert.ok(Date.now() - start < 2500);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  assert.equal((await request(a, 'GET')).statusCode, 200);
  phase = 'refused and stalled real TCP dependencies bounded and drained';
  let forward = false;
  const accept = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (forward) {
      const upstream = net.connect({ host: config.hostname, port: config.port });
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    }
  };
  tcp = net.createServer(accept);
  await new Promise((resolve, reject) => {
    tcp.once('error', reject);
    tcp.listen(0, '127.0.0.1', resolve);
  });
  const port = tcp.address().port;
  const badUrl = new URL(config.databaseUrl);
  badUrl.port = String(port);
  for (const stalled of [true, false]) {
    if (!stalled) {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => tcp.close(resolve));
      tcp = undefined;
    }
    const bad = createDatabase(badUrl.toString(), bounds);
    extraConnections.push(bad);
    // Authority stays real and healthy to reach production coffee DB operations.
    const failedApp = createApp({ db: bad.db, auth: authOptions() });
    extraApps.push(failedApp);
    const start = Date.now();
    const rs = await Promise.all(
      Array.from({ length: 4 }, () => request(a, 'GET', base, undefined, {}, failedApp)),
    );
    for (const r of rs) {
      assert.equal(r.statusCode, 503);
      assert.deepEqual(r.json(), { message: 'Coffee service unavailable' });
    }
    assert.ok(Date.now() - start < 4500);
    const drainStart = Date.now();
    while ((bad.pool.waitingCount || bad.pool.totalCount) && Date.now() - drainStart < 2500)
      await delay(25);
    assert.equal(bad.pool.waitingCount, 0);
    assert.equal(bad.pool.totalCount, 0);
    // Restore the SAME failed dependency to the verified fixed fixture endpoint.
    forward = true;
    if (!stalled) {
      tcp = net.createServer(accept);
      await new Promise((resolve, reject) => {
        tcp.once('error', reject);
        tcp.listen(port, '127.0.0.1', resolve);
      });
    }
    const recovered = await request(a, 'GET', base, undefined, {}, failedApp);
    assert.equal(recovered.statusCode, 200);
    assert.equal(
      (await bad.pool.query('SELECT current_database() AS name')).rows[0].name,
      config.databaseName,
    );
    const drain = Date.now();
    await failedApp.close();
    await bad.close();
    assert.ok(Date.now() - drain < 2500);
    assert.equal(bad.pool.waitingCount, 0);
    assert.equal(bad.pool.totalCount, 0);
    extraApps.pop();
    extraConnections.pop();
    assert.equal((await request(a, 'GET')).statusCode, 200);
  }
  await verifyDatabase();
  phase = 'actual log positive control and private sentinel exclusion';
  assert.equal((await request(a, 'GET', `${base}/parser-private-sentinel`)).statusCode, 400);
  await app.close();
  app = undefined;
  await immediate();
  const output = captured.join('');
  assert.ok(output.includes('incoming request'));
  assert.ok(output.includes('request completed'));
  for (const secret of secrets) assert.ok(secret && !output.includes(secret));
  if (process.env.CUPMEMO_COFFEE_TEST_LOG)
    await writeFile(process.env.CUPMEMO_COFFEE_TEST_LOG, output, { mode: 0o600, flag: 'wx' });
} catch (error) {
  failureLocation =
    error instanceof Error
      ? (error.stack?.match(/coffee-integration\.mjs:\d+:\d+/)?.[0] ?? '')
      : '';
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {
    process.exitCode = 1;
  });
  for (const extra of extraApps)
    await extra.close().catch(() => {
      process.exitCode = 1;
    });
  for (const extra of extraConnections)
    await extra.close().catch(() => {
      process.exitCode = 1;
    });
  for (const socket of sockets) socket.destroy();
  if (tcp) await new Promise((resolve) => tcp.close(resolve));
  if (connection) {
    try {
      await removeInstrumentation();
      await verifyDatabase();
      for (const user of users) {
        await connection.pool.query(
          'DELETE FROM public."user" WHERE email=$1 AND ($2::text IS NULL OR id=$2)',
          [user.email, user.id ?? null],
        );
        assert.equal(
          (await connection.pool.query('SELECT id FROM public."user" WHERE email=$1', [user.email]))
            .rows.length,
          0,
        );
      }
    } catch {
      process.exitCode = 1;
      phase = 'precise fixture cleanup';
    }
    const start = Date.now();
    await connection.close().catch(() => {
      process.exitCode = 1;
    });
    if (
      Date.now() - start > 2500 ||
      connection.pool.waitingCount !== 0 ||
      connection.pool.totalCount !== 0
    ) {
      process.exitCode = 1;
      phase = 'bounded pool drain';
    }
  }
  process.stdout.write = stdout;
  process.stderr.write = stderr;
}
if (process.exitCode)
  process.stderr.write(
    `Coffee integration failed at ${phase} ${failureLocation}. No private diagnostics emitted.\n`,
  );
else
  process.stdout.write(
    'Coffee integration passed: real CRUD, two-user IDOR, history/FK, atomic rollback, concurrency, auth, TCP failures/recovery, projection/log exclusion and exact cleanup.\n',
  );
