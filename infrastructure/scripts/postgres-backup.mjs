#!/usr/bin/env node
// Importing this module never connects, creates files, or starts a child.
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { isIP } from 'node:net';
import { resolveDatabaseConfig } from '../../packages/database/dist/index.js';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
const namespaceName = 'cupmemo-backups-v1';
const archiveName = 'database.dump';
const manifestName = 'manifest.json';
const gitEnv = {
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0',
};
const sha = (data) => createHash('sha256').update(data).digest('hex');
const refuse = () => {
  throw new Error('backup refused');
};
const within = (child, parent) => child === parent || child.startsWith(`${parent}${path.sep}`);

function absolute(value) {
  if (!value || !path.isAbsolute(value) || path.normalize(value) !== value || value.endsWith('/'))
    refuse();
  return value;
}

// This is a trusted-operator boundary: root/operator must retain exclusive custody
// of the checked ancestry for the entire job (no hostile same-UID writer).
function trustedPath(value, { directory = false, privateMode = false, executable = false } = {}) {
  absolute(value);
  let cursor = '/';
  for (const part of value.slice(1).split('/')) {
    cursor = path.join(cursor, part);
    const s = fs.lstatSync(cursor);
    const last = cursor === value;
    if (s.isSymbolicLink() || (s.uid !== 0 && s.uid !== process.getuid()) || s.mode & 0o022)
      refuse();
    if ((!last || directory) && !s.isDirectory()) refuse();
    if (last && privateMode && (s.uid !== process.getuid() || s.mode & 0o077)) refuse();
    if (last && executable && (!s.isFile() || !(s.mode & 0o111))) refuse();
  }
}

function bounded(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) refuse();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > maximum) refuse();
  return n;
}

function configuration(env) {
  if (Object.keys(env).some((k) => /^PG/.test(k) || k === 'DATABASE_URL')) refuse();
  const config = resolveDatabaseConfig(env);
  const url = new URL(config.databaseUrl);
  const host = config.hostname.replace(/^\[|\]$/g, '');
  // libpq accepts comma-separated hosts/socket paths. A URL authority must stay
  // one literal validated host, never acquire libpq's separate list semantics.
  if (
    (!isIP(host) && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  )
    refuse();
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const tls = url.searchParams.get('sslmode') ?? 'require';
  if (
    !['disable', 'require', 'verify-ca', 'verify-full'].includes(tls) ||
    url.hash ||
    !username ||
    !password ||
    [...(username + password)].some(
      (char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127,
    ) ||
    !/^[a-zA-Z0-9_.-]+$/.test(config.databaseName)
  )
    refuse();
  const destination = absolute(env.BACKUP_DIR);
  trustedPath(destination, { directory: true, privateMode: true });
  let mainCheckout;
  try {
    mainCheckout = path.dirname(
      execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: checkout,
        env: gitEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }).trim(),
    );
  } catch {
    refuse();
  }
  if (
    within(destination, checkout.slice(0, -1)) ||
    within(destination, mainCheckout) ||
    (env.POSTGRES_DATA_DIR &&
      (within(destination, absolute(env.POSTGRES_DATA_DIR)) ||
        within(env.POSTGRES_DATA_DIR, destination)))
  )
    refuse();
  trustedPath(env.CUPMEMO_PG_DUMP_BIN, { executable: true });
  const targetFingerprint = sha(
    JSON.stringify([config.environment, host, config.port, config.databaseName, username, tls]),
  );
  return {
    destination,
    bin: env.CUPMEMO_PG_DUMP_BIN,
    targetFingerprint,
    timeout: bounded(env.CUPMEMO_BACKUP_TIMEOUT_MS, 1800000, 1800000),
    maxBytes: bounded(env.CUPMEMO_BACKUP_MAX_BYTES, 68719476736, 68719476736),
    childEnv: {
      PGHOST: host,
      PGPORT: String(config.port),
      PGDATABASE: config.databaseName,
      PGUSER: username,
      PGPASSWORD: password,
      PGSSLMODE: tls,
      PGCONNECT_TIMEOUT: '10',
      PGPASSFILE: '/dev/null',
      PGAPPNAME: 'cupmemo-backup',
      LC_ALL: 'C',
    },
  };
}

