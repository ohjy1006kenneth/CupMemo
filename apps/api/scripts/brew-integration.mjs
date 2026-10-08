import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { URL } from 'node:url';
import process from 'node:process';
import { setTimeout as delay, setImmediate as immediate } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { createDatabase, resolveDatabaseConfig } from '@cupmemo/database';

const base = '/api/v1/brews';
const qualityKeys = [
  'acidity',
  'body',
  'aftertaste',
  'fragranceAroma',
  'flavor',
  'balance',
  'sweetness',
  'overallImpression',
];
const publicKeys = [
  'id',
  'coffeeId',
  'brewer',
  'grinder',
  'grindSetting',
  'doseGrams',
  'waterGrams',
  'waterTemperatureC',
  'totalBrewTimeSeconds',
  'brewedAt',
  'overallScore',
  'tastingMode',
  ...qualityKeys,
  'tastingTags',
  'notes',
  'pours',
  'createdAt',
  'updatedAt',
].sort();
function assertBrew(brew) {
  assert.deepEqual(Object.keys(brew).sort(), publicKeys);
  privateLogIds.push(brew.id, brew.coffeeId);
  assert.ok(['quick', 'sensory'].includes(brew.tastingMode));
  for (const key of qualityKeys)
    assert.ok(
      brew[key] === null ||
        (typeof brew[key] === 'number' &&
          Number.isFinite(brew[key]) &&
          brew[key] >= 0 &&
          brew[key] <= 10 &&
          Number.isInteger(brew[key] * 4)),
    );
  assert.equal(typeof brew.overallScore, 'number');
}
const bounds = {
  max: 2,
  connectionTimeoutMillis: 900,
  query_timeout: 900,
  statement_timeout: 900,
  idleTimeoutMillis: 1000,
};
const suffix = randomUUID().replaceAll('-', '');
const users = [],
  connections = [],
  apps = [],
  sockets = new Set();
const captured = [],
  secrets = ['private-error-sentinel', 'parser-private-sentinel', 'SELECT private-sql-sentinel'];
const privateLogIds = [];
const timings = [];
const stdout = process.stdout.write,
  stderr = process.stderr.write;
const capture = function (chunk, encoding, callback) {
  captured.push(String(chunk));
  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
};
let connection, config, authConfig, authority, app, createApp, createAuth, tcp;
let phase = 'guarded isolated configuration',
  failureLocation = '',
  domainWork = 0;
const triggerName = `brew_failure_${suffix}`;
let functionCreated = false,
  instrumented = false;
