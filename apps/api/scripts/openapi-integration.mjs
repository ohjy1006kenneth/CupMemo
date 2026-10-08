import assert from 'node:assert/strict';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDatabase, resolveDatabaseConfig } from '@cupmemo/database';
import { createAuth, resolveAuthConfig } from '../dist/auth.js';
import { createApp } from '../dist/app.js';
import { artifact, checkArtifact, createSchemaValidator } from './openapi.ts';

let connection;
let app;
let phase = 'configuration';
const emails = [];
const evidence = [];
try {
  const config = resolveDatabaseConfig(process.env);
  assert.equal(config.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  process.env.NODE_ENV = 'development';
  const authConfig = resolveAuthConfig(process.env);
  await checkArtifact();
  const document = JSON.parse(await readFile(artifact, 'utf8'));
  connection = createDatabase(config.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 1500,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  const identity = await connection.pool.query(
    "SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version",
  );
  assert.equal(identity.rows[0].database, config.databaseName);
  assert.match(identity.rows[0].version, /^17\./);
  const auth = createAuth(connection.db, authConfig);
  app = createApp({
    db: connection.db,
    auth: { origin: authConfig.origin, handler: auth.handler, getSession: auth.api.getSession },
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const validators = new Map();
  async function request(method, path, expected, body, cookie, origin = authConfig.origin) {
    const pathname = path.split('?')[0];
    const documented = pathname.replace(/\/[0-9a-f-]{36}$/, '/{id}');
    phase = `${method} ${documented} ${expected}`;
    const response = await globalThis.fetch(base + path, {
      method,
      headers: {
        ...(origin === null ? {} : { origin }),
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, phase);
    const operation = document.paths[documented][method.toLowerCase()];
    const documentedResponse = operation.responses[String(expected)];
    assert.ok(documentedResponse, 'Status is documented');
    if (
      pathname.startsWith('/api/v1/coffees') ||
      pathname.startsWith('/api/v1/brews') ||
      pathname === '/api/v1/me'
    ) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('vary'), /Cookie/i);
    }
    const text = await response.text();
    if (expected === 204) {
      assert.equal(text, '');
      assert.equal(documentedResponse.content, undefined);
      evidence.push(phase);
      return { response };
    }
    const value = JSON.parse(text);
    const key = `${method} ${documented} ${expected}`;
    if (!validators.has(key))
      validators.set(
        key,
        createSchemaValidator(document, documentedResponse.content['application/json'].schema),
      );
    assert.ok(
      validators.get(key)(value),
      'Actual response must validate (credential values deliberately excluded from diagnostics)',
    );
    evidence.push(phase);
    return { value, response };
  }
  const password = randomBytes(24).toString('hex');
  const users = [];
  for (let i = 0; i < 2; i++) {
    const email = `openapi-${randomBytes(8).toString('hex')}-${i}@example.test`.toLowerCase();
    emails.push(email);
    const signup = await request('POST', '/api/v1/auth/sign-up/email', 200, {
      name: 'OpenAPI fixture',
      email,
      password,
    });
    assert.equal(signup.value.user.email, email);
    assert.ok(signup.response.headers.getSetCookie().length);
    const signin = await request('POST', '/api/v1/auth/sign-in/email', 200, { email, password });
    const cookie = signin.response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    assert.ok(cookie);
    users.push({ email, cookie });
  }
  const [a, b] = users;
  await request('GET', '/api/v1/health', 200);
  await request('GET', '/api/v1/auth/get-session', 200);
  const session = await request('GET', '/api/v1/auth/get-session', 200, undefined, a.cookie);
  assert.equal(session.value.user.email, a.email);
  await request('GET', '/api/v1/me', 200, undefined, a.cookie);
  await request('GET', '/api/v1/me', 401);
  await request('POST', '/api/v1/auth/sign-in/email', 401, {
    email: a.email,
    password: `${password}-wrong`,
  });
  await request('POST', '/api/v1/auth/sign-up/email', 422, {
    name: 'Duplicate',
    email: a.email,
    password,
  });
  await request(
    'POST',
    '/api/v1/auth/sign-in/email',
    403,
    { email: a.email, password },
    a.cookie,
    'https://untrusted.example.test',
  );
  await request('POST', '/api/v1/auth/sign-out', 200, {}, undefined, null);
  await request('POST', '/api/v1/auth/sign-out', 403, {}, a.cookie, null);
  const redirected = await request('POST', '/api/v1/auth/sign-in/email', 200, {
    email: a.email,
    password,
    callbackURL: '/',
  });
  assert.equal(redirected.value.redirect, true);
  assert.equal(redirected.value.url, '/');
  await request(
    'POST',
    '/api/v1/auth/sign-out',
    403,
    {},
    a.cookie,
    'https://untrusted.example.test',
  );
  const coffee = (
    await request(
      'POST',
      '/api/v1/coffees',
      201,
      { name: 'Example coffee', roaster: 'Example roaster' },
      a.cookie,
    )
  ).value.coffee;
  assert.equal(coffee.country, null);
  assert.deepEqual(coffee.tastingNotes, []);
  const changed = (
    await request('PATCH', `/api/v1/coffees/${coffee.id}`, 200, { country: null }, a.cookie)
  ).value.coffee;
  assert.equal(changed.name, coffee.name);
  await request('GET', '/api/v1/coffees?limit=1&offset=0', 200, undefined, a.cookie);
  await request('GET', `/api/v1/coffees/${coffee.id}`, 200, undefined, a.cookie);
  await request('GET', `/api/v1/coffees/${coffee.id}`, 404, undefined, b.cookie);
  await request('PATCH', `/api/v1/coffees/${coffee.id}`, 400, {}, a.cookie);
  await request(
    'POST',
    '/api/v1/coffees',
    400,
    { name: 'x', roaster: 'y', ownerId: 'x' },
    a.cookie,
  );
  await request('POST', '/api/v1/coffees', 401, { name: 'x', roaster: 'y' });
  await request(
    'POST',
    '/api/v1/coffees',
    403,
    { name: 'x', roaster: 'y' },
    a.cookie,
    'https://untrusted.example.test',
  );
  const recipe = {
    coffeeId: coffee.id,
    brewer: 'V60',
    grinder: 'Example grinder',
    grindSetting: '6.2',
    doseGrams: 20,
    waterGrams: 300,
    waterTemperatureC: 94,
    totalBrewTimeSeconds: 180,
    brewedAt: '2026-01-02T10:00:00+02:00',
    overallScore: 87.25,
    pours: [
      { waterGrams: 60, startTimeSeconds: 0 },
      { waterGrams: 240, startTimeSeconds: 45 },
    ],
  };
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
  const quick = (await request('POST', '/api/v1/brews', 201, recipe, a.cookie)).value.brew;
  assert.equal(quick.tastingMode, 'quick');
  for (const field of qualities) assert.equal(quick[field], null);
  assert.equal(quick.brewedAt, '2026-01-02T08:00:00.000Z');
  assert.deepEqual(
    quick.pours.map((p) => p.position),
    [0, 1],
  );
  const brews = [quick];
  for (const assessment of [
    { tastingMode: 'sensory' },
    { tastingMode: 'sensory', acidity: 0, flavor: 8.25 },
    { tastingMode: 'sensory', ...Object.fromEntries(qualities.map((field) => [field, 8.25])) },
  ])
    brews.push(
      (await request('POST', '/api/v1/brews', 201, { ...recipe, ...assessment }, a.cookie)).value
        .brew,
    );
  const sensory = brews[3];
  const mode = (
    await request('PATCH', `/api/v1/brews/${sensory.id}`, 200, { tastingMode: 'quick' }, a.cookie)
  ).value.brew;
  for (const field of qualities) assert.equal(mode[field], sensory[field]);
  const patch = (
    await request(
      'PATCH',
      `/api/v1/brews/${sensory.id}`,
      200,
      { flavor: 0, balance: null },
      a.cookie,
    )
  ).value.brew;
  assert.equal(patch.flavor, 0);
  assert.equal(patch.balance, null);
  assert.equal(patch.acidity, 8.25);
  assert.equal(patch.overallScore, 87.25);
  await request('GET', `/api/v1/brews/${quick.id}`, 200, undefined, a.cookie);
  await request('GET', '/api/v1/brews?limit=1&offset=0', 200, undefined, a.cookie);
  const filtered = await request(
    'GET',
    `/api/v1/brews?coffeeId=${coffee.id}&limit=1`,
    200,
    undefined,
    b.cookie,
  );
  assert.deepEqual(filtered.value.brews, []);
  await request('GET', `/api/v1/brews/${quick.id}`, 404, undefined, b.cookie);
  await request('PATCH', `/api/v1/brews/${quick.id}`, 400, { waterGrams: 301 }, a.cookie);
  await request('PATCH', `/api/v1/brews/${quick.id}`, 400, { totalBrewTimeSeconds: 44 }, a.cookie);
  await request('PATCH', `/api/v1/brews/${quick.id}`, 400, {}, a.cookie);
  await request('GET', '/api/v1/brews?limit=1&limit=2', 400, undefined, a.cookie);
  await request('GET', '/api/v1/brews', 401);
  await request(
    'PATCH',
    `/api/v1/brews/${quick.id}`,
    403,
    { flavor: 0 },
    a.cookie,
    'https://untrusted.example.test',
  );
  await request('DELETE', `/api/v1/coffees/${coffee.id}`, 409, undefined, a.cookie);
  for (const brew of brews)
    await request('DELETE', `/api/v1/brews/${brew.id}`, 204, undefined, a.cookie);
  await request('DELETE', `/api/v1/coffees/${coffee.id}`, 204, undefined, a.cookie);
  await request('POST', '/api/v1/auth/sign-out', 200, {}, a.cookie);
  const revoked = await request('GET', '/api/v1/auth/get-session', 200, undefined, a.cookie);
  assert.equal(revoked.value, null);
  await request('GET', '/api/v1/me', 401, undefined, a.cookie);
  process.stdout.write(
    `OpenAPI actual HTTP parity passed: ${evidence.length} schema/status/header checks; signup/signin/session/signout/me, coffee/brew CRUD/paging/ownership, quick and sensory none/partial/full, PATCH preservation, merged-state failures, 400/401/403/404/409/204. No auth values serialized.\n`,
  );
} catch {
  process.stderr.write(`OpenAPI actual HTTP parity failed at ${phase}; response values omitted.\n`);
  process.exitCode = 1;
} finally {
  if (connection && emails.length) {
    try {
      await connection.pool.query('DELETE FROM public."user" WHERE email = ANY($1::text[])', [
        emails,
      ]);
      const remaining = await connection.pool.query(
        'SELECT count(*)::int AS count FROM public."user" WHERE email = ANY($1::text[])',
        [emails],
      );
      assert.equal(remaining.rows[0].count, 0);
    } catch {
      process.exitCode = 1;
      process.stderr.write('OpenAPI exact-user cleanup failed.\n');
    }
  }
  await app?.close().catch(() => {
    process.exitCode = 1;
  });
  await connection?.close().catch(() => {
    process.exitCode = 1;
  });
}