function runChild(bin, args, env, { timeout, maxBytes, fd, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('backup interrupted'));
      return;
    }
    const child = spawn(bin, args, { env, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let failed = false;
    let size = 0;
    const chunks = [];
    let killer;
    const stop = () => {
      failed = true;
      child.kill('SIGTERM');
      killer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (data) => {
      if (failed) return;
      size += data.length;
      if (size > maxBytes) {
        stop();
        return;
      }
      try {
        if (fd === undefined) chunks.push(data);
        else {
          let offset = 0;
          while (offset < data.length) offset += fs.writeSync(fd, data, offset);
        }
      } catch {
        stop();
      }
    });
    child.on('error', () => {
      failed = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(killer);
      signal?.removeEventListener('abort', stop);
      if (failed || code !== 0) reject(new Error('backup child failed'));
      else resolve(Buffer.concat(chunks).toString('utf8').trim());
    });
  });
}

function writePrivate(file, value) {
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
function syncDirectory(dir) {
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
function releaseIdentity() {
  // Offline checkout identity, not a claim about the connected DB's migrations.
  try {
    const run = (args) =>
      execFileSync('git', args, {
        cwd: checkout,
        env: gitEnv,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    const commit = run(['rev-parse', 'HEAD']);
    const tree = run(['rev-parse', 'HEAD^{tree}']);
    if (run(['status', '--porcelain', '--untracked-files=normal'])) return { status: 'unverified' };
    const migrations = run(['ls-files', 'packages/database/drizzle']).split('\n').filter(Boolean);
    return {
      status: 'verified',
      commit,
      tree,
      migrationFiles: migrations.map((name) => ({
        name,
        sha256: sha(fs.readFileSync(path.join(checkout, name))),
      })),
      databaseMigrationState: 'unverified',
    };
  } catch {
    return { status: 'unverified' };
  }
}

async function digest(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = fs.createReadStream(file, {
    flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  });
  for await (const chunk of stream) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

function isoWeek(time) {
  const d = new Date(time.slice(0, 10));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

export function selectRetention(records) {
  const ordered = [...records].sort(
    (a, b) => b.captureTime.localeCompare(a.captureTime) || b.id.localeCompare(a.id),
  );
  const keep = new Set();
  for (const [limit, bucket] of [
    [7, (r) => r.captureTime.slice(0, 10)],
    [4, (r) => isoWeek(r.captureTime)],
    [3, (r) => r.captureTime.slice(0, 7)],
  ]) {
    const seen = new Set();
    for (const r of ordered) {
      const key = bucket(r);
      if (!seen.has(key) && seen.size < limit) {
        seen.add(key);
        keep.add(r.id);
      }
    }
  }
  if (ordered.length) keep.add(ordered[0].id);
  return [...keep];
}

function regularPrivate(file, maximum = Infinity) {
  trustedPath(file, { privateMode: true });
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || s.size > maximum) refuse();
  return s;
}

async function scanBundles(namespace, targetFingerprint) {
  const records = [];
  for (const id of fs.readdirSync(namespace)) {
    if (id === 'scope.json') continue;
    if (!/^backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) refuse();
    const dir = path.join(namespace, id);
    trustedPath(dir, { directory: true, privateMode: true });
    if (
      (fs.lstatSync(dir).mode & 0o777) !== 0o700 ||
      fs.readdirSync(dir).sort().join(',') !== [archiveName, manifestName].sort().join(',')
    )
      refuse();
    const file = path.join(dir, manifestName);
    regularPrivate(file, 1048576);
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (
      m.version !== 1 ||
      m.id !== id ||
      m.archive !== archiveName ||
      m.targetFingerprint !== targetFingerprint ||
      !/^[0-9a-f]{64}$/.test(m.sha256) ||
      !Number.isSafeInteger(m.bytes) ||
      m.bytes <= 0 ||
      typeof m.captureTime !== 'string' ||
      new Date(m.captureTime).toISOString() !== m.captureTime ||
      !/^pg_dump \(PostgreSQL\) 17\.\d+$/.test(m.toolVersion) ||
      !['verified', 'unverified'].includes(m.release?.status)
    )
      refuse();
    const archive = path.join(dir, archiveName);
    if (regularPrivate(archive).size !== m.bytes) refuse();
    const actual = await digest(archive);
    if (actual.bytes !== m.bytes || actual.sha256 !== m.sha256) refuse();
    records.push(m);
  }
  return records;
}

async function prune(namespace, targetFingerprint, signal) {
  const records = await scanBundles(namespace, targetFingerprint);
  const keep = new Set(selectRetention(records));
  // No mutation until the ENTIRE namespace has passed validation. Filesystem
  // custody must remain exclusive; the lock excludes all cooperating runners.
  if (signal?.aborted) refuse();
  let count = 0;
  for (const r of records) {
    if (keep.has(r.id)) continue;
    if (signal?.aborted) refuse();
    const dir = path.join(namespace, r.id);
    fs.unlinkSync(path.join(dir, archiveName));
    fs.unlinkSync(path.join(dir, manifestName));
    fs.rmdirSync(dir);
    count++;
  }
  syncDirectory(namespace);
  return count;
}

export async function runBackup(env, { signal, report = () => {} } = {}) {
  let phase = 'configuration';
  let lock;
  let partial;
  let archiveFd;
  let locked = false;
  let result;
  let failure;
  try {
    const c = configuration(env);
    phase = 'lock';
    report(phase);
    lock = path.join(c.destination, '.cupmemo-backup.lock');
    writePrivate(lock, { version: 1, pid: process.pid });
    locked = true;
    const namespace = path.join(c.destination, namespaceName);
    phase = 'namespace';
    report(phase);
    if (!fs.existsSync(namespace)) {
      fs.mkdirSync(namespace, { mode: 0o700 });
      writePrivate(path.join(namespace, 'scope.json'), {
        version: 1,
        targetFingerprint: c.targetFingerprint,
      });
      syncDirectory(namespace);
    }
    trustedPath(namespace, { directory: true, privateMode: true });
    const scopeFile = path.join(namespace, 'scope.json');
    regularPrivate(scopeFile, 1024);
    const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
    if (
      Object.keys(scope).sort().join(',') !== 'targetFingerprint,version' ||
      scope.version !== 1 ||
      scope.targetFingerprint !== c.targetFingerprint
    )
      refuse();
    phase = 'tool';
    report(phase);
    const versionOutput = await runChild(
      c.bin,
      ['--version'],
      { LC_ALL: 'C' },
      { timeout: 5000, maxBytes: 256, signal },
    );
    const versionMatch = /^pg_dump \(PostgreSQL\) (17\.\d+)(?: [^\r\n]{1,128})?$/.exec(
      versionOutput,
    );
    if (!versionMatch) refuse();
    const toolVersion = `pg_dump (PostgreSQL) ${versionMatch[1]}`;
    const captureTime = new Date().toISOString();
    const id = `backup-${randomUUID()}`;
    const candidatePartial = path.join(namespace, `.partial-${id}`);
    fs.mkdirSync(candidatePartial, { mode: 0o700 });
    partial = candidatePartial;
    const archive = path.join(partial, archiveName);
    archiveFd = fs.openSync(
      archive,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    phase = 'dump';
    report(phase);
    await runChild(c.bin, ['--format=custom', '--compress=gzip:6', '--no-password'], c.childEnv, {
      timeout: c.timeout,
      maxBytes: c.maxBytes,
      fd: archiveFd,
      signal,
    });
    fs.fsyncSync(archiveFd);
    fs.closeSync(archiveFd);
    archiveFd = undefined;
    phase = 'publication';
    report(phase);
    if (signal?.aborted) refuse();
    const integrity = await digest(archive);
    if (!integrity.bytes) refuse();
    const manifest = {
      version: 1,
      id,
      archive: archiveName,
      ...integrity,
      captureTime,
      toolVersion,
      targetFingerprint: c.targetFingerprint,
      release: releaseIdentity(),
    };
    writePrivate(path.join(partial, manifestName), manifest);
    syncDirectory(partial);
    const published = path.join(namespace, id);
    // UUID collision must never overwrite even an empty existing directory.
    if (fs.existsSync(published)) refuse();
    fs.renameSync(partial, published);
    partial = undefined;
    syncDirectory(namespace);
    report('published');
    phase = 'retention';
    report(phase);
    const pruned = await prune(namespace, c.targetFingerprint, signal);
    result = { published: id, pruned };
  } catch {
    failure = new Error(`backup failed phase=${phase}`);
  } finally {
    try {
      if (archiveFd !== undefined) fs.closeSync(archiveFd);
      // Exact invocation-owned files only; never recursively traverse a directory.
      if (partial) {
        for (const name of [archiveName, manifestName]) {
          try {
            fs.unlinkSync(path.join(partial, name));
          } catch {
            /* preserve unknown state */
          }
        }
        try {
          fs.rmdirSync(partial);
        } catch {
          /* preserve unknown state */
        }
      }
      if (locked) fs.unlinkSync(lock);
    } catch {
      failure = new Error('backup failed phase=cleanup');
    }
  }
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    process.stderr.write('backup refused: explicit --run required\n');
    process.exitCode = 1;
  } else {
    const controller = new globalThis.AbortController();
    const abort = () => controller.abort();
    process.on('SIGTERM', abort);
    process.on('SIGINT', abort);
    try {
      const result = await runBackup(process.env, {
        signal: controller.signal,
        report: (stage) => process.stdout.write(`backup stage=${stage}\n`),
      });
      process.stdout.write(`backup success pruned=${result.pruned}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } finally {
      process.off('SIGTERM', abort);
      process.off('SIGINT', abort);
    }
  }
}
