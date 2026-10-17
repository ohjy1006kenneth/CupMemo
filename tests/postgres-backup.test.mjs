import { afterEach, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  symlink,
  copyFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const owned = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture(body = "process.stdout.write('fixture archive bytes');") {
  const dir = await mkdtemp(path.join(homedir(), '.cupmemo-backup-47-'));
  owned.push(dir);
  const backup = path.join(dir, 'backups');
  await mkdir(backup, { mode: 0o700 });
  const bin = path.join(dir, 'pg_dump');
  await writeFile(
    bin,
    `#!${process.execPath}\nif (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 17.9'); } else { ${body} }\n`,
    { mode: 0o700 },
  );
  return {
    dir,
    backup,
    bin,
    env: {
      BACKUP_DIR: backup,
      CUPMEMO_PG_DUMP_BIN: bin,
      CUPMEMO_DB_ENV: 'test',
      CUPMEMO_TEST_DATABASE: 'cupmemo_test_backup47',
      CUPMEMO_DATABASE_URL_TEST:
        'postgresql://fixture:fixture-secret@127.0.0.1:55499/cupmemo_test_backup47?sslmode=disable',
    },
  };
}
function launch(env, args = ['--run']) {
  const child = spawn(process.execPath, ['infrastructure/scripts/postgres-backup.mjs', ...args], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const done = new Promise((resolve) =>
    child.on('close', (code, signal) => resolve({ code, signal, output })),
  );
  return { child, done };
}
async function bundles(f) {
  return readdir(path.join(f.backup, 'cupmemo-backups-v1'));
}

test('explicit run transports a real child archive into a private atomic hashed bundle', async () => {
  const f = await fixture();
  const result = await launch(f.env).done;
  expect(result.code, result.output).toBe(0);
  const entries = await bundles(f);
  const id = entries.find((name) => name.startsWith('backup-'));
  expect(id).toBeTruthy();
  const bundle = path.join(f.backup, 'cupmemo-backups-v1', id);
  const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
  expect(manifest.version).toBe(1);
  expect(manifest.bytes).toBe(Buffer.byteLength('fixture archive bytes'));
  expect(manifest.sha256).toBe(createHash('sha256').update('fixture archive bytes').digest('hex'));
  expect(await readFile(path.join(bundle, manifest.archive), 'utf8')).toBe('fixture archive bytes');
  expect(manifest.targetFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.toolVersion).toBe('pg_dump (PostgreSQL) 17.9');
  expect(manifest.release.status).toMatch(/verified|unverified/);
  expect((await stat(bundle)).mode & 0o777).toBe(0o700);
  expect((await stat(path.join(bundle, manifest.archive))).mode & 0o777).toBe(0o600);
  expect((await stat(path.join(bundle, 'manifest.json'))).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(manifest) + result.output).not.toContain('fixture-secret');
  expect(entries.some((name) => name.startsWith('.partial-'))).toBe(false);
});

async function seedHistory(f, dates) {
  const ns = path.join(f.backup, 'cupmemo-backups-v1');
  const templateId = (await bundles(f)).find((n) => n.startsWith('backup-'));
  const template = path.join(ns, templateId);
  const source = JSON.parse(await readFile(path.join(template, 'manifest.json'), 'utf8'));
  const ids = [];
  for (const [index, captureTime] of dates.entries()) {
    const id = `backup-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const dest = path.join(ns, id);
    await mkdir(dest, { mode: 0o700 });
    await copyFile(path.join(template, source.archive), path.join(dest, source.archive));
    await chmod(path.join(dest, source.archive), 0o600);
    await writeFile(
      path.join(dest, 'manifest.json'),
      JSON.stringify({ ...source, id, captureTime }),
      { mode: 0o600 },
    );
    ids.push(id);
  }
  return ids;
}

test('retention unions distinct sparse UTC day/week/month buckets with deterministic ties', async () => {
  const { selectRetention } = await import('../infrastructure/scripts/postgres-backup.mjs');
  const records = [
    ['2026-04-01', 'apr'],
    ['2026-03-31', 'mar'],
    ['2026-02-28', 'feb'],
    ['2026-01-31', 'jan'],
    ['2025-12-31', 'dec'],
    ['2025-12-29', 'week1'],
    ['2025-12-28', 'week52'],
    ['2025-01-01', 'old'],
    ['2024-01-01', 'older'],
  ].map(([date, id]) => ({ id, captureTime: `${date}T12:00:00.000Z` }));
  expect(selectRetention(records).sort()).toEqual(
    ['apr', 'mar', 'feb', 'jan', 'dec', 'week1', 'week52'].sort(),
  );
  const same = [
    { id: 'a', captureTime: '2026-01-01T00:00:00.000Z' },
    { id: 'z', captureTime: '2026-01-01T00:00:00.000Z' },
  ];
  expect(selectRetention(same)).toEqual(['z']);
  expect(selectRetention([])).toEqual([]);
});

test('successful publication prunes only known eligible bundles and preserves unrelated destination files', async () => {
  const f = await fixture();
  expect((await launch(f.env).done).code).toBe(0);
  const dates = Array.from({ length: 16 }, (_, i) =>
    new Date(Date.UTC(2020, 0, 1 + i)).toISOString(),
  );
  const ids = await seedHistory(f, dates);
  await writeFile(path.join(f.backup, 'operator-note'), 'unrelated');
  const result = await launch(f.env).done;
  expect(result.code, result.output).toBe(0);
  expect((await bundles(f)).filter((n) => ids.includes(n)).length).toBeLessThan(ids.length);
  expect(await readFile(path.join(f.backup, 'operator-note'), 'utf8')).toBe('unrelated');
});

test.each([
  'checksum',
  'manifest',
  'symlink',
  'foreign',
  'partial',
  'mixed',
  'malformed',
  'timestamp',
  'permissions',
  'extra-file',
])('unsafe scan %s refuses all pruning after preserving new success', async (kind) => {
  const f = await fixture();
  expect((await launch(f.env).done).code).toBe(0);
  const ids = await seedHistory(
    f,
    Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, 0, i + 1)).toISOString()),
  );
  const ns = path.join(f.backup, 'cupmemo-backups-v1');
  const victim = path.join(ns, ids[0]);
  if (kind === 'checksum') await writeFile(path.join(victim, 'database.dump'), 'tampered');
  if (kind === 'manifest') await rm(path.join(victim, 'manifest.json'));
  if (kind === 'symlink') {
    await rm(path.join(victim, 'database.dump'));
    await symlink(f.bin, path.join(victim, 'database.dump'));
  }
  if (kind === 'foreign') await writeFile(path.join(ns, 'foreign'), 'do not touch');
  if (kind === 'partial') await mkdir(path.join(ns, '.partial-unknown'));
  if (kind === 'malformed') await writeFile(path.join(victim, 'manifest.json'), '{');
  if (kind === 'permissions') await chmod(path.join(victim, 'database.dump'), 0o644);
  if (kind === 'extra-file') await writeFile(path.join(victim, 'foreign'), 'preserve');
  if (kind === 'timestamp') {
    const p = path.join(victim, 'manifest.json');
    const m = JSON.parse(await readFile(p, 'utf8'));
    m.captureTime = 'invalid';
    await writeFile(p, JSON.stringify(m));
  }
  if (kind === 'mixed') {
    const p = path.join(victim, 'manifest.json');
    const m = JSON.parse(await readFile(p, 'utf8'));
    m.targetFingerprint = '0'.repeat(64);
    await writeFile(p, JSON.stringify(m));
  }
  const result = await launch(f.env).done;
  expect(result.code, result.output).toBe(1);
  expect(result.output).toContain('phase=retention');
  const entries = await bundles(f);
  expect(ids.every((id) => entries.includes(id))).toBe(true);
  expect(entries.filter((n) => n.startsWith('backup-')).length).toBe(14);
});

test.each([
  { PGOPTIONS: '-c search_path=secret' },
  { PGPASSFILE: '/untrusted' },
  { DATABASE_URL: '' },
  { CUPMEMO_DB_ENV: '' },
  { NODE_ENV: 'production' },
  { CUPMEMO_DATABASE_URL_TEST: 'postgresql://fixture:%ZZ@127.0.0.1/cupmemo_test_backup47' },
  {
    CUPMEMO_DATABASE_URL_TEST:
      'postgresql://fixture:pw@127.0.0.1/cupmemo_test_backup47?host=elsewhere',
  },
  {
    CUPMEMO_DATABASE_URL_TEST:
      'postgresql://fixture:pw@127.0.0.1/cupmemo_test_backup47?sslmode=prefer',
  },
  { CUPMEMO_DATABASE_URL_TEST: 'postgresql://fixture:pw@127.0.0.1/cupmemo_test_backup47#ignored' },
  {
    CUPMEMO_DATABASE_URL_PRODUCTION: 'postgresql://other:pw@127.0.0.1:55499/cupmemo_test_backup47',
  },
  { CUPMEMO_BACKUP_TIMEOUT_MS: '0' },
  { CUPMEMO_BACKUP_MAX_BYTES: 'Infinity' },
])(
  'configuration refuses ambiguous/invalid target or bound %# without files',
  async (overrides) => {
    const f = await fixture();
    const r = await launch({ ...f.env, ...overrides }).done;
    expect(r.code).toBe(1);
    expect(r.output).toBe('backup failed phase=configuration\n');
    expect(await readdir(f.backup)).toEqual([]);
  },
);

test.each([
  'repository',
  'relative',
  'trailing',
  'symlink',
  'ancestor',
  'public',
  'pgdata',
  'bin-symlink',
  'bin-writable',
])('filesystem refusal %s happens before lock/child', async (kind) => {
  const f = await fixture();
  const env = { ...f.env };
  if (kind === 'repository') env.BACKUP_DIR = root.slice(0, -1);
  if (kind === 'relative') env.BACKUP_DIR = 'relative';
  if (kind === 'trailing') env.BACKUP_DIR += '/';
  if (kind === 'symlink') {
    await symlink(f.backup, path.join(f.dir, 'link'));
    env.BACKUP_DIR = path.join(f.dir, 'link');
  }
  if (kind === 'ancestor') await chmod(f.dir, 0o770);
  if (kind === 'public') await chmod(f.backup, 0o750);
  if (kind === 'pgdata') env.POSTGRES_DATA_DIR = f.dir;
  if (kind === 'bin-symlink') {
    await symlink(f.bin, path.join(f.dir, 'tool-link'));
    env.CUPMEMO_PG_DUMP_BIN = path.join(f.dir, 'tool-link');
  }
  if (kind === 'bin-writable') await chmod(f.bin, 0o720);
  const r = await launch(env).done;
  expect(r.code).toBe(1);
  expect(r.output).toBe('backup failed phase=configuration\n');
  expect(await readdir(f.backup)).toEqual([]);
});

test('child gets literal whole-db compression args and only an allowlisted environment', async () => {
  const f = await fixture(`const e = process.env;
    if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['--format=custom','--compress=gzip:6','--no-password'])) process.exit(3);
    if (e.PGHOST !== '127.0.0.1' || e.PGPORT !== '55499' || e.PGDATABASE !== 'cupmemo_test_backup47' || e.PGUSER !== 'fixture' || e.PGPASSWORD !== 'fixture-secret' || e.PGSSLMODE !== 'disable' || e.PGCONNECT_TIMEOUT !== '10' || e.PGPASSFILE !== '/dev/null') process.exit(4);
    if (e.HOME || e.PATH || e.EXTRA_SECRET || e.CUPMEMO_DATABASE_URL_TEST || e.NODE_OPTIONS || e.PGSERVICE) process.exit(5);
    process.stdout.write('transport-only');`);
  const r = await launch({
    ...f.env,
    EXTRA_SECRET: 'never-forward',
    HOME: '/untrusted',
    PATH: '/untrusted',
  }).done;
  expect(r.code, r.output).toBe(0);
});

test.each(['exit', 'empty', 'timeout', 'overflow'])(
  'failed latest %s cleans its own partial and never prunes old success',
  async (kind) => {
    const f = await fixture();
    expect((await launch(f.env).done).code).toBe(0);
    await seedHistory(
      f,
      Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2000, 0, i + 1)).toISOString()),
    );
    const before = (await bundles(f)).sort();
    const body = {
      exit: "console.error('fixture-secret raw sql'); process.stdout.write('partial'); process.exit(9);",
      empty: '',
      timeout: "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      overflow: "process.stdout.write('x'.repeat(4096));",
    }[kind];
    await writeFile(
      f.bin,
      `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('pg_dump (PostgreSQL) 17.9'); else { ${body} }`,
    );
    const r = await launch({
      ...f.env,
      CUPMEMO_BACKUP_TIMEOUT_MS: '80',
      CUPMEMO_BACKUP_MAX_BYTES: '64',
    }).done;
    expect(r.code).toBe(1);
    expect(r.output).not.toContain('fixture-secret');
    expect((await bundles(f)).sort()).toEqual(before);
    expect(await readdir(f.backup)).not.toContain('.cupmemo-backup.lock');
  },
);

function waitStage(child, stage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture stage timeout')), 8000);
    child.stdout.on('data', (data) => {
      if (String(data).includes(`stage=${stage}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

test('concurrent lock refusal preserves lock, signal terminates/reaps actual child and cleans owned partial', async () => {
  const f = await fixture(
    "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'child.pid'), String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
  );
  const first = launch(f.env);
  await waitStage(first.child, 'dump');
  const second = await launch(f.env).done;
  expect(second.code).toBe(1);
  expect(second.output).toContain('phase=lock');
  expect(await readdir(f.backup)).toContain('.cupmemo-backup.lock');
  const childPid = Number(await readFile(path.join(f.dir, 'child.pid'), 'utf8'));
  expect(() => process.kill(childPid, 0)).not.toThrow();
  first.child.kill('SIGTERM');
  expect((await first.done).code).toBe(1);
  expect(() => process.kill(childPid, 0)).toThrow();
  expect((await bundles(f)).filter((n) => n !== 'scope.json')).toEqual([]);
  expect(await readdir(f.backup)).not.toContain('.cupmemo-backup.lock');
});

test('unknown stale lock is never automatically removed', async () => {
  const f = await fixture();
  await writeFile(path.join(f.backup, '.cupmemo-backup.lock'), 'operator evidence', {
    mode: 0o600,
  });
  const r = await launch(f.env).done;
  expect(r.code).toBe(1);
  expect(await readFile(path.join(f.backup, '.cupmemo-backup.lock'), 'utf8')).toBe(
    'operator evidence',
  );
});

test('import and missing explicit run remain inert', async () => {
  const f = await fixture();
  const r = await launch(f.env, []).done;
  expect(r.code).toBe(1);
  const imported = spawn(
    process.execPath,
    ['--input-type=module', '-e', "await import('./infrastructure/scripts/postgres-backup.mjs')"],
    { cwd: root, env: f.env, stdio: 'ignore' },
  );
  expect(await new Promise((resolve) => imported.on('close', resolve))).toBe(0);
  expect(await readdir(f.backup)).toEqual([]);
});

test('wrong pg_dump major is refused without archive', async () => {
  const f = await fixture();
  await writeFile(f.bin, `#!${process.execPath}\nconsole.log('pg_dump (PostgreSQL) 16.4');`);
  const r = await launch(f.env).done;
  expect(r.code).toBe(1);
  expect(r.output).toContain('phase=tool');
  expect(await bundles(f)).toEqual(['scope.json']);
});

test('distro PG17 tool suffix is normalized rather than logged as raw output', async () => {
  const f = await fixture();
  await writeFile(
    f.bin,
    `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('pg_dump (PostgreSQL) 17.9 (Debian 17.9-1)'); else process.stdout.write('fixture');`,
  );
  const r = await launch(f.env).done;
  expect(r.code, r.output).toBe(0);
  const id = (await bundles(f)).find((n) => n.startsWith('backup-'));
  const m = JSON.parse(
    await readFile(path.join(f.backup, 'cupmemo-backups-v1', id, 'manifest.json'), 'utf8'),
  );
  expect(m.toolVersion).toBe('pg_dump (PostgreSQL) 17.9');
});

test('schedule source stays dormant with UTC/no catch-up and hardened explicit operator substitutions', async () => {
  const service = await readFile(
    path.join(root, 'infrastructure/systemd/cupmemo-backup.service.in'),
    'utf8',
  );
  const timer = await readFile(
    path.join(root, 'infrastructure/systemd/cupmemo-backup.timer.in'),
    'utf8',
  );
  expect(service).toContain('Type=oneshot');
  expect(service).toContain('UMask=0077');
  expect(service).toContain('User=@CUPMEMO_OPERATOR_USER@');
  expect(service).toContain('EnvironmentFile=@CUPMEMO_BACKUP_ENV_FILE@');
  expect(service).toContain(
    '@CUPMEMO_NODE_BIN@ @CUPMEMO_RELEASE_DIR@/infrastructure/scripts/postgres-backup.mjs --run',
  );
  expect(service).toContain('Restart=no');
  expect(service).not.toContain('ExecStartPre=');
  expect(timer).toContain('OnCalendar=*-*-* 03:15:00 UTC');
  expect(timer).toContain('RandomizedDelaySec=10m');
  expect(timer).toContain('Persistent=false');
  expect(timer).not.toContain('OnBootSec=');
});

test('daily overlap does not hide older ISO-year weeks or calendar months', async () => {
  const { selectRetention } = await import('../infrastructure/scripts/postgres-backup.mjs');
  const dates = [
    '2026-01-07',
    '2026-01-06',
    '2026-01-05',
    '2026-01-04',
    '2026-01-03',
    '2026-01-02',
    '2026-01-01',
    '2025-12-31',
    '2025-12-29',
    '2025-12-28',
    '2025-12-21',
    '2025-12-14',
    '2025-11-30',
    '2025-10-31',
  ];
  const records = dates.map((id) => ({ id, captureTime: `${id}T00:00:00.000Z` }));
  expect(selectRetention(records).sort()).toEqual(
    [
      '2026-01-07',
      '2026-01-06',
      '2026-01-05',
      '2026-01-04',
      '2026-01-03',
      '2026-01-02',
      '2026-01-01',
      '2025-12-31',
      '2025-12-28',
      '2025-12-21',
      '2025-11-30',
    ].sort(),
  );
});

test.each(['host1,host2:5432', '127.0.0.1:0', 'host%2fsocket:5432'])(
  'refuses libpq target reinterpretation %s',
  async (authority) => {
    const f = await fixture();
    const env = {
      BACKUP_DIR: f.backup,
      CUPMEMO_PG_DUMP_BIN: f.bin,
      CUPMEMO_DB_ENV: 'production',
      CUPMEMO_DATABASE_URL_PRODUCTION: `postgresql://fixture:fixture-secret@${authority}/fixture_backup47`,
    };
    const r = await launch(env).done;
    expect(r.code).toBe(1);
    expect(r.output).toBe('backup failed phase=configuration\n');
    expect(await readdir(f.backup)).toEqual([]);
  },
);

test('scope refuses a second target before running a child or changing history', async () => {
  const f = await fixture();
  expect((await launch(f.env).done).code).toBe(0);
  const before = (await bundles(f)).sort();
  const r = await launch({
    ...f.env,
    CUPMEMO_DATABASE_URL_TEST: f.env.CUPMEMO_DATABASE_URL_TEST.replace('fixture:', 'other:'),
  }).done;
  expect(r.code).toBe(1);
  expect(r.output).toContain('phase=namespace');
  expect((await bundles(f)).sort()).toEqual(before);
});
