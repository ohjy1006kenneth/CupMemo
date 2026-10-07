import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { setImmediate } from 'node:timers';
import { eq } from 'drizzle-orm';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { createDatabase, resolveDatabaseConfig, schema } from '@cupmemo/database';

let connection;
let app;
let schemaCreated = false;
let phase = 'explicit isolated test configuration';
let failureLocation = '';
const users = [];
const fixtureName = `authorization_${randomUUID().replaceAll('-', '')}`;
const ownership = `CupMemo authorization fixture ${fixtureName}`;
const records = pgSchema(fixtureName).table('records', {
  id: uuid().primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => schema.user.id),
  value: text().notNull(),
  privateValue: text('private_value').notNull(),
});
const safeFields = { id: records.id, value: records.value };
const captured = [];
const secrets = [
  'private-field-sentinel',
  'password-sentinel',
  'token-sentinel',
  'stale-cache-sentinel',
];
const stdoutWrite = process.stdout.write;
const stderrWrite = process.stderr.write;
const capture = function (chunk, encoding, callback) {
  captured.push(String(chunk));
  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
};
let captureActive = false;
let expectedDatabase;
async function verifyDatabase() {
  const result = await connection.pool.query('SELECT current_database() AS name');
  assert.equal(result.rows[0].name, expectedDatabase);
}
async function verifyFixture() {
  await verifyDatabase();
  const result = await connection.pool.query(
    "SELECT obj_description(oid, 'pg_namespace') AS marker, nspowner = (SELECT usesysid FROM pg_user WHERE usename = current_user) AS owned FROM pg_namespace WHERE nspname = $1",
    [fixtureName],
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].marker, ownership);
  assert.equal(result.rows[0].owned, true);
}
try {
  const config = resolveDatabaseConfig(process.env);
  assert.equal(config.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  expectedDatabase = process.env.CUPMEMO_TEST_DATABASE;
  process.env.NODE_ENV = 'development';
  const [
    { createAuth, resolveAuthConfig },
    { createApp },
    { requireAuthenticatedUser, ownerScope, ownedResourceScope },
  ] = await Promise.all([
    import('../dist/auth.js'),
    import('../dist/app.js'),
    import('../dist/authorization.js'),
  ]);
  const authConfig = resolveAuthConfig(process.env);
  assert.equal(authConfig.production, false);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(authConfig.origin).hostname));
  connection = createDatabase(config.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 900,
    query_timeout: 900,
    statement_timeout: 900,
    idleTimeoutMillis: 1000,
  });
  await verifyDatabase();
  phase = 'exact owned fixture creation';
  await connection.pool.query(`CREATE SCHEMA "${fixtureName}"`);
  schemaCreated = true;
  await connection.pool.query(`COMMENT ON SCHEMA "${fixtureName}" IS '${ownership}'`);
  await verifyFixture();
  await connection.pool.query(
    `CREATE TABLE "${fixtureName}".records (id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES public."user"(id), value text NOT NULL, private_value text NOT NULL)`,
  );

  const authority = createAuth(connection.db, authConfig);
  const auth = {
    origin: authConfig.origin,
    handler: authority.handler,
    getSession: authority.api.getSession,
  };
  process.stdout.write = capture;
  process.stderr.write = capture;
  captureActive = true;
  app = createApp({ auth });
  // No fixture routes exist in the default production app.
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal((await app.inject({ method, url: '/fixture' })).statusCode, 404);
    assert.equal((await app.inject({ method, url: `/fixture/${randomUUID()}` })).statusCode, 404);
  }
  await app.close();
  app = createApp({ auth });
  let work = 0;
  let queries = 0;
  const guard = requireAuthenticatedUser(auth);
  const notFound = (reply) => reply.code(404).send({ message: 'Resource not found' });
  const invalid = (reply) => reply.code(400).send({ message: 'Invalid resource input' });
  const scope = (request) =>
    ownedResourceScope(records.id, records.ownerId, request.params.id, request.authenticatedUser);
  const validBody = (body) =>
    body && typeof body.value === 'string' && Object.keys(body).every((key) => key === 'value');
  app.get('/fixture', { preHandler: guard }, async (request) => {
    work++;
    queries++;
    return connection.db
      .select(safeFields)
      .from(records)
      .where(ownerScope(records.ownerId, request.authenticatedUser));
  });
  app.post('/fixture', { preHandler: guard }, async (request, reply) => {
    work++;
    if (!validBody(request.body)) return invalid(reply);
    queries++;
    const [row] = await connection.db
      .insert(records)
      .values({
        id: randomUUID(),
        ownerId: request.authenticatedUser.id,
        value: request.body.value,
        privateValue: 'private-field-sentinel',
      })
      .returning(safeFields);
    return reply.code(201).send(row);
  });
  app.get('/fixture/:id', { preHandler: guard }, async (request, reply) => {
    work++;
    queries++;
    const [row] = await connection.db.select(safeFields).from(records).where(scope(request));
    return row ?? notFound(reply);
  });
  app.patch('/fixture/:id', { preHandler: guard }, async (request, reply) => {
    work++;
    if (!validBody(request.body)) return invalid(reply);
    queries++;
    const [row] = await connection.db
      .update(records)
      .set({ value: request.body.value })
      .where(scope(request))
      .returning(safeFields);
    return row ?? notFound(reply);
  });
  app.delete('/fixture/:id', { preHandler: guard }, async (request, reply) => {
    work++;
    queries++;
    const [row] = await connection.db.delete(records).where(scope(request)).returning(safeFields);
    return row ?? notFound(reply);
  });
  const responses = [];
  const request = async (cookie, method, url, payload, extra = {}) => {
    const headers = Object.fromEntries(
      Object.entries({ origin: authConfig.origin, ...(cookie ? { cookie } : {}), ...extra }).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const response = await app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload }),
    });
    responses.push(response.body);
    if (!url.startsWith('/api/v1/auth/')) {
      for (const secret of secrets) assert.ok(!response.body.includes(secret));
    }
    return response;
  };
  const assertDenied = async (cookie, status = 401) => {
    const before = [work, queries];
    for (const [method, url, payload] of [
      ['GET', '/fixture'],
      ['POST', '/fixture', { value: 'denied' }],
      ['GET', `/fixture/${randomUUID()}`],
      ['PATCH', `/fixture/${randomUUID()}`, { value: 'denied' }],
      ['DELETE', `/fixture/${randomUUID()}`],
    ]) {
      const denied = await request(cookie, method, url, payload);
      assert.equal(denied.statusCode, status);
      assert.deepEqual(denied.json(), {
        message: status === 401 ? 'Authentication required' : 'Authentication unavailable',
      });
      assert.equal(denied.headers['cache-control'], 'no-store');
      assert.ok(denied.headers.vary.toLowerCase().includes('cookie'));
    }
    assert.deepEqual([work, queries], before);
  };
  phase = 'real Better Auth users and cookies';
  for (const name of ['A', 'B']) {
    const email = `authorization-${fixtureName}-${name.toLowerCase()}@example.test`;
    const password = `password-sentinel-${randomUUID()}-Strong!`;
    secrets.push(password);
    const ownedUser = { email, password };
    users.push(ownedUser);
    const signup = await request(null, 'POST', '/api/v1/auth/sign-up/email', {
      name,
      email,
      password,
    });
    assert.equal(signup.statusCode, 200);
    const result = signup.json();
    ownedUser.id = result.user.id;
    secrets.push(result.token);
    const cookies = signup.headers['set-cookie'];
    assert.ok(Array.isArray(cookies) && cookies.length > 0);
    ownedUser.cookie = cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
    secrets.push(ownedUser.cookie);
  }
  phase = 'own collection/create/get/update/delete and reciprocal IDOR';
  for (const user of users) {
    const me = await request(
      user.cookie,
      'GET',
      `/api/v1/me?userId=${users.find((other) => other !== user).id}`,
      undefined,
      { 'x-user-id': 'spoofed', host: 'attacker.test', 'x-forwarded-host': 'attacker.test' },
    );
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json(), {
      user: { id: user.id, name: user === users[0] ? 'A' : 'B', email: user.email },
    });
    assert.equal(me.headers['set-cookie'], undefined);
    const otherId = users.find((other) => other !== user).id;
    const created = await request(
      user.cookie,
      'POST',
      `/fixture?userId=${otherId}`,
      { value: `own-${user.id}` },
      { 'x-user-id': otherId },
    );
    assert.equal(created.statusCode, 201);
    user.resource = created.json().id;
    const [persisted] = await connection.db
      .select()
      .from(records)
      .where(eq(records.id, user.resource));
    assert.equal(persisted.ownerId, user.id);
  }
  for (const user of users) {
    const other = users.find((candidate) => candidate !== user);
    const collection = await request(
      user.cookie,
      'GET',
      `/fixture?ownerId=${other.id}`,
      undefined,
      { 'x-user-id': other.id },
    );
    assert.equal(collection.statusCode, 200);
    assert.deepEqual(
      collection.json().map((row) => row.id),
      [user.resource],
    );
    assert.equal((await request(user.cookie, 'GET', `/fixture/${user.resource}`)).statusCode, 200);
    const updated = await request(user.cookie, 'PATCH', `/fixture/${user.resource}`, {
      value: 'updated',
    });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.json(), { id: user.resource, value: 'updated' });
    const [ownRow] = await connection.db
      .select()
      .from(records)
      .where(eq(records.id, user.resource));
    assert.equal(ownRow.value, 'updated');
    assert.equal(ownRow.ownerId, user.id);
    const snapshot = await connection.db
      .select()
      .from(records)
      .where(eq(records.id, other.resource));
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const payload = method === 'PATCH' ? { value: 'private-field-sentinel' } : undefined;
      const foreign = await request(user.cookie, method, `/fixture/${other.resource}`, payload);
      const missing = await request(user.cookie, method, `/fixture/${randomUUID()}`, payload);
      assert.equal(foreign.statusCode, 404);
      assert.equal(missing.statusCode, 404);
      assert.equal(foreign.body, missing.body);
      assert.deepEqual(foreign.json(), { message: 'Resource not found' });
      assert.deepEqual(
        await connection.db.select().from(records).where(eq(records.id, other.resource)),
        snapshot,
      );
    }
    assert.equal(
      (await request(user.cookie, 'POST', '/fixture', { value: 'spoofed', ownerId: other.id }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await request(user.cookie, 'PATCH', `/fixture/${user.resource}`, {
          value: 'spoofed',
          ownerId: other.id,
        })
      ).statusCode,
      400,
    );
    const disposable = await request(user.cookie, 'POST', '/fixture', { value: 'own-delete' });
    assert.equal(disposable.statusCode, 201);
    const disposableId = disposable.json().id;
    assert.equal(
      (await request(user.cookie, 'DELETE', `/fixture/${disposableId}`)).statusCode,
      200,
    );
    assert.equal((await request(user.cookie, 'GET', `/fixture/${disposableId}`)).statusCode, 404);
  }
  phase = 'unsafe origins and metadata cannot mutate';
  const beforeRows = await connection.db.select().from(records).orderBy(records.id);
  for (const user of users) {
    for (const headers of [
      { origin: undefined },
      { origin: 'null' },
      { origin: authConfig.origin + '/' },
      {
        origin: 'https://attacker.test',
        host: new URL(authConfig.origin).host,
        'x-forwarded-host': new URL(authConfig.origin).host,
      },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      const before = [work, queries];
      for (const [method, url, payload] of [
        ['POST', '/fixture', { value: 'unsafe' }],
        ['PATCH', `/fixture/${user.resource}`, { value: 'unsafe' }],
        ['DELETE', `/fixture/${user.resource}`],
      ]) {
        const response = await request(user.cookie, method, url, payload, headers);
        assert.equal(response.statusCode, 403);
        assert.deepEqual(response.json(), { message: 'Request origin not allowed' });
      }
      assert.deepEqual([work, queries], before);
    }
  }
  assert.deepEqual(await connection.db.select().from(records).orderBy(records.id), beforeRows);
  phase = 'absent and tampered cookie denial';
  await assertDenied(null);
  await assertDenied('better-auth.session_token=token-sentinel');
  await assertDenied(users[0].cookie.replace(/.$/, 'x'));
  assert.equal(
    (await request(null, 'GET', '/api/v1/me', undefined, { 'x-user-id': users[0].id })).statusCode,
    401,
  );

  phase = 'aged valid non-renewing guard and normal browser renewal';
  const a = users[0];
  const b = users[1];
  await connection.pool.query(
    "UPDATE public.session SET expires_at = now() + interval '5 days', updated_at = now() - interval '2 days' WHERE user_id = $1",
    [a.id],
  );
  const sessions = async (id) =>
    (
      await connection.pool.query('SELECT * FROM public.session WHERE user_id = $1 ORDER BY id', [
        id,
      ])
    ).rows;
  const aged = await sessions(a.id);
  const guarded = await request(a.cookie, 'GET', '/api/v1/me');
  assert.equal(guarded.statusCode, 200);
  assert.equal(guarded.headers['set-cookie'], undefined);
  assert.deepEqual(await sessions(a.id), aged);
  const staleCache = await request(
    `${a.cookie}; better-auth.session_data=stale-cache-sentinel`,
    'GET',
    '/api/v1/me',
  );
  assert.equal(staleCache.statusCode, 200);
  assert.ok(staleCache.headers['set-cookie']?.every((cookie) => /Max-Age=0/i.test(cookie)));
  assert.ok(staleCache.headers['set-cookie']?.length);
  assert.deepEqual(await sessions(a.id), aged);
  const browser = await request(a.cookie, 'GET', '/api/v1/auth/get-session');
  assert.equal(browser.statusCode, 200);
  assert.ok(browser.headers['set-cookie']?.length);
  const renewed = await sessions(a.id);
  assert.ok(renewed[0].expires_at > aged[0].expires_at);
  assert.ok(renewed[0].updated_at > aged[0].updated_at);

  phase = 'expired session cleanup confined and propagated';
  const untouched = await sessions(b.id);
  await connection.pool.query(
    "UPDATE public.session SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
    [a.id],
  );
  const before = [work, queries];
  const expired = await request(a.cookie, 'GET', '/api/v1/me');
  assert.equal(expired.statusCode, 401);
  assert.deepEqual(expired.json(), { message: 'Authentication required' });
  assert.ok(expired.headers['set-cookie'].length);
  assert.ok(expired.headers['set-cookie'].every((cookie) => /Max-Age=0/i.test(cookie)));
  assert.deepEqual(await sessions(a.id), []);
  assert.deepEqual(await sessions(b.id), untouched);
  assert.deepEqual([work, queries], before);
  await assertDenied(a.cookie);

  phase = 'real bounded authoritative database failure and pool recovery';
  const blocker = await connection.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE public.session IN ACCESS EXCLUSIVE MODE');
    const started = Date.now();
    const failed = await request(b.cookie, 'GET', '/fixture');
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), { message: 'Authentication unavailable' });
    assert.ok(Date.now() - started < 2500);
    assert.deepEqual([work, queries], before);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  assert.equal((await request(b.cookie, 'GET', '/fixture')).statusCode, 200);

  phase = 'own delete, revocation and copied-after-signout denial';
  const newSession = await request(null, 'POST', '/api/v1/auth/sign-in/email', {
    email: b.email,
    password: b.password,
  });
  assert.equal(newSession.statusCode, 200);
  const revokedCookie = newSession.headers['set-cookie']
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
  const revokedToken = newSession.json().token;
  secrets.push(revokedCookie, revokedToken);
  assert.equal(
    (
      await connection.pool.query('DELETE FROM public.session WHERE user_id = $1 AND token = $2', [
        b.id,
        revokedToken,
      ])
    ).rowCount,
    1,
  );
  await assertDenied(revokedCookie);
  assert.equal((await request(b.cookie, 'GET', '/api/v1/me')).statusCode, 200);
  assert.equal((await request(b.cookie, 'DELETE', `/fixture/${b.resource}`)).statusCode, 200);
  assert.equal((await request(b.cookie, 'GET', `/fixture/${b.resource}`)).statusCode, 404);
  assert.equal((await request(b.cookie, 'POST', '/api/v1/auth/sign-out', {})).statusCode, 200);
  await assertDenied(b.cookie);
  assert.equal((await request(b.cookie, 'GET', '/api/v1/me')).statusCode, 401);
  assert.deepEqual(await sessions(b.id), []);
  phase = 'credential and private sentinel response/log exclusion';
  await app.close();
  app = undefined;
  await new Promise((resolve) => setImmediate(resolve));
  // Auth transport intentionally returns tokens; exclusion concerns application
  // responses, tested individually above and all fixture/me responses below.
  assert.ok(!responses.some((body) => body.includes('private-field-sentinel')));
  const output = captured.join('');
  assert.ok(output.includes('incoming request'));
  assert.ok(output.includes('request completed'));
  for (const secret of secrets) assert.ok(secret && !output.includes(secret));
} catch (error) {
  // Report a source location, never assertion values or database diagnostics.
  failureLocation =
    error instanceof Error
      ? (error.stack?.match(/authorization-integration\.mjs:\d+:\d+/)?.[0] ?? '')
      : '';
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {
    process.exitCode = 1;
  });
  if (connection) {
    try {
      if (schemaCreated) {
        await verifyFixture();
        await connection.pool.query(`DROP TABLE IF EXISTS "${fixtureName}".records`);
        await connection.pool.query(`DROP SCHEMA "${fixtureName}"`);
      }
      await verifyDatabase();
      for (const user of users) {
        await connection.pool.query(
          'DELETE FROM public."user" WHERE email = $1 AND ($2::text IS NULL OR id = $2)',
          [user.email, user.id ?? null],
        );
      }
    } catch {
      process.exitCode = 1;
      phase = 'exact owned fixture cleanup';
    }
    const started = Date.now();
    await connection.close().catch(() => {
      process.exitCode = 1;
    });
    if (Date.now() - started > 2500) {
      process.exitCode = 1;
      phase = 'bounded client drain';
    }
    assert.equal(connection.pool.totalCount, 0);
  }
  if (captureActive) {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
  if (process.exitCode)
    process.stderr.write(`Authorization integration failed at: ${phase}. ${failureLocation}\n`);
  else
    process.stdout.write(
      'Authorization real PostgreSQL two-user SQL scopes, reciprocal IDOR, CSRF, authoritative revocation/cleanup, non-renewal/browser renewal, bounded DB failure/drain and private log exclusion passed.\n',
    );
}
