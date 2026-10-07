import assert from 'node:assert/strict';
import process from 'node:process';

import { createDatabase, resolveDatabaseConfig } from '@cupmemo/database';

let connection;
let app;
let email;
let phase = 'test configuration';
let closeConnectionPromise;
const closeConnection = () => {
  closeConnectionPromise ??= connection?.close();
  return closeConnectionPromise ?? Promise.resolve();
};
try {
  const databaseConfig = resolveDatabaseConfig(process.env);
  assert.equal(databaseConfig.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  // Better Auth intentionally disables CSRF checks in its test mode; exercise the
  // configured origin policy under development semantics while retaining DB test mode.
  process.env.NODE_ENV = 'development';
  const [{ createAuth, resolveAuthConfig }, { createApp }] = await Promise.all([
    import('../dist/auth.js'),
    import('../dist/app.js'),
  ]);
  const authConfig = resolveAuthConfig(process.env);
  assert.equal(authConfig.production, false);
  connection = createDatabase(databaseConfig.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 1500,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  const auth = createAuth(connection.db, authConfig);
  phase = 'sanitized handler failure';
  const failureApp = createApp({
    auth: {
      origin: authConfig.origin,
      handler: async () => {
        throw new Error('password-sentinel token-sentinel database-sentinel');
      },
    },
  });
  try {
    const failureResponse = await failureApp.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: { origin: authConfig.origin, 'content-type': 'application/json' },
      payload: JSON.stringify({ password: 'password-sentinel' }),
    });
    assert.equal(failureResponse.statusCode, 500);
    assert.equal(failureResponse.body, '{"message":"Authentication request failed"}');
    assert.ok(!failureResponse.body.includes('password-sentinel'));
    assert.ok(!failureResponse.body.includes('token-sentinel'));
    assert.ok(!failureResponse.body.includes('database-sentinel'));
  } finally {
    await failureApp.close();
  }

  app = createApp({
    auth: { origin: authConfig.origin, handler: auth.handler },
    close: closeConnection,
  });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const suffix = `${process.pid}-${Date.now()}`;
  email = `auth-integration-${suffix}@example.test`;
  const password = `integration-${suffix}-Strong!`;

  phase = 'origin/CSRF rejection';
  const rejected = await globalThis.fetch(`${baseUrl}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      origin: 'https://untrusted.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      cookie: 'better-auth.session_token=untrusted-sentinel',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Auth Test', email, password }),
  });
  assert.equal(rejected.status, 403);

  phase = 'email/password signup';
  const signup = await globalThis.fetch(`${baseUrl}/api/v1/auth/sign-up/email`, {
    method: 'POST',
    headers: { origin: authConfig.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Auth Integration', email, password }),
  });
  assert.equal(signup.status, 200);
  const signupBody = await signup.json();
  assert.equal(signupBody.user.email, email);
  assert.ok(!JSON.stringify(signupBody).includes(password));
  assert.ok(signup.headers.getSetCookie().length > 0);
  const persisted = await connection.pool.query(
    `SELECT account.password FROM public."account" AS account
     JOIN public."user" AS auth_user ON auth_user.id = account.user_id
     WHERE auth_user.email = $1`,
    [email],
  );
  assert.equal(persisted.rowCount, 1);
  assert.ok(persisted.rows[0].password);
  assert.notEqual(persisted.rows[0].password, password);

  phase = 'invalid password rejection';
  const invalidSignin = await globalThis.fetch(`${baseUrl}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: authConfig.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: `${password}-wrong` }),
  });
  assert.equal(invalidSignin.status, 401);

  phase = 'email/password sign-in';
  const signin = await globalThis.fetch(`${baseUrl}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: authConfig.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signin.status, 200);
  const cookies = signin.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  const cookieHeader = cookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
  const signinBody = await signin.json();
  assert.equal(signinBody.user.email, email);
  assert.ok(!JSON.stringify(signinBody).includes(password));

  phase = 'session lookup';
  const sessionResponse = await globalThis.fetch(`${baseUrl}/api/v1/auth/get-session`, {
    headers: { cookie: cookieHeader, origin: authConfig.origin },
  });
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).user.email, email);

  phase = 'configured origin with crafted Host';
  const craftedHostSession = await globalThis.fetch(`${baseUrl}/api/v1/auth/get-session`, {
    headers: {
      cookie: cookieHeader,
      origin: authConfig.origin,
      host: 'attacker.example',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(craftedHostSession.status, 200);
  assert.equal((await craftedHostSession.json()).user.email, email);

  phase = 'injected production cookie attributes';
  const productionConfig = {
    ...authConfig,
    origin: 'https://auth-production.example.test',
    production: true,
  };
  const productionApp = createApp({
    auth: {
      origin: productionConfig.origin,
      handler: createAuth(connection.db, productionConfig).handler,
    },
  });
  try {
    const productionBaseUrl = await productionApp.listen({ host: '127.0.0.1', port: 0 });
    const productionSignin = await globalThis.fetch(
      `${productionBaseUrl}/api/v1/auth/sign-in/email`,
      {
        method: 'POST',
        headers: { origin: productionConfig.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
    );
    assert.equal(productionSignin.status, 200);
    const productionCookies = productionSignin.headers.getSetCookie();
    assert.ok(productionCookies.length > 0);
    assert.ok(productionCookies.every((cookie) => /; Secure(?:;|$)/i.test(cookie)));
    assert.ok(productionCookies.every((cookie) => /; HttpOnly(?:;|$)/i.test(cookie)));
    assert.ok(productionCookies.every((cookie) => /; SameSite=Lax(?:;|$)/i.test(cookie)));
  } finally {
    await productionApp.close();
  }

  phase = 'server restart and persisted session';
  await app.close();
  closeConnectionPromise = undefined;
  connection = createDatabase(databaseConfig.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 1500,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  app = createApp({
    auth: { origin: authConfig.origin, handler: createAuth(connection.db, authConfig).handler },
    close: closeConnection,
  });
  const restartedBaseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const afterRestart = await globalThis.fetch(`${restartedBaseUrl}/api/v1/auth/get-session`, {
    headers: { cookie: cookieHeader, origin: authConfig.origin },
  });
  assert.equal(afterRestart.status, 200);
  assert.equal((await afterRestart.json()).user.email, email);

  phase = 'sign-out and revocation';
  const signout = await globalThis.fetch(`${restartedBaseUrl}/api/v1/auth/sign-out`, {
    method: 'POST',
    headers: {
      cookie: cookieHeader,
      origin: authConfig.origin,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(signout.status, 200);
  const afterSignout = await globalThis.fetch(`${restartedBaseUrl}/api/v1/auth/get-session`, {
    headers: { cookie: cookieHeader, origin: authConfig.origin },
  });
  assert.equal(afterSignout.status, 200);
  assert.equal(await afterSignout.json(), null);

  process.stdout.write(
    'Better Auth signup/sign-in, origin/Host protection, production cookie attributes, persisted sessions and revocation checks passed.\n',
  );
} catch {
  process.stderr.write(`Better Auth integration check failed at: ${phase}.\n`);
  process.exitCode = 1;
} finally {
  if (connection) {
    if (email) {
      await connection.pool
        .query('DELETE FROM public."user" WHERE email = $1', [email])
        .catch(() => {
          process.exitCode = 1;
        });
    }
  }
  if (app)
    await app.close().catch(() => {
      process.exitCode = 1;
    });
  await closeConnection().catch(() => {
    process.exitCode = 1;
  });
}