let corruptQuality;
async function verifyDatabase(target = connection) {
  const { rows } = await target.pool.query(
    "SELECT current_database() AS name, current_setting('server_version_num')::integer AS version",
  );
  assert.equal(rows[0].name, config.databaseName);
  assert.ok(rows[0].version >= 170000 && rows[0].version < 180000);
}
function authOptions(instance = authority) {
  return {
    origin: authConfig.origin,
    handler: instance.handler,
    getSession: instance.api.getSession,
  };
}
function trackedDatabase() {
  return new Proxy(connection.db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (['select', 'transaction', 'insert', 'update', 'delete'].includes(property))
        return (...args) => {
          domainWork++;
          return value.apply(target, args);
        };
      return value;
    },
  });
}
async function request(user, method, url = base, payload, headers = {}, target = app) {
  const response = await target.inject({
    method,
    url,
    headers: Object.fromEntries(
      Object.entries({
        origin: authConfig.origin,
        ...(user ? { cookie: user.cookie } : {}),
        ...headers,
      }).filter(([, v]) => v !== undefined),
    ),
    ...(payload === undefined ? {} : { payload }),
  });
  if (url.startsWith(base)) {
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.headers.vary?.toLowerCase().includes('cookie'));
    for (const secret of secrets) assert.ok(!response.body.includes(secret));
    for (const key of ['ownerId', 'userId', 'password', 'token', 'session'])
      assert.ok(!response.body.includes(`"${key}":`));
    if ([200, 201].includes(response.statusCode)) {
      const body = response.json();
      if (body.brew) assertBrew(body.brew);
      if (body.brews) for (const brew of body.brews) assertBrew(brew);
    }
  }
  return response;
}
const recipe = (coffeeId, extra = {}) => ({
  coffeeId,
  brewer: ' V60 ',
  grinder: ' Hand ',
  grindSetting: ' 22 clicks ',
  doseGrams: 15,
  waterGrams: 0.3,
  waterTemperatureC: 93,
  totalBrewTimeSeconds: 120,
  brewedAt: '2024-02-29T12:30:00.12+02:00',
  overallScore: 0,
  pours: [
    { waterGrams: 0.1, startTimeSeconds: 10 },
    { waterGrams: 0.2, startTimeSeconds: 120 },
  ],
  ...extra,
});
async function create(user, payload = recipe(user.coffee.id)) {
  const r = await request(user, 'POST', base, payload);
  assert.equal(r.statusCode, 201);
  const brew = r.json().brew;
  assertBrew(brew);
  return brew;
}
async function snapshot() {
  const result = {};
  for (const table of [
    'coffees',
    'coffee_tasting_notes',
    'brews',
    'brew_pours',
    'brew_tasting_tags',
  ])
    result[table] = (
      await connection.pool.query(`SELECT * FROM cupmemo.${table} ORDER BY 1,2`)
    ).rows;
  return result;
}
async function patchPreserving(user, existing, changes) {
  const response = await request(user, 'PATCH', `${base}/${existing.id}`, changes);
  assert.equal(response.statusCode, 200);
  const brew = response.json().brew;
  assert.deepEqual({ ...brew, updatedAt: existing.updatedAt }, { ...existing, ...changes });
  assert.ok(Date.parse(brew.updatedAt) >= Date.parse(existing.updatedAt));
  assert.deepEqual((await request(user, 'GET', `${base}/${brew.id}`)).json().brew, brew);
  return brew;
}
async function signIn(user) {
  const r = await request(null, 'POST', '/api/v1/auth/sign-in/email', {
    email: user.email,
    password: user.password,
  });
  assert.equal(r.statusCode, 200);
  const cookie = r.headers['set-cookie'].map((v) => v.split(';', 1)[0]).join('; ');
  secrets.push(cookie, r.json().token);
  return { cookie, token: r.json().token };
}
async function denied(user, status = 401, target = app) {
  const before = await snapshot(),
    work = domainWork;
  for (const [method, url, payload] of [
    ['GET', base],
    ['POST', base, recipe(users[0].coffee.id)],
    ['GET', `${base}/${users[0].brew.id}`],
    ['PATCH', `${base}/${users[0].brew.id}`, { notes: 'denied' }],
    ['DELETE', `${base}/${users[0].brew.id}`],
  ]) {
    const start = Date.now();
    const r = await request(user, method, url, payload, {}, target);
    if (status === 503) {
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 2500);
      timings.push({ check: 'authority response', method, elapsedMs: elapsed });
    }
    assert.equal(r.statusCode, status);
    assert.deepEqual(r.json(), {
      message: status === 401 ? 'Authentication required' : 'Authentication unavailable',
    });
  }
  assert.equal(domainWork, work);
  assert.deepEqual(await snapshot(), before);
}
async function removeInstrumentation() {
  if (corruptQuality) {
    await verifyDatabase();
    await connection.pool.query('UPDATE cupmemo.brews SET flavor=$1 WHERE id=$2 AND owner_id=$3', [
      corruptQuality.flavor,
      corruptQuality.id,
      corruptQuality.ownerId,
    ]);
    await connection.pool.query(
      'ALTER TABLE cupmemo.brews VALIDATE CONSTRAINT brews_flavor_quarter',
    );
    corruptQuality = undefined;
  }
  if (!functionCreated) return;
  await verifyDatabase();
  if (instrumented) {
    assert.equal(
      (
        await connection.pool.query(
          'SELECT tgname FROM pg_trigger WHERE tgname=$1 AND tgrelid=$2::regclass',
          [triggerName, 'cupmemo.brew_pours'],
        )
      ).rows.length,
      1,
    );
    await connection.pool.query(`DROP TRIGGER "${triggerName}" ON cupmemo.brew_pours`);
  }
  await connection.pool.query(`DROP FUNCTION cupmemo."${triggerName}"()`);
  instrumented = false;
  functionCreated = false;
}
try {
  config = resolveDatabaseConfig(process.env);
  assert.equal(config.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  process.env.NODE_ENV = 'development';
  let resolveAuthConfig;
  ({ createAuth, resolveAuthConfig } = await import('../dist/auth.js'));
  authConfig = resolveAuthConfig(process.env);
  assert.equal(authConfig.production, false);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(authConfig.origin).hostname));
  ({ createApp } = await import('../dist/app.js'));
  connection = createDatabase(config.databaseUrl, bounds);
  await verifyDatabase();
  authority = createAuth(connection.db, authConfig);
  process.stdout.write = capture;
  process.stderr.write = capture;
  app = createApp({ db: trackedDatabase(), auth: authOptions() });
  phase = 'real A/B auth and quick/null/zero decimal roundtrips';
  for (const name of ['a', 'b']) {
    const user = {
      email: `brew-${suffix}-${name}@example.test`,
      password: `Brew-${randomUUID()}-Strong!`,
    };
    users.push(user);
    secrets.push(user.password);
    const r = await request(null, 'POST', '/api/v1/auth/sign-up/email', {
      name,
      email: user.email,
      password: user.password,
    });
    assert.equal(r.statusCode, 200);
    user.id = r.json().user.id;
    user.cookie = r.headers['set-cookie'].map((v) => v.split(';', 1)[0]).join('; ');
    secrets.push(user.cookie, r.json().token, user.id);
    assert.deepEqual((await request(user, 'GET')).json(), {
      brews: [],
      pagination: { limit: 50, offset: 0, hasMore: false },
    });
    const coffee = await request(user, 'POST', '/api/v1/coffees', {
      name: 'Lot',
      roaster: 'Roaster',
    });
    assert.equal(coffee.statusCode, 201);
    user.coffee = coffee.json().coffee;
    user.brew = await create(user);
    const brew = user.brew;
    assert.equal(brew.brewedAt, '2024-02-29T10:30:00.120Z');
    assert.equal(brew.brewer, 'V60');
    assert.equal(brew.grindSetting, '22 clicks');
    assert.equal(brew.overallScore, 0);
    assert.equal(brew.tastingMode, 'quick');
    for (const key of qualityKeys) assert.equal(brew[key], null);
    assert.deepEqual(
      [brew.acidity, brew.body, brew.aftertaste, brew.notes],
      [null, null, null, null],
    );
    assert.deepEqual(brew.tastingTags, []);
    assert.deepEqual(brew.pours, [
      { position: 0, waterGrams: 0.1, startTimeSeconds: 10 },
      { position: 1, waterGrams: 0.2, startTimeSeconds: 120 },
    ]);
    privateLogIds.push(brew.id, user.coffee.id);
  }
  const [a, b] = users;
  phase = 'optional quick/sensory none/partial/full shared quality validation';
  for (const tastingMode of ['quick', 'sensory']) {
    const none = await create(a, recipe(a.coffee.id, { tastingMode }));
    assert.equal(none.tastingMode, tastingMode);
    for (const key of qualityKeys) assert.equal(none[key], null);
    assert.equal((await request(a, 'DELETE', `${base}/${none.id}`)).statusCode, 204);
    const partial = await create(
      a,
      recipe(a.coffee.id, {
        tastingMode,
        acidity: 0,
        fragranceAroma: 8.25,
        overallImpression: 7.75,
        overallScore: 87.25,
      }),
    );
    assert.equal(partial.tastingMode, tastingMode);
    assert.equal(partial.overallScore, 87.25);
    for (const key of qualityKeys)
      assert.equal(
        partial[key],
        { acidity: 0, fragranceAroma: 8.25, overallImpression: 7.75 }[key] ?? null,
      );
    assert.equal((await request(a, 'DELETE', `${base}/${partial.id}`)).statusCode, 204);
    const all = Object.fromEntries(qualityKeys.map((key, i) => [key, i * 0.25]));
    const complete = await create(
      a,
      recipe(a.coffee.id, { ...all, tastingMode, overallScore: 87.25 }),
    );
    for (const key of qualityKeys) assert.equal(complete[key], all[key]);
    assert.equal(complete.tastingMode, tastingMode);
    assert.equal(complete.overallScore, 87.25);
    assert.equal((await request(a, 'DELETE', `${base}/${complete.id}`)).statusCode, 204);
  }
  for (const key of qualityKeys) {
    for (const value of [0, 0.25, 10, null]) {
      const created = await create(a, recipe(a.coffee.id, { [key]: value }));
      assert.equal(created[key], value);
      assert.equal(created.tastingMode, 'quick');
      const r = await request(a, 'PATCH', `${base}/${a.brew.id}`, { [key]: value });
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().brew[key], value);
      assert.equal((await request(a, 'DELETE', `${base}/${created.id}`)).statusCode, 204);
    }
  }
  const full = await create(
    a,
    recipe(a.coffee.id, {
      overallScore: 100,
      acidity: 0,
      body: 10,
      aftertaste: 8.25,
      tastingMode: 'sensory',
      fragranceAroma: 8.25,
      flavor: 7.5,
      balance: 0,
      sweetness: 10,
      overallImpression: 9,
      notes: ' Bright ',
      tastingTags: ['z', ' Apple ', 'apple'],
      waterTemperatureC: 0,
    }),
  );
  assert.deepEqual(full.tastingTags, ['Apple', 'apple', 'z']);
  assert.equal(full.notes, 'Bright');
  assert.equal(full.acidity, 0);
  for (const key of qualityKeys)
    assert.equal(
      full[key],
      {
        acidity: 0,
        body: 10,
        aftertaste: 8.25,
        fragranceAroma: 8.25,
        flavor: 7.5,
        balance: 0,
        sweetness: 10,
        overallImpression: 9,
      }[key],
    );
  phase =
    'detail added after quick, expanded-only/null/shared edits and non-destructive mode roundtrips';
  const countSensory = (await request(a, 'GET')).json().brews.length;
  let assessment = (await request(a, 'GET', `${base}/${a.brew.id}`)).json().brew;
  assessment = await patchPreserving(a, assessment, {
    fragranceAroma: 8.25,
    flavor: 0,
    balance: 7.5,
    sweetness: 10,
    overallImpression: 7.75,
    acidity: 0.25,
    body: 8,
    aftertaste: 9,
    overallScore: 87.25,
    tastingTags: ['Floral', 'Peach'],
    notes: 'sensory notes',
  });
  assert.equal(assessment.tastingMode, 'quick');
  for (const tastingMode of ['sensory', 'quick', 'sensory', 'quick', 'sensory'])
    assessment = await patchPreserving(a, assessment, { tastingMode });
  assessment = await patchPreserving(a, assessment, { flavor: 8.5 });
  assessment = await patchPreserving(a, assessment, { balance: null });
  assessment = await patchPreserving(a, assessment, { sweetness: 0 });
  assessment = await patchPreserving(a, assessment, { acidity: 10, body: null, aftertaste: 0 });
  assessment = await patchPreserving(a, assessment, { tastingMode: 'quick' });
  assessment = await patchPreserving(a, assessment, { body: 0.25 });
  assessment = await patchPreserving(a, assessment, { tastingMode: 'sensory' });
  for (const changes of [
    { grindSetting: '23 clicks' },
    { notes: 'edited notes' },
    { tastingTags: ['Citrus'] },
    { overallScore: 50.25 },
  ])
    assessment = await patchPreserving(a, assessment, changes);
  assert.equal(assessment.overallImpression, 7.75);
  assert.equal((await request(a, 'GET')).json().brews.length, countSensory);
  phase = 'reciprocal sensory PATCH SQL-owner negative-control assertion';
  const sensoryIdor = await snapshot();
  for (const [caller, victim] of [
    [a, b],
    [b, a],
  ]) {
    for (const id of [victim.brew.id, randomUUID()]) {
      const attack = await request(caller, 'PATCH', `${base}/${id}`, {
        tastingMode: 'sensory',
        fragranceAroma: 0,
        flavor: 10,
        overallImpression: 0.25,
      });
      assert.equal(attack.statusCode, 404, 'sensory PATCH must scope ownership in SQL');
      assert.deepEqual(attack.json(), { message: 'Resource not found' });
      assert.deepEqual(await snapshot(), sensoryIdor);
    }
  }
  const privateInput = `private-input-${suffix}`;
  privateLogIds.push(privateInput, `fault-${suffix}`);
  const privateTag = `private-tag-${suffix}`,
    privateSensory = `private-sensory-${suffix}`;
  privateLogIds.push(privateTag, privateSensory);
  assert.equal(
    (await request(a, 'PATCH', `${base}/${a.brew.id}`, { tastingTags: [privateTag] })).statusCode,
    200,
  );
  for (const payload of [{ flavor: privateSensory }, { [privateSensory]: privateSensory }])
    assert.equal((await request(a, 'PATCH', `${base}/${a.brew.id}`, payload)).statusCode, 400);
  assert.equal(
    (await request(a, 'PATCH', `${base}/${a.brew.id}`, { notes: privateInput })).json().brew.notes,
    privateInput,
  );
  assert.equal(
    (await request(a, 'PATCH', `${base}/${a.brew.id}`, { notes: null })).statusCode,
    200,
  );
  phase = 'actual loopback HTTP and durable app/pool recreation';
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const http = await globalThis.fetch(`http://127.0.0.1:${address.port}${base}/${full.id}`, {
    headers: { cookie: a.cookie },
  });
  assert.equal(http.status, 200);
  assert.equal(http.headers.get('cache-control'), 'no-store');
  assert.equal(http.headers.get('vary'), 'Cookie');
  assert.deepEqual((await http.json()).brew, full);
  const httpCreate = await globalThis.fetch(`http://127.0.0.1:${address.port}${base}`, {
    method: 'POST',
    headers: { cookie: a.cookie, origin: authConfig.origin, 'content-type': 'application/json' },
    body: JSON.stringify(
      recipe(a.coffee.id, {
        tastingMode: 'sensory',
        fragranceAroma: 8.25,
        flavor: 0,
        overallImpression: 7.75,
        overallScore: 87.25,
      }),
    ),
  });
  assert.equal(httpCreate.status, 201);
  let httpBrew = (await httpCreate.json()).brew;
  assertBrew(httpBrew);
  assert.equal(httpBrew.tastingMode, 'sensory');
  assert.equal(httpBrew.flavor, 0);
  assert.equal(httpBrew.overallImpression, 7.75);
  assert.equal(httpBrew.overallScore, 87.25);
  for (const tastingMode of ['quick', 'sensory']) {
    const r = await globalThis.fetch(`http://127.0.0.1:${address.port}${base}/${httpBrew.id}`, {
      method: 'PATCH',
      headers: { cookie: a.cookie, origin: authConfig.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ tastingMode }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('vary'), 'Cookie');
    const changed = (await r.json()).brew;
    assertBrew(changed);
    assert.deepEqual(changed, { ...httpBrew, tastingMode, updatedAt: changed.updatedAt });
    httpBrew = changed;
  }
  phase = 'unmatched and malformed brew privacy over injection and actual HTTP';
  const workBeforeUnmatched = domainWork;
  for (const [method, path, status] of [
    ['PUT', `${base}/${full.id}`, 404],
    ['PUT', base, 404],
    ['GET', `${base}/${full.id}/unknown`, 404],
    ['GET', `${base}/${full.id}%ZZ`, 400],
    ['GET', `${base}/${full.id}/unknown%ZZ`, 400],
    ['GET', `${base}/${full.id}/%E0%A4`, 400],
  ]) {
    const url = `${path}?private=parser-private-sentinel`;
    const expected = { message: status === 400 ? 'Invalid brew request' : 'Resource not found' };
    const injected = await request(a, method, url);
    assert.equal(injected.statusCode, status);
    assert.deepEqual(injected.json(), expected);
    const actual = await globalThis.fetch(`http://127.0.0.1:${address.port}${url}`, {
      method,
      headers: { cookie: a.cookie },
    });
    assert.equal(actual.status, status);
    assert.deepEqual(await actual.json(), expected);
    assert.equal(actual.headers.get('cache-control'), 'no-store');
    assert.equal(actual.headers.get('vary'), 'Cookie');
  }
  assert.equal(domainWork, workBeforeUnmatched);
  assert.deepEqual((await request(a, 'GET', `${base}/${full.id}`)).json().brew, full);
  await app.close();
  await connection.close();
  connection = createDatabase(config.databaseUrl, bounds);
  await verifyDatabase();
  authority = createAuth(connection.db, authConfig);
  app = createApp({ db: trackedDatabase(), auth: authOptions() });
  assert.deepEqual((await request(a, 'GET', `${base}/${full.id}`)).json().brew, full);
  assert.deepEqual((await request(a, 'GET', `${base}/${httpBrew.id}`)).json().brew, httpBrew);
  assert.equal((await request(a, 'DELETE', `${base}/${httpBrew.id}`)).statusCode, 204);
  phase = 'copy creates distinct ID, edit preserves identity/count/children';
  const copied = await create(a, recipe(a.coffee.id));
  assert.notEqual(copied.id, a.brew.id);
  const countBefore = (await request(a, 'GET')).json().brews.length;
  const edit = await request(a, 'PATCH', `${base}/${full.id}`, {
    notes: ' changed ',
    overallScore: 87.25,
  });
  assert.equal(edit.statusCode, 200);
  const edited = edit.json().brew;
  assert.equal(edited.id, full.id);
  assert.equal(edited.createdAt, full.createdAt);
  assert.equal(edited.coffeeId, full.coffeeId);
  assert.deepEqual(edited.pours, full.pours);
  assert.deepEqual(edited.tastingTags, full.tastingTags);
  assert.equal(edited.acidity, 0);
  assert.notEqual(edited.updatedAt, full.updatedAt);
  assert.equal((await request(a, 'GET')).json().brews.length, countBefore);
  const cleared = await request(a, 'PATCH', `${base}/${full.id}`, {
    acidity: null,
    body: null,
    aftertaste: null,
    notes: null,
    tastingTags: [],
  });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(cleared.json().brew.tastingTags, []);
  phase = 'reciprocal IDOR and immutable foreign/absent association';
  const idorBefore = await snapshot();
  for (const [caller, victim] of [
    [a, b],
    [b, a],
  ]) {
    for (const id of [victim.brew.id, randomUUID()]) {
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        const r = await request(
          caller,
          method,
          `${base}/${id}`,
          method === 'PATCH' ? { notes: 'attack' } : undefined,
        );
        assert.equal(r.statusCode, 404);
        assert.deepEqual(r.json(), { message: 'Resource not found' });
      }
    }
    for (const coffeeId of [victim.coffee.id, randomUUID()]) {
      const r = await request(caller, 'POST', base, recipe(coffeeId));
      assert.equal(r.statusCode, 404);
      assert.deepEqual(r.json(), { message: 'Resource not found' });
      assert.deepEqual((await request(caller, 'GET', `${base}?coffeeId=${coffeeId}`)).json(), {
        brews: [],
        pagination: { limit: 50, offset: 0, hasMore: false },
      });
    }
  }
  assert.deepEqual(await snapshot(), idorBefore);
  phase = 'tied-date stable bounded owner pagination/latest recipe';
  const all = (await request(a, 'GET')).json().brews;
  const sorted = [...all].sort(
    (x, y) => y.brewedAt.localeCompare(x.brewedAt) || y.id.localeCompare(x.id),
  );
  assert.deepEqual(all, sorted);
  for (let offset = 0; offset <= all.length; offset++) {
    const r = await request(a, 'GET', `${base}?limit=1&offset=${offset}&coffeeId=${a.coffee.id}`);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().brews, all.slice(offset, offset + 1));
    assert.equal(r.json().pagination.hasMore, offset + 1 < all.length);
  }
  phase = 'invalid input and merged recipe rejection preserve complete graph';
  const invalidBefore = await snapshot();
  for (const key of qualityKeys) {
    for (const value of [-0.25, 10.25, 0.1, '8', true, {}, []]) {
      for (const [method, url, payload] of [
        ['POST', base, recipe(a.coffee.id, { [key]: value })],
        ['PATCH', `${base}/${a.brew.id}`, { [key]: value }],
      ]) {
        const response = await request(a, method, url, payload);
        assert.equal(response.statusCode, 400);
        assert.deepEqual(response.json(), { message: 'Invalid brew request' });
        assert.deepEqual(await snapshot(), invalidBefore);
      }
    }
    const raw = JSON.stringify(recipe(a.coffee.id)).replace(/}$/, `,"${key}":1e309}`);
    assert.equal(
      (await request(a, 'POST', base, raw, { 'content-type': 'application/json' })).statusCode,
      400,
    );
    assert.deepEqual(await snapshot(), invalidBefore);
  }
  for (const extra of [
    ...[null, 'Quick', 'Sensory', 'detailed', '', 0, true].map((tastingMode) => ({ tastingMode })),
    { quickAcidity: 8 },
    { detailAcidity: 8 },
    { assessment: { flavor: 8 } },
    { cupChecks: [] },
    { uniformity: 10 },
    { cleanCup: 10 },
    { defects: 0 },
  ]) {
    for (const [method, url, payload] of [
      ['POST', base, recipe(a.coffee.id, extra)],
      ['PATCH', `${base}/${a.brew.id}`, extra],
    ]) {
      const response = await request(a, method, url, payload);
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { message: 'Invalid brew request' });
      assert.deepEqual(await snapshot(), invalidBefore);
    }
  }
  const invalidCreates = [
    { doseGrams: 0 },
    { waterGrams: 0.31 },
    { waterGrams: 0.301 },
    { doseGrams: 0.001 },
    { doseGrams: 100000 },
    { doseGrams: '15' },
    { waterTemperatureC: 100.01 },
    { waterTemperatureC: -1 },
    { waterTemperatureC: 93.001 },
    { totalBrewTimeSeconds: 86401 },
    { totalBrewTimeSeconds: 1.5 },
    { overallScore: 100.25 },
    { overallScore: -0.25 },
    { overallScore: 1.1 },
    { acidity: 10.25 },
    { body: -0.25 },
    { aftertaste: 0.1 },
    { brewer: ' ' },
    { grindSetting: 22 },
    { grinder: 'x'.repeat(201) },
    { ownerId: b.id },
    { tastingMode: null },
    { fragranceAroma: 10.25 },
    { notes: 'x'.repeat(5001) },
    { tastingTags: ['a', ' a '] },
    { tastingTags: [' '] },
    { tastingTags: Array.from({ length: 33 }, (_, i) => String(i)) },
    { pours: [] },
    { pours: Array.from({ length: 33 }, () => ({ waterGrams: 0.01, startTimeSeconds: 0 })) },
    { pours: [{ waterGrams: 0.3, startTimeSeconds: 121 }] },
    {
      pours: [
        { waterGrams: 0.2, startTimeSeconds: 20 },
        { waterGrams: 0.1, startTimeSeconds: 10 },
      ],
    },
    { pours: [{ waterGrams: 0.3, startTimeSeconds: 10, position: 0 }] },
    { pours: [{ waterGrams: 0, startTimeSeconds: 0 }] },
    ...[
      '2023-02-29T00:00:00Z',
      '2024-04-31T00:00:00Z',
      '2024-02-29T24:00:00Z',
      '2024-01-01T00:00:00',
      '2024-01-01T00:00:00.1234Z',
      '0000-01-01T00:00:00Z',
      '0001-01-01T00:00:00+01:00',
      '9999-12-31T23:59:59-01:00',
      '2024-01-01T00:00:00+24:00',
    ].map((brewedAt) => ({ brewedAt })),
  ];
  for (const extra of invalidCreates)
    assert.equal((await request(a, 'POST', base, recipe(a.coffee.id, extra))).statusCode, 400);
  for (const payload of [
    {},
    { coffeeId: a.coffee.id },
    { waterGrams: 0.4 },
    { totalBrewTimeSeconds: 119 },
    { pours: [] },
    { id: a.brew.id },
    { createdAt: full.createdAt },
    { tastingMode: 'detailed' },
    { flavor: 10.25 },
  ])
    assert.equal((await request(a, 'PATCH', `${base}/${a.brew.id}`, payload)).statusCode, 400);
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=1&limit=2',
    'limit=+1',
    'offset=100001',
    'limit=1.0',
    'limit=1e1',
    'coffeeId=x',
    'ownerId=x',
    'limit[]=1',
  ])
    assert.equal((await request(a, 'GET', `${base}?${query}`)).statusCode, 400);
  assert.equal((await request(a, 'GET', `${base}/parser-private-sentinel`)).statusCode, 400);
  for (const [payload, headers, status] of [
    ['{"parser-private-sentinel":', { 'content-type': 'application/json' }, 400],
    ['parser-private-sentinel', { 'content-type': 'application/x-private' }, 415],
    [JSON.stringify({ notes: 'x'.repeat(1048576) }), { 'content-type': 'application/json' }, 413],
  ])
    assert.equal((await request(a, 'POST', base, payload, headers)).statusCode, status);
  assert.deepEqual(await snapshot(), invalidBefore);
  phase = 'equal starts, boundary precision, existing stored sensory preservation';
  const boundary = await create(
    a,
    recipe(a.coffee.id, {
      doseGrams: 0.29,
      waterGrams: 0.29,
      waterTemperatureC: 100,
      overallScore: 0.25,
      pours: [
        { waterGrams: 0.1, startTimeSeconds: 120 },
        { waterGrams: 0.19, startTimeSeconds: 120 },
      ],
    }),
  );
  assert.equal(boundary.doseGrams, 0.29);
  await connection.pool.query(
    "UPDATE cupmemo.brews SET tasting_mode='sensory',fragrance_aroma=8.25,flavor=7.5,balance=0,sweetness=10,overall_impression=9 WHERE id=$1 AND owner_id=$2",
    [full.id, a.id],
  );
  const hidden = async () =>
    (
      await connection.pool.query(
        'SELECT tasting_mode,fragrance_aroma,flavor,balance,sweetness,overall_impression FROM cupmemo.brews WHERE id=$1 AND owner_id=$2',
        [full.id, a.id],
      )
    ).rows;
  const beforeHidden = await hidden();
  const sensory = await request(a, 'PATCH', `${base}/${full.id}`, {
    grindSetting: '23 clicks',
    acidity: 0,
  });
  assert.equal(sensory.statusCode, 200);
  assert.equal(sensory.json().brew.tastingMode, 'sensory');
  assert.deepEqual(await hidden(), beforeHidden);
  const expectedStored = {
    fragranceAroma: 8.25,
    flavor: 7.5,
    balance: 0,
    sweetness: 10,
    overallImpression: 9,
  };
  for (const [key, value] of Object.entries(expectedStored))
    assert.equal(sensory.json().brew[key], value);
  phase = 'concurrent full assessment states and disjoint recipe/sensory updates';
  const assessmentStates = ['quick', 'sensory'].map((tastingMode, i) => ({
    ...Object.fromEntries(qualityKeys.map((key, j) => [key, i === 0 ? j * 0.25 : 10 - j * 0.25])),
    tastingMode,
    overallScore: i === 0 ? 1.25 : 99.75,
    tastingTags: [i === 0 ? 'A' : 'B'],
    notes: i === 0 ? 'quick state' : 'sensory state',
  }));
  const assessmentResponses = await Promise.all(
    assessmentStates.map((state) => request(a, 'PATCH', `${base}/${copied.id}`, state)),
  );
  const assessmentKeys = [...qualityKeys, 'tastingMode', 'overallScore', 'tastingTags', 'notes'];
  const assessmentOnly = (brew) =>
    Object.fromEntries(assessmentKeys.map((key) => [key, brew[key]]));
  for (let i = 0; i < assessmentStates.length; i++) {
    assert.equal(assessmentResponses[i].statusCode, 200);
    assert.deepEqual(assessmentOnly(assessmentResponses[i].json().brew), assessmentStates[i]);
  }
  const savedAssessment = (await request(a, 'GET', `${base}/${copied.id}`)).json().brew;
  assert.ok(
    assessmentStates.some(
      (state) => JSON.stringify(state) === JSON.stringify(assessmentOnly(savedAssessment)),
    ),
  );
  const disjoint = await Promise.all([
    request(a, 'PATCH', `${base}/${copied.id}`, {
      fragranceAroma: 0,
      flavor: null,
      tastingMode: 'sensory',
    }),
    request(a, 'PATCH', `${base}/${copied.id}`, {
      grindSetting: '24 clicks',
      waterGrams: 0.4,
      pours: [{ waterGrams: 0.4, startTimeSeconds: 15 }],
    }),
  ]);
  for (const r of disjoint) assert.equal(r.statusCode, 200);
  const savedDisjoint = (await request(a, 'GET', `${base}/${copied.id}`)).json().brew;
  assert.deepEqual(savedDisjoint, {
    ...savedAssessment,
    fragranceAroma: 0,
    flavor: null,
    tastingMode: 'sensory',
    grindSetting: '24 clicks',
    waterGrams: 0.4,
    pours: [{ position: 0, waterGrams: 0.4, startTimeSeconds: 15 }],
    updatedAt: savedDisjoint.updatedAt,
  });
  phase = 'concurrent complete schedules/tags serialize without mixed children';
  const states = [
    {
      waterGrams: 30,
      pours: [
        { waterGrams: 10, startTimeSeconds: 0 },
        { waterGrams: 20, startTimeSeconds: 60 },
      ],
      tastingTags: ['A1', 'A2'],
    },
    {
      waterGrams: 45,
      pours: [
        { waterGrams: 15, startTimeSeconds: 10 },
        { waterGrams: 15, startTimeSeconds: 20 },
        { waterGrams: 15, startTimeSeconds: 30 },
      ],
      tastingTags: ['B1', 'B2', 'B3'],
    },
  ];
  const concurrent = await Promise.all(
    states.map((state) => request(a, 'PATCH', `${base}/${copied.id}`, state)),
  );
  for (let i = 0; i < states.length; i++) {
    assert.equal(concurrent[i].statusCode, 200);
    const brew = concurrent[i].json().brew;
    assert.equal(brew.waterGrams, states[i].waterGrams);
    assert.deepEqual(brew.tastingTags, states[i].tastingTags);
    assert.deepEqual(
      brew.pours,
      states[i].pours.map((p, position) => ({ ...p, position })),
    );
  }
  const final = (await request(a, 'GET', `${base}/${copied.id}`)).json().brew;
  assert.ok(
    states.some(
      (s) =>
        s.waterGrams === final.waterGrams &&
        JSON.stringify(s.tastingTags) === JSON.stringify(final.tastingTags) &&
        JSON.stringify(s.pours.map((p, position) => ({ ...p, position }))) ===
          JSON.stringify(final.pours),
    ),
  );
  phase = 'POST/PATCH child-write and output-validation failures roll back parent/children';
  await verifyDatabase();
  // Identifiers are generated hex; exact generated owner + distinctive recipe limit this task-only trigger.
  const quotedOwner = a.id.replaceAll("'", "''");
  await connection.pool.query(
    `CREATE FUNCTION cupmemo."${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM cupmemo.brews WHERE id=NEW.brew_id AND owner_id='${quotedOwner}' AND brewer='fault-${suffix}') THEN IF NEW.start_time_seconds=11 THEN RAISE EXCEPTION 'private-error-sentinel'; ELSE NEW.water_grams=NEW.water_grams+1; END IF; END IF; RETURN NEW; END $$`,
  );
  functionCreated = true;
  await connection.pool.query(
    `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON cupmemo.brew_pours FOR EACH ROW EXECUTE FUNCTION cupmemo."${triggerName}"()`,
  );
  instrumented = true;
  const atomic = await snapshot();
  for (const startTimeSeconds of [11, 12]) {
    const fault = {
      brewer: `fault-${suffix}`,
      waterGrams: 0.3,
      pours: [{ waterGrams: 0.3, startTimeSeconds }],
      tastingTags: ['rollback'],
      tastingMode: 'quick',
      fragranceAroma: 1.25,
      flavor: 0.25,
      balance: null,
      sweetness: 9.75,
      overallImpression: 0,
      overallScore: 30.25,
      notes: 'rollback sensory',
    };
    for (const [method, url, payload] of [
      ['POST', base, recipe(a.coffee.id, fault)],
      ['PATCH', `${base}/${copied.id}`, fault],
    ]) {
      const r = await request(a, method, url, payload);
      assert.equal(r.statusCode, 503);
      assert.deepEqual(r.json(), { message: 'Brew service unavailable' });
      assert.deepEqual(await snapshot(), atomic);
    }
  }
  await removeInstrumentation();
  assert.equal(
    (
      await request(a, 'PATCH', `${base}/${copied.id}`, {
        brewer: `fault-${suffix}`,
        tastingMode: 'quick',
        fragranceAroma: 1.25,
        flavor: 0.25,
        balance: null,
        sweetness: 9.75,
        overallImpression: 0,
        overallScore: 30.25,
        tastingTags: ['rollback'],
        notes: 'rollback sensory',
        waterGrams: 0.3,
        pours: [{ waterGrams: 0.3, startTimeSeconds: 11 }],
      })
    ).statusCode,
    200,
  );
  const retried = (await request(a, 'GET', `${base}/${copied.id}`)).json().brew;
  assert.equal(retried.fragranceAroma, 1.25);
  assert.equal(retried.flavor, 0.25);
  assert.equal(retried.overallImpression, 0);
  assert.equal(retried.overallScore, 30.25);
  assert.equal(retried.tastingMode, 'quick');
  assert.deepEqual(retried.tastingTags, ['rollback']);
  phase = 'persisted corrupt expanded quality rejects reads/edits with no commit';
  // Only on this verified disposable database: retain the exact check, mark it NOT VALID
  // around one generated owner's corrupt row, then restore the row and validate in finally.
  await verifyDatabase();
  const constraint = (
    await connection.pool.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='cupmemo.brews'::regclass AND conname='brews_flavor_quarter' AND convalidated",
    )
  ).rows;
  assert.equal(constraint.length, 1);
  corruptQuality = { id: copied.id, ownerId: a.id, flavor: retried.flavor };
  const client = await connection.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE cupmemo.brews DROP CONSTRAINT brews_flavor_quarter');
    const changed = await client.query(
      'UPDATE cupmemo.brews SET flavor=0.1 WHERE id=$1 AND owner_id=$2',
      [copied.id, a.id],
    );
    assert.equal(changed.rowCount, 1);
    await client.query(
      `ALTER TABLE cupmemo.brews ADD CONSTRAINT brews_flavor_quarter ${constraint[0].definition} NOT VALID`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const corruptExpanded = await snapshot();
  assert.equal(corruptExpanded.brews.find((row) => row.id === copied.id).flavor, '0.10');
  for (const [method, url, payload] of [
    ['GET', `${base}/${copied.id}`],
    ['GET', base],
    ['PATCH', `${base}/${copied.id}`, { flavor: 8.25, tastingMode: 'sensory', notes: 'repair' }],
  ]) {
    const response = await request(a, method, url, payload);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { message: 'Brew service unavailable' });
    assert.deepEqual(await snapshot(), corruptExpanded);
  }
  await removeInstrumentation();
  assert.deepEqual((await request(a, 'GET', `${base}/${copied.id}`)).json().brew, retried);
  phase = 'persisted invalid projection is 503 not caller validation or repair';
  await connection.pool.query(
    'UPDATE cupmemo.brew_pours SET position=3 WHERE brew_id=$1 AND position=0',
    [copied.id],
  );
  const corrupt = await snapshot();
  for (const method of ['GET', 'PATCH'])
    assert.equal(
      (
        await request(
          a,
          method,
          `${base}/${copied.id}`,
          method === 'PATCH' ? { notes: 'repair' } : undefined,
        )
      ).statusCode,
      503,
    );
  assert.deepEqual(await snapshot(), corrupt);
  await connection.pool.query(
    'UPDATE cupmemo.brew_pours SET position=0 WHERE brew_id=$1 AND position=3',
    [copied.id],
  );
  phase = 'real session/origin denials before tracked private domain work';
  await denied(null);
  await denied({ cookie: 'better-auth.session_token=tampered' });
  await denied({ cookie: a.cookie.replace(/.$/, 'x') });
  for (const headers of [
    { origin: undefined },
    { origin: 'null' },
    { origin: authConfig.origin + '/' },
    { origin: 'https://foreign.test' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const work = domainWork,
      before = await snapshot();
    for (const method of ['POST', 'PATCH', 'DELETE'])
      assert.equal(
        (
          await request(
            a,
            method,
            method === 'POST' ? base : `${base}/${a.brew.id}`,
            method === 'DELETE' ? undefined : recipe(a.coffee.id),
            headers,
          )
        ).statusCode,
        403,
      );
    assert.equal(domainWork, work);
    assert.deepEqual(await snapshot(), before);
  }
  const sessions = async (id) =>
    (await connection.pool.query('SELECT * FROM public.session WHERE user_id=$1 ORDER BY id', [id]))
      .rows;
  await connection.pool.query(
    "UPDATE public.session SET expires_at=now()+interval '5 days',updated_at=now()-interval '2 days' WHERE user_id=$1",
    [a.id],
  );
  const aged = await sessions(a.id),
    unrelated = await sessions(b.id);
  assert.equal((await request(a, 'GET')).headers['set-cookie'], undefined);
  assert.deepEqual(await sessions(a.id), aged);
  await connection.pool.query(
    "UPDATE public.session SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
    [a.id],
  );
  await denied(a);
  assert.deepEqual(await sessions(a.id), []);
  assert.deepEqual(await sessions(b.id), unrelated);
  a.cookie = (await signIn(a)).cookie;
  const revoked = await signIn(a);
  await connection.pool.query('DELETE FROM public.session WHERE user_id=$1 AND token=$2', [
    a.id,
    revoked.token,
  ]);
  await denied(revoked);
  phase = 'delete own children only and coffee-history semantics';
  const bBefore = (await request(b, 'GET')).body;
  const deleted = await request(a, 'DELETE', `${base}/${boundary.id}`);
  assert.equal(deleted.statusCode, 204);
  assert.equal(deleted.body, '');
  for (const table of ['brew_pours', 'brew_tasting_tags'])
    assert.equal(
      (
        await connection.pool.query(`SELECT * FROM cupmemo.${table} WHERE brew_id=$1`, [
          boundary.id,
        ])
      ).rows.length,
      0,
    );
  assert.equal((await request(a, 'GET', `/api/v1/coffees/${a.coffee.id}`)).statusCode, 200);
  assert.equal((await request(b, 'GET')).body, bBefore);
  assert.equal((await request(a, 'DELETE', `/api/v1/coffees/${a.coffee.id}`)).statusCode, 409);
  phase = 'concurrent coffee deletion and real brew association FK protect history';
  const raceCoffee = (
    await request(a, 'POST', '/api/v1/coffees', { name: 'Race', roaster: 'R' })
  ).json().coffee;
  const races = await Promise.all([
    request(a, 'POST', base, recipe(raceCoffee.id)),
    request(a, 'DELETE', `/api/v1/coffees/${raceCoffee.id}`),
  ]);
  assert.ok(
    (races[0].statusCode === 201 && races[1].statusCode === 409) ||
      (races[0].statusCode === 404 && races[1].statusCode === 204),
  );
  assert.equal(
    (
      await connection.pool.query(
        'SELECT b.id FROM cupmemo.brews b LEFT JOIN cupmemo.coffees c ON c.id=b.coffee_id AND c.owner_id=b.owner_id WHERE c.id IS NULL',
      )
    ).rows.length,
    0,
  );
  for (const brew of (await request(a, 'GET', `${base}?coffeeId=${a.coffee.id}`)).json().brews)
    assert.equal((await request(a, 'DELETE', `${base}/${brew.id}`)).statusCode, 204);
  assert.equal((await request(a, 'DELETE', `/api/v1/coffees/${a.coffee.id}`)).statusCode, 204);
  assert.equal((await request(b, 'GET')).body, bBefore);
  phase = 'real bounded domain lock failure and same-pool recovery';
  const blocker = await connection.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE cupmemo.brews IN ACCESS EXCLUSIVE MODE');
    const start = Date.now(),
      r = await request(b, 'GET');
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.json(), { message: 'Brew service unavailable' });
    assert.ok(Date.now() - start < 2500);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  assert.equal((await request(b, 'GET')).statusCode, 200);
  phase = 'real refused/stalled authority and domain TCP, queue/drain bounds and recovery';
  let forward = false;
  const accept = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (forward) {
      const upstream = net.connect({ host: config.hostname, port: config.port });
      sockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        socket.destroy();
      });
      socket.on('close', () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
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
    forward = false;
    for (const socket of sockets) socket.destroy();
    if (!stalled) {
      await new Promise((resolve) => tcp.close(resolve));
      tcp = undefined;
    }
    const bad = createDatabase(badUrl.toString(), bounds);
    connections.push(bad);
    const failed = createApp({ db: bad.db, auth: authOptions() });
    apps.push(failed);
    const failedAuthority = createApp({
      db: trackedDatabase(),
      auth: authOptions(createAuth(bad.db, authConfig)),
    });
    apps.push(failedAuthority);
    const authorityStart = Date.now();
    await denied(b, 503, failedAuthority);
    assert.ok(Date.now() - authorityStart < 8500);
    const queueStart = Date.now();
    const rs = await Promise.all(
      Array.from({ length: 4 }, () => request(b, 'GET', base, undefined, {}, failed)),
    );
    for (const r of rs) {
      assert.equal(r.statusCode, 503);
      assert.deepEqual(r.json(), { message: 'Brew service unavailable' });
    }
    const queueElapsed = Date.now() - queueStart;
    assert.ok(queueElapsed < 4500);
    timings.push({
      check: stalled ? 'stalled 4-request domain queue' : 'refused 4-request domain queue',
      elapsedMs: queueElapsed,
    });
    const drainStart = Date.now();
    while ((bad.pool.waitingCount || bad.pool.totalCount) && Date.now() - drainStart < 2500)
      await delay(25);
    assert.equal(bad.pool.waitingCount, 0);
    assert.equal(bad.pool.totalCount, 0);
    forward = true;
    timings.push({ check: 'idle client and queue drain', elapsedMs: Date.now() - drainStart });
    if (!stalled) {
      tcp = net.createServer(accept);
      await new Promise((resolve, reject) => {
        tcp.once('error', reject);
        tcp.listen(port, '127.0.0.1', resolve);
      });
    }
    assert.equal((await request(b, 'GET', base, undefined, {}, failed)).statusCode, 200);
    assert.equal((await request(b, 'GET', base, undefined, {}, failedAuthority)).statusCode, 200);
    await verifyDatabase(bad);
    const closeStart = Date.now();
    await failedAuthority.close();
    await failed.close();
    await bad.close();
    assert.ok(Date.now() - closeStart < 2500);
    timings.push({ check: 'restored pool shutdown', elapsedMs: Date.now() - closeStart });
    assert.equal(bad.pool.waitingCount, 0);
    assert.equal(bad.pool.totalCount, 0);
    apps.splice(-2);
    connections.pop();
  }
  phase = 'positive request logs and private sentinel exclusions';
  await request(b, 'GET', `${base}/${b.brew.id}?private=parser-private-sentinel`);
  await app.close();
  app = undefined;
  await immediate();
  const output = captured.join('');
  assert.ok(output.includes('incoming request'));
  assert.ok(output.includes('request completed'));
  assert.ok(output.includes('/api/v1/brews/[redacted]'));
  for (const secret of [...secrets, ...privateLogIds])
    assert.ok(secret && !output.includes(secret));
  if (process.env.CUPMEMO_BREW_TEST_LOG)
    await writeFile(process.env.CUPMEMO_BREW_TEST_LOG, output, { mode: 0o600, flag: 'wx' });
} catch (error) {
  failureLocation =
    error instanceof Error ? (error.stack?.match(/brew-integration\.mjs:\d+:\d+/)?.[0] ?? '') : '';
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {
    process.exitCode = 1;
  });
  for (const extra of apps)
    await extra.close().catch(() => {
      process.exitCode = 1;
    });
  for (const extra of connections)
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
    if (Date.now() - start > 2500 || connection.pool.waitingCount || connection.pool.totalCount) {
      process.exitCode = 1;
      phase = 'bounded pool drain';
    }
  }
  process.stdout.write = stdout;
  process.stderr.write = stderr;
}
if (process.exitCode)
  process.stderr.write(
    `Brew integration failed at ${phase} ${failureLocation}. No private diagnostics emitted.\n`,
  );
else
  process.stdout.write(
    'Brew integration passed: real CRUD, A/B sensory IDOR, all8 optional quality/mode validation and non-destructive roundtrips, independent scores, decimal/calendar/merged validation, copy/edit, persistence/HTTP, stored sensory, concurrent full assessment/disjoint recipe/children/FK, POST/PATCH sensory child and persisted expanded/projection rollback, auth, refused/stalled TCP recovery, privacy and precise cleanup.\n' +
      JSON.stringify({ timings }) +
      '\n',
  );
