#!/usr/bin/env node
// Import is inert. Only exact --restore-test invokes the guarded mutating engine.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { resolveDatabaseConfig } from '../../packages/database/dist/index.js';
import { preflight, verifyRestored, connectTarget } from './postgres-restore-database.mjs';
import {
  sha256,
  refuse,
  exactKeys,
  hex,
  timestamp,
  parseExpectations,
} from './postgres-restore-oracle.mjs';

const checkout = fileURLToPath(new URL('../../', import.meta.url)).slice(0, -1);
const prefix = 'packages/database/drizzle/';
// Source identities from the reviewed three-migration profile, not DB-state proof.
const profile = Object.freeze({
  '0000_cupmemo_namespace.sql': '68bc8b1ad6f8ac655a6f545bd8434e266f267803c3d0baba490a736e38c51802',
  '0001_mixed_liz_osborn.sql': '493b7b1de2e3abae593ac646aad4f9d8e1d03663f8a0b5313a66d209afa6b600',
  '0002_needy_supernaut.sql': '1eae2c85069009d4afc70db31d709186bcfdbfa2818acad94ba2921036eabaae',
  'meta/0000_snapshot.json': '4f69512fffd5d99d365621b48b22832b8a8d219207a7a7ff657f146db30955ab',
  'meta/0001_snapshot.json': 'f9793c05ee9c6e0e00b951afea4827b415105a8e5120f80022da45211ed1a647',
  'meta/0002_snapshot.json': '6f5111f75e7f4984283e88a5cc75eaf1fc23a95226345152a90462bada742dd1',
  'meta/_journal.json': '4c8d5aed87a23e48fe18fb8420d19496a9b13cd5c9c9ca7c0bec6634db3b3991',
});
const within = (a, b) => a === b || a.startsWith(`${b}/`);
function absolute(s) {
  if (
    typeof s !== 'string' ||
    !path.isAbsolute(s) ||
    path.normalize(s) !== s ||
    s.endsWith('/') ||
    s.includes('\0')
  )
    refuse();
  return s;
}
function trusted(s, { directory = false, privateMode = false, executable = false } = {}) {
  absolute(s);
  let cursor = '/';
  for (const part of s.slice(1).split('/')) {
    cursor = path.join(cursor, part);
    const st = fs.lstatSync(cursor);
    const last = cursor === s;
    if (
      st.isSymbolicLink() ||
      (st.uid !== 0 && st.uid !== process.getuid()) ||
      st.mode & 0o022 ||
      st.mode & 0o7000
    )
      refuse();
    if ((!last || directory) && !st.isDirectory()) refuse();
    if (last && privateMode && (st.uid !== process.getuid() || st.mode & 0o077)) refuse();
    if (last && executable && (!st.isFile() || st.nlink !== 1 || !(st.mode & 0o111))) refuse();
  }
  return fs.lstatSync(s);
}
function regular(s, max = Infinity) {
  const st = trusted(s, { privateMode: true });
  if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o777) !== 0o600 || st.size > max) refuse();
  return st;
}
function readPrivate(s, max) {
  regular(s, max);
  const fd = fs.openSync(s, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (st.size > max || st.nlink !== 1) refuse();
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function git(dir, args) {
  return execFileSync(
    '/usr/bin/git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args],
    {
      cwd: dir,
      env: {
        PATH: '/usr/bin:/bin',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_NO_REPLACE_OBJECTS: '1',
      },
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1048576,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  ).trim();
}
function configuration(env) {
  if (
    Object.keys(env).some((k) => k.startsWith('PG')) ||
    env.DATABASE_URL ||
    env.CUPMEMO_DB_ENV !== 'test' ||
    env.NODE_ENV === 'production' ||
    env.CUPMEMO_DATABASE_URL_PRODUCTION ||
    env.CUPMEMO_DATABASE_URL_DEVELOPMENT
  )
    refuse();
  const config = resolveDatabaseConfig(env);
  const u = new URL(config.databaseUrl);
  const username = decodeURIComponent(u.username),
    password = decodeURIComponent(u.password);
  const tls = u.searchParams.get('sslmode') ?? 'require';
  if (
    !username ||
    !password ||
    [...(username + password)].some((c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127) ||
    u.hash ||
    !['disable', 'require', 'verify-ca', 'verify-full'].includes(tls) ||
    env.CUPMEMO_RESTORE_CONFIRM_DATABASE !== config.databaseName
  )
    refuse();
  const host = config.hostname.replace(/^\[|\]$/g, '');
  const state = absolute(env.CUPMEMO_RESTORE_STATE_DIR),
    bundle = absolute(env.CUPMEMO_RESTORE_BUNDLE_DIR),
    oracleFile = absolute(env.CUPMEMO_RESTORE_EXPECTATIONS_FILE),
    release = absolute(env.CUPMEMO_RESTORE_RELEASE_DIR),
    bin = absolute(env.CUPMEMO_PG_RESTORE_BIN);
  const common = git(checkout, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const main = path.dirname(common);
  for (const p of [state, bundle, oracleFile]) {
    if (within(p, checkout) || within(p, main) || within(p, release)) refuse();
    if (
      env.POSTGRES_DATA_DIR &&
      (within(p, absolute(env.POSTGRES_DATA_DIR)) || within(env.POSTGRES_DATA_DIR, p))
    )
      refuse();
    trusted(p, { directory: p !== oracleFile, privateMode: true });
  }
  if (
    within(state, bundle) ||
    within(bundle, state) ||
    within(oracleFile, state) ||
    within(oracleFile, bundle)
  )
    refuse();
  trusted(release, { directory: true });
  trusted(bin, { executable: true });
  // Refuse shell scripts, distro shims and symlink wrappers. Version/provenance
  // still require separately trusted operator custody; ELF is not authentication.
  const fd = fs.openSync(bin, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    if (!magic.equals(Buffer.from([127, 69, 76, 70]))) refuse();
  } finally {
    fs.closeSync(fd);
  }
  const timeoutText = env.CUPMEMO_RESTORE_TIMEOUT_MS ?? '1800000';
  if (
    !/^[1-9][0-9]*$/.test(timeoutText) ||
    !Number.isSafeInteger(Number(timeoutText)) ||
    Number(timeoutText) > 1800000
  )
    refuse();
  if (
    !hex(env.CUPMEMO_RESTORE_EXPECTED_SHA256, 64) ||
    !hex(env.CUPMEMO_RESTORE_EXPECTATIONS_SHA256, 64)
  )
    refuse();
  // Lock key excludes role/password/TLS: different cooperating roles for the same
  // configured endpoint/database must NOT acquire distinct locks.
  // All accepted loopback spellings conservatively share one namespace: aliases
  // must not let two roles race the same target. Distinct loopback servers at the
  // same port/name can therefore contend, which is a safe refusal.
  const targetFingerprint = sha256(
    JSON.stringify(['test', 'loopback', config.port, config.databaseName]),
  );
  return {
    config,
    state,
    bundle,
    oracleFile,
    release,
    bin,
    targetFingerprint,
    timeout: Number(timeoutText),
    expected: { database: config.databaseName, username, address: host, port: config.port },
    childEnv: {
      PGHOST: host,
      PGPORT: String(config.port),
      PGDATABASE: config.databaseName,
      PGUSER: username,
      PGPASSWORD: password,
      PGSSLMODE: tls,
      PGCONNECT_TIMEOUT: '10',
      PGPASSFILE: '/dev/null',
      PGAPPNAME: 'cupmemo-restore-test',
      LC_ALL: 'C',
    },
  };
}
export function validateRelease(c, r) {
  exactKeys(r, ['status', 'commit', 'tree', 'migrationFiles', 'databaseMigrationState']);
  if (
    r.status !== 'verified' ||
    !hex(r.commit, 40) ||
    !hex(r.tree, 40) ||
    r.databaseMigrationState !== 'unverified' ||
    !Array.isArray(r.migrationFiles)
  )
    refuse();
  if (
    git(c.release, ['rev-parse', '--show-toplevel']) !== c.release ||
    git(c.release, ['rev-parse', 'HEAD']) !== r.commit ||
    git(c.release, ['rev-parse', 'HEAD^{tree}']) !== r.tree ||
    git(c.release, ['status', '--porcelain', '--untracked-files=normal'])
  )
    refuse();
  const expected = Object.keys(profile)
    .map((s) => prefix + s)
    .sort();
  const files = git(c.release, ['ls-files', 'packages/database/drizzle']).split('\n').sort();
  // Git cleanliness omits ignored files. Inspect these two bounded directories
  // too, so an ignored extra migration cannot wait until AFTER restore to fail.
  const migrations = path.resolve(c.release, prefix);
  for (const [dir, entries] of [
    [migrations, [...Object.keys(profile).filter((name) => !name.includes('/')), 'meta']],
    [
      path.join(migrations, 'meta'),
      Object.keys(profile)
        .filter((name) => name.startsWith('meta/'))
        .map((name) => name.slice(5)),
    ],
  ]) {
    trusted(dir, { directory: true });
    if (JSON.stringify(fs.readdirSync(dir).sort()) !== JSON.stringify(entries.sort())) refuse();
  }
  if (
    JSON.stringify(files) !== JSON.stringify(expected) ||
    r.migrationFiles.length !== expected.length
  )
    refuse();
  const seen = new Set();
  for (const f of r.migrationFiles) {
    exactKeys(f, ['name', 'sha256']);
    if (
      !expected.includes(f.name) ||
      seen.has(f.name) ||
      f.sha256 !== profile[f.name.slice(prefix.length)]
    )
      refuse();
    seen.add(f.name);
    const p = path.join(c.release, f.name);
    const st = trusted(p);
    if (!st.isFile() || st.nlink !== 1 || st.size > 1048576) refuse();
    const bytes = fs.readFileSync(p);
    if (
      sha256(bytes) !== f.sha256 ||
      sha256(
        Buffer.from(
          execFileSync('/usr/bin/git', ['show', `${r.commit}:${f.name}`], {
            cwd: c.release,
            env: {
              PATH: '/usr/bin:/bin',
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: '/dev/null',
              GIT_NO_REPLACE_OBJECTS: '1',
            },
            timeout: 5000,
            maxBuffer: 1048576,
            stdio: ['ignore', 'pipe', 'ignore'],
          }),
        ),
      ) !== f.sha256
    )
      refuse();
  }
}
function openArchive(c, m) {
  const file = path.join(c.bundle, 'database.dump');
  const st = regular(file);
  if (st.size !== m.bytes) refuse();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const hash = createHash('sha256');
  const buf = Buffer.alloc(65536);
  let pos = 0,
    n;
  try {
    const current = fs.fstatSync(fd);
    if (current.ino !== st.ino || current.dev !== st.dev || current.size !== m.bytes) refuse();
    // Positional reads do not advance stdin's descriptor offset.
    while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
      hash.update(buf.subarray(0, n));
      pos += n;
    }
    if (pos !== m.bytes || hash.digest('hex') !== m.sha256) refuse();
    return fd;
  } catch {
    fs.closeSync(fd);
    refuse();
  }
}
function bundle(c, env) {
  if (
    (fs.lstatSync(c.bundle).mode & 0o777) !== 0o700 ||
    fs.readdirSync(c.bundle).sort().join(',') !== 'database.dump,manifest.json'
  )
    refuse();
  const m = JSON.parse(readPrivate(path.join(c.bundle, 'manifest.json'), 1048576).toString('utf8'));
  exactKeys(m, [
    'version',
    'id',
    'archive',
    'sha256',
    'bytes',
    'captureTime',
    'toolVersion',
    'targetFingerprint',
    'release',
  ]);
  if (
    m.version !== 1 ||
    m.id !== path.basename(c.bundle) ||
    !/^backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.id) ||
    m.archive !== 'database.dump' ||
    m.sha256 !== env.CUPMEMO_RESTORE_EXPECTED_SHA256 ||
    !hex(m.sha256, 64) ||
    !hex(m.targetFingerprint, 64) ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes <= 0 ||
    !/^pg_dump \(PostgreSQL\) 17\.\d+$/.test(m.toolVersion)
  )
    refuse();
  timestamp(m.captureTime);
  validateRelease(c, m.release);
  const fd = openArchive(c, m);
  fs.closeSync(fd);
  const oracle = parseExpectations(
    readPrivate(c.oracleFile, 262144),
    env.CUPMEMO_RESTORE_EXPECTATIONS_SHA256,
    { archiveSha256: m.sha256, releaseCommit: m.release.commit, releaseTree: m.release.tree },
  );
  return { m, oracle };
}
function child(bin, args, env, { fd, timeout, signal, maximum = 16777216 }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('restore interrupted'));
      return;
    }
    const p = spawn(bin, args, { env, shell: false, stdio: [fd ?? 'ignore', 'pipe', 'ignore'] });
    let failed = false,
      size = 0,
      killer;
    const chunks = [];
    const stop = () => {
      failed = true;
      p.kill('SIGTERM');
      killer ??= setTimeout(() => p.kill('SIGKILL'), 1000);
    };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    p.stdout.on('data', (data) => {
      size += data.length;
      if (size > maximum) {
        stop();
        return;
      }
      if (!failed) chunks.push(data);
    });
    p.on('error', () => {
      failed = true;
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      signal?.removeEventListener('abort', stop);
      if (failed || code !== 0) reject(new Error('restore child failed'));
      else resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
  });
}
function privateWrite(file, value) {
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function syncDir(dir) {
  const fd = fs.openSync(
    dir,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function publishReceipt(state, receipt, failed = false) {
  const id = randomUUID(),
    temporary = path.join(state, `.receipt-${id}.partial`),
    final = path.join(state, `restore-${failed ? 'failed-' : ''}${id}.json`);
  privateWrite(temporary, receipt);
  if (fs.existsSync(final)) refuse();
  fs.renameSync(temporary, final);
  syncDir(state);
}
export async function runRestore(env, { signal, connect = connectTarget, report = () => {} } = {}) {
  const start = Date.now();
  let phase = 'configuration',
    locked = false,
    lock,
    c,
    connection,
    mutating = false,
    receipt,
    published = false,
    validated,
    failure;
  const phases = [];
  const checked = (stage) => {
    if (signal?.aborted) refuse();
    phases.push(stage);
  };
  try {
    c = configuration(env);
    phase = 'lock';
    lock = path.join(c.state, `.restore-${c.targetFingerprint}.lock`);
    privateWrite(lock, { version: 1, pid: process.pid });
    locked = true;
    syncDir(c.state);
    phase = 'inputs';
    report(phase);
    const { m, oracle } = bundle(c, env);
    validated = {
      archiveSha256: m.sha256,
      expectationsSha256: env.CUPMEMO_RESTORE_EXPECTATIONS_SHA256,
      releaseCommit: m.release.commit,
      releaseTree: m.release.tree,
    };
    checked('inputs');
    phase = 'tool';
    report(phase);
    const version = await child(
      c.bin,
      ['--version'],
      { LC_ALL: 'C' },
      { timeout: 5000, signal, maximum: 256 },
    );
    if (!/^pg_restore \(PostgreSQL\) 17\.\d+(?: [^\r\n]{1,128})?$/.test(version)) refuse();
    const listFd = openArchive(c, m);
    try {
      await child(
        c.bin,
        ['--list'],
        { LC_ALL: 'C' },
        { fd: listFd, timeout: Math.min(c.timeout, 30000), signal },
      );
    } finally {
      fs.closeSync(listFd);
    }
    checked('archive_readability');
    phase = 'preflight';
    report(phase);
    connection = await connect(c.config);
    await preflight(connection.query, c.expected);
    await connection.close();
    connection = undefined;
    checked('empty_target');
    // Revalidate source custody immediately before mutation. This still cannot
    // exclude non-cooperating writers; operator-exclusive control is mandatory.
    validateRelease(c, m.release);
    const restoreFd = openArchive(c, m);
    try {
      phase = 'restore';
      report(phase);
      if (signal?.aborted) refuse();
      mutating = true;
      await child(
        c.bin,
        [
          '--single-transaction',
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--no-password',
          `--dbname=${c.config.databaseName}`,
        ],
        c.childEnv,
        { fd: restoreFd, timeout: c.timeout, signal },
      );
    } finally {
      fs.closeSync(restoreFd);
    }
    checked('restore_exit_zero');
    phase = 'verification';
    report(phase);
    connection = await connect(c.config);
    const counts = await verifyRestored(
      connection.query,
      c.expected,
      oracle,
      path.join(c.release, prefix),
    );
    await connection.close();
    connection = undefined;
    checked('catalog_history_counts_relationships');
    receipt = {
      version: 1,
      status: 'structural_checks_passed',
      recoveryVerified: false,
      applicationChecks: 'unperformed',
      archiveSha256: m.sha256,
      expectationsSha256: env.CUPMEMO_RESTORE_EXPECTATIONS_SHA256,
      catalogSha256: oracle.catalogSha256,
      releaseCommit: m.release.commit,
      releaseTree: m.release.tree,
      targetFingerprint: c.targetFingerprint,
      durationMs: Date.now() - start,
      phases: [...phases],
      ...counts,
    };
    phase = 'receipt';
    report(phase);
    publishReceipt(c.state, receipt);
    published = true;
  } catch {
    // Unknown restore/postcheck outcomes are NEVER reset, cleaned or auto-retried.
    // Keep the exact lock after mutation begins for explicit operator reconciliation.
    if (locked && validated) {
      try {
        publishReceipt(
          c.state,
          {
            version: 1,
            status: 'failed',
            recoveryVerified: false,
            applicationChecks: 'unperformed',
            phase,
            outcome: mutating ? 'unknown_preserved' : 'not_started',
            ...validated,
            targetFingerprint: c.targetFingerprint,
            durationMs: Date.now() - start,
            phases: [...phases],
          },
          true,
        );
      } catch {
        /* Preserve lock/partials if evidence storage itself failed. */
      }
    }
    failure = new Error(
      `restore failed phase=${phase} outcome=${mutating ? 'unknown_preserved' : 'not_started'}`,
    );
  } finally {
    try {
      if (connection) await connection.close();
      if (locked && (!mutating || published)) {
        fs.unlinkSync(lock);
        syncDir(c.state);
      }
    } catch {
      failure = new Error('restore failed phase=cleanup outcome=unknown_preserved');
    }
  }
  if (failure) throw failure;
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--restore-test') {
    process.stderr.write('restore refused: explicit --restore-test required\n');
    process.exitCode = 1;
  } else {
    const controller = new globalThis.AbortController();
    const abort = () => controller.abort();
    process.on('SIGINT', abort);
    process.on('SIGTERM', abort);
    try {
      await runRestore(process.env, {
        signal: controller.signal,
        report: (stage) => process.stdout.write(`restore stage=${stage}\n`),
      });
      process.stdout.write('restore status=structural_checks_passed recoveryVerified=false\n');
    } catch (error) {
      process.stderr.write(
        `${/^restore failed phase=/.test(error.message) ? error.message : 'restore failed phase=cleanup outcome=unknown_preserved'}\n`,
      );
      process.exitCode = 1;
    } finally {
      process.off('SIGINT', abort);
      process.off('SIGTERM', abort);
    }
  }
}
