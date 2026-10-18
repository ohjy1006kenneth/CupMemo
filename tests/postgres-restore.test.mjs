import { afterEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { databaseFixture, names, directory } from './helpers/restore-fixture.mjs';
import { canonicalCatalog, sha256 } from '../infrastructure/scripts/postgres-restore-oracle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireDatabase = createRequire(
  new URL('../packages/database/package.json', import.meta.url),
);
const pg = requireDatabase('pg');
const owned = [];
afterEach(async () => {
  for (const dir of owned.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
async function fixture({ version = '17.9', body = 'return 0;', post = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(homedir(), '.cupmemo-restore48-'));
  owned.push(dir);
  const bundle = path.join(dir, 'backup-00000000-0000-4000-8000-000000000048');
  const state = path.join(dir, 'state');
  const release = path.join(dir, 'release');
  for (const d of [bundle, state, release]) await fs.mkdir(d, { mode: 0o700 });
  const migrationDir = path.join(release, 'packages/database/drizzle');
  await fs.cp(directory, migrationDir, { recursive: true });
  for (const name of ['packages', 'packages/database'])
    await fs.chmod(path.join(release, name), 0o700);
  // cp preserves source directory modes; the trusted fixture must not inherit
  // the development checkout's group-writable directories.
  for (const d of [migrationDir, path.join(migrationDir, 'meta')]) {
    await fs.chmod(d, 0o700);
    for (const entry of await fs.readdir(d, { withFileTypes: true }))
      if (entry.isFile()) await fs.chmod(path.join(d, entry.name), 0o600);
  }
  const git = (args) =>
    execFileSync('/usr/bin/git', args, {
      cwd: release,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git(['init', '-q']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Synthetic Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Synthetic source identity',
  ]);
  const files = git(['ls-files', 'packages/database/drizzle']).split('\n');
  const migrationFiles = await Promise.all(
    files.map(async (name) => ({
      name,
      sha256: sha256(await fs.readFile(path.join(release, name))),
    })),
  );
  const bytes = 'synthetic transport, NOT PostgreSQL archive';
  const manifest = {
    version: 1,
    id: path.basename(bundle),
    archive: 'database.dump',
    bytes: bytes.length,
    sha256: sha256(bytes),
    captureTime: '2026-10-17T00:00:00.000Z',
    toolVersion: 'pg_dump (PostgreSQL) 17.9',
    targetFingerprint: 'f'.repeat(64),
    release: {
      status: 'verified',
      commit: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
      migrationFiles,
      databaseMigrationState: 'unverified',
    },
  };
  await fs.writeFile(path.join(bundle, 'database.dump'), bytes, { mode: 0o600 });
  await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  const db = await databaseFixture();
  const after = await databaseFixture({
    inventory: {
      schemas: ['public', 'cupmemo', 'drizzle'],
      relations: '33',
      sequences: [['drizzle', '__drizzle_migrations_id_seq', true]],
    },
    ...post,
  });
  const oracle = {
    version: 1,
    archiveSha256: manifest.sha256,
    releaseCommit: manifest.release.commit,
    releaseTree: manifest.release.tree,
    catalogSha256: sha256(canonicalCatalog(db.catalog)),
    rowCounts: Object.fromEntries(
      names.map((n) => [n, n === 'drizzle.__drizzle_migrations' ? '3' : '0']),
    ),
    observedAt: manifest.captureTime,
  };
  const expectations = path.join(dir, 'expectations.json');
  await fs.writeFile(expectations, JSON.stringify(oracle), { mode: 0o600 });
  const log = path.join(dir, 'calls');
  const bin = path.join(dir, 'pg_restore');
  // Actual compiled ELF fixture exercises spawn, stdin, argv and process reaping.
  // Its PostgreSQL-looking version output is synthetic, never real PG proof.
  const source = path.join(dir, 'fixture.c');
  await fs.writeFile(
    source,
    `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\n#include <signal.h>\nint main(int argc,char**argv){FILE*f=fopen(${JSON.stringify(log)},"a");for(int i=1;i<argc;i++)fprintf(f,"%s\\n",argv[i]);fprintf(f,"env:%s:%s:%s\\n",getenv("PGDATABASE")?getenv("PGDATABASE"):"none",getenv("NODE_OPTIONS")?"poison":"clean",getenv("PGSERVICE")?"poison":"clean");fclose(f);if(argc==2&&!strcmp(argv[1],"--version")){puts("pg_restore (PostgreSQL) ${version}");return 0;}int c;while((c=getchar())!=EOF){}if(argc==2&&!strcmp(argv[1],"--list")){puts("synthetic catalog");return 0;} ${body} }`,
  );
  execFileSync('/usr/bin/cc', [source, '-o', bin], { stdio: 'pipe' });
  await fs.chmod(bin, 0o700);
  let connections = 0,
    closes = 0;
  const connect = async () => {
    const q = connections++ === 0 ? db : after;
    return {
      query: q.query,
      close: async () => {
        closes++;
      },
    };
  };
  const env = {
    CUPMEMO_DB_ENV: 'test',
    CUPMEMO_TEST_DATABASE: 'cupmemo_test_restore48',
    CUPMEMO_DATABASE_URL_TEST:
      'postgresql://fixture:fixture-secret@127.0.0.1:55499/cupmemo_test_restore48?sslmode=disable',
    CUPMEMO_RESTORE_CONFIRM_DATABASE: 'cupmemo_test_restore48',
    CUPMEMO_PG_RESTORE_BIN: bin,
    CUPMEMO_RESTORE_BUNDLE_DIR: bundle,
    CUPMEMO_RESTORE_STATE_DIR: state,
    CUPMEMO_RESTORE_RELEASE_DIR: release,
    CUPMEMO_RESTORE_EXPECTED_SHA256: manifest.sha256,
    CUPMEMO_RESTORE_EXPECTATIONS_FILE: expectations,
    CUPMEMO_RESTORE_EXPECTATIONS_SHA256: sha256(JSON.stringify(oracle)),
  };
  return {
    dir,
    bundle,
    state,
    release,
    bin,
    log,
    env,
    connect,
    db,
    after,
    manifest,
    oracle,
    connections: () => connections,
    closes: () => closes,
  };
}

test.each([undefined, 'disable', 'require', 'verify-ca', 'verify-full'])(
  'production query clients and real child share effective sslmode %s without network access',
  async (mode) => {
    const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
    const f = await fixture({
      body: `return strcmp(getenv("PGSSLMODE"),${JSON.stringify(mode ?? 'require')}) ? 41 : 0;`,
    });
    f.env.CUPMEMO_DATABASE_URL_TEST =
      'postgresql://fixture:fixture-secret@127.0.0.1:55499/cupmemo_test_restore48' +
      (mode === undefined ? '' : `?sslmode=${mode}`);
    const clients = [];
    // Keep runRestore -> connectTarget -> createDatabase -> installed Pool/Client
    // parsing real. Replace ONLY socket acquisition with synthetic query results.
    // No Client.connect/socket is ever invoked; this is not a TLS handshake test.
    const acquire = vi.spyOn(pg.Pool.prototype, 'connect').mockImplementation(async function () {
      const client = new this.Client(this.options);
      clients.push({ client, url: this.options.connectionString });
      const fixtureQuery = clients.length === 1 ? f.db : f.after;
      return { query: fixtureQuery.query, release: () => {} };
    });
    try {
      const result = await runRestore(f.env);
      expect(result.status).toBe('structural_checks_passed');
      expect(clients).toHaveLength(2);
      for (const { client, url } of clients) {
        expect(client.connectionParameters.ssl).toEqual(mode === 'disable' ? false : {});
        expect(new URL(url).searchParams.get('sslmode')).toBe(mode ?? 'require');
      }
    } finally {
      acquire.mockRestore();
    }
  },
);

test('guarded engine executes real ELF fixture, not a DB restore, preserves source and writes private honest receipt', async () => {
  const { runRestore, validateRelease } =
    await import('../infrastructure/scripts/postgres-restore.mjs');
  const f = await fixture();
  const original = await fs.readFile(path.join(f.bundle, 'manifest.json'));
  for (const name of [
    'packages',
    'packages/database',
    'packages/database/drizzle',
    'packages/database/drizzle/meta',
  ])
    expect((await fs.stat(path.join(f.release, name))).mode & 0o022, name).toBe(0);
  validateRelease({ release: f.release }, f.manifest.release);
  const receipt = await runRestore(
    { ...f.env, NODE_OPTIONS: 'must-not-inherit' },
    { connect: f.connect },
  );
  expect(receipt.status).toBe('structural_checks_passed');
  expect(receipt.recoveryVerified).toBe(false);
  expect(receipt.applicationChecks).toBe('unperformed');
  expect(receipt.tablesCompared).toBe(10);
  expect(receipt.relationshipsCompared).toBe(8);
  expect(receipt.targetFingerprint).not.toBe(f.manifest.targetFingerprint);
  const calls = await fs.readFile(f.log, 'utf8');
  expect(calls).toContain('--list');
  expect(calls).toContain('--single-transaction');
  expect(calls).toContain('--dbname=cupmemo_test_restore48');
  expect(calls).not.toMatch(/--clean|--create|fixture-secret|poison/);
  expect(f.connections()).toBe(2);
  expect(f.closes()).toBe(2);
  const entries = await fs.readdir(f.state);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatch(/^restore-.*\.json$/);
  const file = path.join(f.state, entries[0]);
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(receipt);
  expect(await fs.readFile(path.join(f.bundle, 'manifest.json'))).toEqual(original);
  expect(JSON.stringify(receipt)).not.toMatch(/fixture-secret|postgresql:|synthetic catalog/);
});

test.each([
  { CUPMEMO_DB_ENV: 'production' },
  { NODE_ENV: 'production' },
  { PGOPTIONS: '' },
  { DATABASE_URL: 'postgresql://private' },
  { CUPMEMO_DATABASE_URL_PRODUCTION: 'postgresql://private' },
  { CUPMEMO_DATABASE_URL_DEVELOPMENT: 'postgresql://private' },
  { CUPMEMO_RESTORE_CONFIRM_DATABASE: 'other' },
  { CUPMEMO_RESTORE_EXPECTED_SHA256: 'A'.repeat(64) },
  { CUPMEMO_DATABASE_URL_TEST: 'postgresql://fixture:%ZZ@127.0.0.1/cupmemo_test_restore48' },
  {
    CUPMEMO_DATABASE_URL_TEST:
      'postgresql://fixture:pw@127.0.0.1/cupmemo_test_restore48?host=elsewhere',
  },
  {
    CUPMEMO_DATABASE_URL_TEST: 'postgresql://fixture:pw@127.0.0.1/cupmemo_test_restore48#fragment',
  },
  { CUPMEMO_DATABASE_URL_TEST: 'postgresql://fixture:pw@192.0.2.1/cupmemo_test_restore48' },
  { CUPMEMO_RESTORE_TIMEOUT_MS: '0' },
])('unsafe config %# never invokes executable or DB', async (override) => {
  const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
  const f = await fixture();
  await expect(runRestore({ ...f.env, ...override }, { connect: f.connect })).rejects.toThrow(
    'phase=configuration',
  );
  expect(f.connections()).toBe(0);
  await expect(fs.stat(f.log)).rejects.toThrow();
  expect(await fs.readdir(f.state)).toEqual([]);
});

test.each([
  'tamper',
  'digest',
  'manifest',
  'oracle',
  'oracle-digest',
  'unbound-oracle',
  'release-dirty',
  'ignored-migration',
  'release-mismatch',
  'unknown-profile',
  'symlink',
  'hardlink',
  'permissions',
  'extra',
  'state-in-bundle',
  'repository',
  'pgdata',
  'script',
  'bin-symlink',
  'bin-writable',
  'ancestry-writable',
])('unsafe source/path %s refuses before subprocess/DB and preserves input', async (kind) => {
  const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
  const f = await fixture();
  const archive = path.join(f.bundle, 'database.dump');
  if (kind === 'tamper') await fs.writeFile(archive, 'tampered');
  if (kind === 'digest') f.env.CUPMEMO_RESTORE_EXPECTED_SHA256 = '0'.repeat(64);
  if (kind === 'manifest') await fs.writeFile(path.join(f.bundle, 'manifest.json'), '{}');
  if (kind === 'oracle') await fs.writeFile(f.env.CUPMEMO_RESTORE_EXPECTATIONS_FILE, '{}');
  if (kind === 'oracle-digest') f.env.CUPMEMO_RESTORE_EXPECTATIONS_SHA256 = '0'.repeat(64);
  if (kind === 'unbound-oracle') {
    f.oracle.archiveSha256 = '0'.repeat(64);
    const text = JSON.stringify(f.oracle);
    await fs.writeFile(f.env.CUPMEMO_RESTORE_EXPECTATIONS_FILE, text);
    f.env.CUPMEMO_RESTORE_EXPECTATIONS_SHA256 = sha256(text);
  }
  if (kind === 'release-dirty') await fs.writeFile(path.join(f.release, 'untracked'), 'x');
  if (kind === 'ignored-migration') {
    await fs.writeFile(path.join(f.release, '.git/info/exclude'), 'extra.sql\n');
    await fs.writeFile(path.join(f.release, 'packages/database/drizzle/extra.sql'), 'SELECT 1;', {
      mode: 0o600,
    });
  }
  if (kind === 'release-mismatch' || kind === 'unknown-profile') {
    if (kind === 'release-mismatch') f.manifest.release.commit = '0'.repeat(40);
    else f.manifest.release.migrationFiles[0].sha256 = '0'.repeat(64);
    await fs.writeFile(path.join(f.bundle, 'manifest.json'), JSON.stringify(f.manifest));
  }
  if (kind === 'symlink') {
    await fs.rename(archive, path.join(f.dir, 'original'));
    await fs.symlink(path.join(f.dir, 'original'), archive);
  }
  if (kind === 'hardlink') await fs.link(archive, path.join(f.dir, 'hardlink'));
  if (kind === 'permissions') await fs.chmod(archive, 0o644);
  if (kind === 'extra') await fs.writeFile(path.join(f.bundle, 'extra'), 'preserve');
  if (kind === 'state-in-bundle') f.env.CUPMEMO_RESTORE_STATE_DIR = f.bundle;
  if (kind === 'repository') f.env.CUPMEMO_RESTORE_BUNDLE_DIR = root.slice(0, -1);
  if (kind === 'pgdata') f.env.POSTGRES_DATA_DIR = f.dir;
  if (kind === 'script') await fs.writeFile(f.bin, '#!/bin/sh\nexit 0\n');
  if (kind === 'bin-symlink') {
    await fs.rename(f.bin, path.join(f.dir, 'real'));
    await fs.symlink(path.join(f.dir, 'real'), f.bin);
  }
  if (kind === 'bin-writable') await fs.chmod(f.bin, 0o720);
  if (kind === 'ancestry-writable') await fs.chmod(f.dir, 0o720);
  await expect(runRestore(f.env, { connect: f.connect })).rejects.toThrow('restore failed');
  expect(f.connections()).toBe(0);
  await expect(fs.stat(f.log)).rejects.toThrow();
  expect(await fs.readdir(f.bundle)).toContain('database.dump');
});

test('wrong PG version and nonempty target refuse without restore invocation', async () => {
  const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
  const old = await fixture({ version: '16.9' });
  await expect(runRestore(old.env, { connect: old.connect })).rejects.toThrow('phase=tool');
  expect(old.connections()).toBe(0);
  const f = await fixture();
  const bad = await databaseFixture({ inventory: { relations: '1' } });
  await expect(
    runRestore(f.env, { connect: async () => ({ query: bad.query, close: async () => {} }) }),
  ).rejects.toThrow('phase=preflight');
  expect(await fs.readFile(f.log, 'utf8')).not.toContain('--single-transaction');
  expect((await fs.readdir(f.state)).filter((s) => s.endsWith('.lock'))).toEqual([]);
});

test.each(['restore', 'postcheck', 'receipt'])(
  'failure at %s preserves unknown target and lock, no destructive retry',
  async (kind) => {
    const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
    const f = await fixture({
      body:
        kind === 'restore' ? 'fputs("private SQL/fixture-secret",stderr);return 9;' : 'return 0;',
      post: kind === 'postcheck' ? { orphan: '1' } : {},
    });
    await expect(
      runRestore(f.env, {
        connect: f.connect,
        report: (stage) => {
          if (kind === 'receipt' && stage === 'receipt') throw new Error('receipt write failed');
        },
      }),
    ).rejects.toThrow(`phase=${kind === 'postcheck' ? 'verification' : kind}`);
    expect((await fs.readdir(f.state)).filter((s) => s.endsWith('.lock'))).toHaveLength(1);
    const failures = (await fs.readdir(f.state)).filter((s) => s.startsWith('restore-failed-'));
    expect(failures).toHaveLength(1);
    const failure = JSON.parse(await fs.readFile(path.join(f.state, failures[0]), 'utf8'));
    expect(failure.status).toBe('failed');
    expect(failure.recoveryVerified).toBe(false);
    expect(failure.outcome).toBe('unknown_preserved');
    expect(JSON.stringify(failure)).not.toMatch(/fixture-secret|private SQL/);
    const calls = await fs.readFile(f.log, 'utf8');
    await expect(runRestore(f.env, { connect: f.connect })).rejects.toThrow('phase=lock');
    expect(await fs.readFile(f.log, 'utf8')).toBe(calls);
  },
);

test.each(['timeout', 'abort'])(
  '%s terminates/reaps actual ignoring child, preserves lock and source',
  async (kind) => {
    const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
    const f = await fixture({ body: 'signal(SIGTERM,SIG_IGN);sleep(30);return 0;' });
    const controller = new globalThis.AbortController();
    if (kind === 'timeout') f.env.CUPMEMO_RESTORE_TIMEOUT_MS = '200';
    const started = Date.now();
    const result = runRestore(f.env, { connect: f.connect, signal: controller.signal });
    const assertion = expect(result).rejects.toThrow('phase=restore');
    if (kind === 'abort') {
      let launched = false;
      for (let i = 0; i < 200; i++) {
        try {
          launched = (await fs.readFile(f.log, 'utf8')).includes('--single-transaction');
        } catch {
          /* fixture not launched yet */
        }
        if (launched) break;
        await setTimeout(10);
      }
      expect(launched).toBe(true);
      await setTimeout(30);
      controller.abort();
    }
    await assertion;
    expect(Date.now() - started).toBeLessThan(5000);
    expect((await fs.readdir(f.state)).some((s) => s.endsWith('.lock'))).toBe(true);
  },
);

test('concurrent exact-target lock excludes even a different role; no stale stealing', async () => {
  const { runRestore } = await import('../infrastructure/scripts/postgres-restore.mjs');
  const f = await fixture();
  const controller = new globalThis.AbortController();
  let enter;
  const entered = new Promise((r) => {
    enter = r;
  });
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const first = runRestore(f.env, {
    signal: controller.signal,
    connect: async (config) => {
      enter();
      await gate;
      return f.connect(config);
    },
  });
  const checked = expect(first).rejects.toThrow();
  await entered;
  try {
    await expect(
      runRestore(
        {
          ...f.env,
          CUPMEMO_DATABASE_URL_TEST: f.env.CUPMEMO_DATABASE_URL_TEST.replace(
            'fixture:fixture-secret',
            'other:other-secret',
          ).replace('127.0.0.1', 'localhost'),
        },
        { connect: f.connect },
      ),
    ).rejects.toThrow('phase=lock');
  } finally {
    controller.abort();
    release();
    await checked;
  }
  expect((await fs.readdir(f.state)).filter((s) => s.endsWith('.lock'))).toEqual([]);
});

test('CLI exact opt-in and inert import cannot connect or execute fixtures', async () => {
  const f = await fixture();
  for (const args of [[], ['--run'], ['--restore-test', '--clean']]) {
    const p = spawn(process.execPath, ['infrastructure/scripts/postgres-restore.mjs', ...args], {
      cwd: root,
      env: f.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (b) => {
      out += b;
    });
    p.stderr.on('data', (b) => {
      out += b;
    });
    const code = await new Promise((r) => p.on('close', r));
    expect(code).toBe(1);
    expect(out).toBe('restore refused: explicit --restore-test required\n');
  }
  execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./infrastructure/scripts/postgres-restore.mjs')"],
    { cwd: root, env: f.env, stdio: 'pipe' },
  );
  await expect(fs.stat(f.log)).rejects.toThrow();
  expect(await fs.readdir(f.state)).toEqual([]);
});
