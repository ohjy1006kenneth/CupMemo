import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, resolveDatabaseConfig } from '../dist/index.js';
import { createAuth, resolveAuthConfig } from '../../../apps/api/dist/auth.js';

const baseHashes = [
  '68bc8b1ad6f8ac655a6f545bd8434e266f267803c3d0baba490a736e38c51802',
  '493b7b1de2e3abae593ac646aad4f9d8e1d03663f8a0b5313a66d209afa6b600',
];
let connection;
let folder;
let phase = 'guarded upgrade configuration';
const emails = [];
try {
  const config = resolveDatabaseConfig(process.env);
  assert.equal(config.environment, 'test');
  assert.notEqual(process.env.NODE_ENV, 'production');
  assert.ok(config.databaseName.endsWith('_upgrade'), 'separate owned upgrade database required');
  process.env.NODE_ENV = 'development';
  const authConfig = resolveAuthConfig(process.env);
  connection = createDatabase(config.databaseUrl, {
    max: 2,
    connectionTimeoutMillis: 1500,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  const identity = (await connection.pool.query('select current_database(), version()')).rows[0];
  assert.equal(identity.current_database, config.databaseName);
  assert.match(identity.version, /^PostgreSQL 17\./);
  phase = 'empty upgrade database precondition';
  const present = await connection.pool.query(
    "select to_regclass('public.user') AS users, to_regclass('cupmemo.coffees') AS coffees, to_regclass('drizzle.__drizzle_migrations') AS history",
  );
  assert.deepEqual(present.rows[0], { users: null, coffees: null, history: null });
  const migrations = new URL('../drizzle/', import.meta.url);
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrations), 'utf8'));
  assert.equal(journal.entries.length, 3);
  folder = await mkdtemp(path.join(tmpdir(), 'cupmemo-domain-upgrade-'));
  await mkdir(path.join(folder, 'meta'));
  await writeFile(
    path.join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
  );
  for (const [i, entry] of journal.entries.slice(0, 2).entries()) {
    const sql = await readFile(new URL(`${entry.tag}.sql`, migrations));
    assert.equal(createHash('sha256').update(sql).digest('hex'), baseHashes[i]);
    await writeFile(path.join(folder, `${entry.tag}.sql`), sql);
  }
  phase = 'exact d8245ef base migration application';
  await migrate(connection.db, { migrationsFolder: folder });
  assert.equal(
    (await connection.pool.query('select count(*)::int as count from drizzle.__drizzle_migrations'))
      .rows[0].count,
    2,
  );
  const auth = createAuth(connection.db, authConfig);
  const cookies = [];
  phase = 'real A/B Better Auth signup before upgrade';
  for (const label of ['a', 'b']) {
    const email = `domain-upgrade-${label}-${randomUUID()}@example.test`.toLowerCase();
    emails.push(email);
    const response = await auth.handler(
      new globalThis.Request(`${authConfig.origin}/api/v1/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: authConfig.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Upgrade ${label}`, email, password: randomUUID() }),
      }),
    );
    assert.equal(response.status, 200);
    cookies.push(
      response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    );
    assert.ok(cookies.at(-1));
  }
  async function snapshot() {
    const users = (
      await connection.pool.query('select * from public."user" where email = ANY($1) order by id', [
        emails,
      ])
    ).rows;
    const ids = users.map((row) => row.id);
    const accounts = (
      await connection.pool.query(
        'select * from public.account where user_id = ANY($1) order by id',
        [ids],
      )
    ).rows;
    const sessions = (
      await connection.pool.query(
        'select * from public.session where user_id = ANY($1) order by id',
        [ids],
      )
    ).rows;
    return { users, accounts, sessions };
  }
  async function sessionsValid() {
    for (const [i, cookie] of cookies.entries()) {
      const session = await auth.api.getSession({
        headers: new globalThis.Headers({ cookie }),
        query: { disableRefresh: true, disableCookieCache: true },
      });
      assert.equal(session?.user.email, emails[i]);
    }
  }
  await sessionsValid();
  const before = await snapshot();
  assert.equal(before.users.length, 2);
  assert.equal(before.accounts.length, 2);
  assert.equal(before.sessions.length, 2);
  phase = 'populated upgrade preserves users/accounts/sessions';
  await migrate(connection.db, { migrationsFolder: migrations.pathname });
  assert.deepEqual(await snapshot(), before);
  await sessionsValid();
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await connection.pool.query('select count(*)::int as count from drizzle.__drizzle_migrations'))
      .rows[0].count,
    3,
  );
  await migrate(connection.db, { migrationsFolder: migrations.pathname });
  assert.deepEqual(await snapshot(), before);
  process.stdout.write(
    'Populated upgrade passed: exact two d8245ef migrations -> domain migration, 2 real Better Auth users/accounts/sessions unchanged and valid, idempotent reapply.\n',
  );
} catch {
  process.stderr.write(`Domain upgrade integration failed at: ${phase}.\n`);
  process.exitCode = 1;
} finally {
  if (connection && emails.length) {
    try {
      const ids = (
        await connection.pool.query('select id from public."user" where email = ANY($1)', [emails])
      ).rows.map((row) => row.id);
      await connection.pool.query('delete from public."user" where id = ANY($1)', [ids]);
      assert.equal(
        (
          await connection.pool.query(
            'select count(*)::int as count from public.account where user_id = ANY($1)',
            [ids],
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await connection.pool.query(
            'select count(*)::int as count from public.session where user_id = ANY($1)',
            [ids],
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await connection.pool.query(
            'select count(*)::int as count from public."user" where email = ANY($1)',
            [emails],
          )
        ).rows[0].count,
        0,
      );
      process.stdout.write('Upgrade fixture auth rows cleaned; owned database retained.\n');
    } catch {
      process.stderr.write('Upgrade fixture cleanup failed.\n');
      process.exitCode = 1;
    }
  }
  await connection?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
}
