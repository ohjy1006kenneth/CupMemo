import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { runGuarded, verifyPostgresHdd } from '../infrastructure/scripts/postgres-hdd-guard.mjs';

const script = fileURLToPath(
  new URL('../infrastructure/scripts/postgres-hdd-guard.mjs', import.meta.url),
);
import { setTimeout, clearTimeout } from 'node:timers';

const uuid = '68391fd3-3c92-4cfe-82db-47a5e6abb2ee';
let base;
let mount;
let data;
let env;
let device;

function deviceId(dev) {
  return `${((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)}:${(dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)}`;
}

function wrongDevice(matchingDevice) {
  return matchingDevice === '0:0' ? '0:1' : '0:0';
}

function fixtureProbe(_target, changes = {}) {
  // Injected mount-table fixture, NOT an observation of an actual mounted HDD.
  return JSON.stringify({
    filesystems: [
      { target: mount, uuid, fstype: 'ext4', 'maj:min': device, fsroot: '/', ...changes },
    ],
  });
}

beforeEach(() => {
  // Home is SSD on the authorized host; /tmp may instead be tmpfs.
  base = fs.mkdtempSync(path.join(os.homedir(), 'cupmemo11-'));
  mount = path.join(base, 'mount');
  data = path.join(mount, 'postgres');
  fs.mkdirSync(mount, { mode: 0o755 });
  fs.mkdirSync(data, { mode: 0o700 });
  device = deviceId(fs.lstatSync(mount, { bigint: true }).dev);
  env = {
    POSTGRES_HDD_MOUNT: mount,
    POSTGRES_HDD_UUID: uuid,
    POSTGRES_DATA_DIR: data,
    POSTGRES_DATA_UID: String(process.getuid()),
  };
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

test.each(['POSTGRES_HDD_MOUNT', 'POSTGRES_HDD_UUID', 'POSTGRES_DATA_DIR', 'POSTGRES_DATA_UID'])(
  'requires explicit %s',
  (key) => {
    delete env[key];
    expect(() => verifyPostgresHdd(env)).toThrow('HDD guard: invalid configuration');
  },
);

test.each(['0', '-1', '1.2', '01', ' 1000', '4294967295', '999999999999999999999'])(
  'refuses invalid owner UID %j',
  (value) => {
    env.POSTGRES_DATA_UID = value;
    expect(() => verifyPostgresHdd(env)).toThrow();
  },
);

test.each(['', 'not-uuid', '68391fd3', '68391FD3-3c92-4cfe-82db-47a5e6abb2ee'])(
  'refuses malformed UUID %j',
  (value) => {
    env.POSTGRES_HDD_UUID = value;
    expect(() => verifyPostgresHdd(env)).toThrow();
  },
);

test.each([
  '/',
  'relative',
  'mount/',
  '/mount/../escape',
  '/mount//data',
  '/mount/./data',
  '/mount\0data',
])('refuses malformed mount path %j', (value) => {
  env.POSTGRES_HDD_MOUNT = value;
  expect(() => verifyPostgresHdd(env)).toThrow();
});

test.each(['root', 'relative', 'sibling', 'prefix', 'escape'])('refuses %s data path', (kind) => {
  env.POSTGRES_DATA_DIR = {
    root: mount,
    relative: 'postgres',
    sibling: path.join(base, 'other'),
    prefix: `${mount}-other/data`,
    escape: `${mount}/../other`,
  }[kind];
  expect(() => verifyPostgresHdd(env)).toThrow();
});

test.each([
  'absent',
  'file',
  'data symlink',
  'ancestor symlink',
  'mount symlink',
  'mount ancestor symlink',
])('refuses real %s components without mutation', (kind) => {
  if (kind === 'absent') fs.rmdirSync(data);
  if (kind === 'file') {
    fs.rmdirSync(data);
    fs.writeFileSync(data, 'sentinel');
  }
  if (kind === 'data symlink') {
    fs.rmdirSync(data);
    fs.symlinkSync(base, data);
  }
  if (kind === 'ancestor symlink') {
    fs.symlinkSync(mount, path.join(mount, 'alias'));
    env.POSTGRES_DATA_DIR = path.join(mount, 'alias', 'postgres');
  }
  if (kind === 'mount symlink') {
    fs.symlinkSync(mount, path.join(base, 'alias'));
    env.POSTGRES_HDD_MOUNT = path.join(base, 'alias');
    env.POSTGRES_DATA_DIR = path.join(base, 'alias', 'postgres');
  }
  if (kind === 'mount ancestor symlink') {
    fs.symlinkSync(base, path.join(base, 'alias'));
    env.POSTGRES_HDD_MOUNT = path.join(base, 'alias', 'mount');
    env.POSTGRES_DATA_DIR = path.join(base, 'alias', 'mount', 'postgres');
  }
  expect(() => verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toThrow(
    'HDD guard: unsafe or unavailable path',
  );
});

test.each([0o755, 0o770, 0o777, 0o1700, 0o2700])('refuses data mode %i', (mode) => {
  fs.chmodSync(data, mode);
  expect(() => verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toThrow(
    'HDD guard: unsafe or unavailable path',
  );
});

test('accepts 0750 data mode', () => {
  fs.chmodSync(data, 0o750);
  expect(verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toEqual({
    verified: true,
  });
});

test('refuses mismatched actual data owner', () => {
  env.POSTGRES_DATA_UID = String(process.getuid() + 1);
  expect(() => verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toThrow(
    'HDD guard: unsafe or unavailable path',
  );
});

test.each([0o775, 0o777])('refuses writable mount ancestry mode %i', (mode) => {
  fs.chmodSync(mount, mode);
  expect(() => verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toThrow(
    'HDD guard: unsafe or unavailable path',
  );
});

test('refuses writable intermediate ancestry', () => {
  const parent = path.join(mount, 'parent');
  fs.mkdirSync(parent);
  fs.chmodSync(parent, 0o777);
  env.POSTGRES_DATA_DIR = path.join(parent, 'postgres');
  fs.mkdirSync(env.POSTGRES_DATA_DIR, { mode: 0o700 });
  expect(() => verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toThrow();
});

test('refuses paths disappearing during probes', () => {
  expect(() =>
    verifyPostgresHdd(env, {
      probe: (target) => {
        if (target === data) fs.rmdirSync(data);
        return fixtureProbe(target);
      },
      rootDevice: -1n,
    }),
  ).toThrow();
});

test('refuses missing configuration before filesystem or probe access', () => {
  expect(() => verifyPostgresHdd({})).toThrow('HDD guard: invalid configuration');
});

test('verifies safe real SSD directories against explicitly injected mount fixtures', () => {
  expect(verifyPostgresHdd(env, { probe: fixtureProbe, rootDevice: -1n })).toEqual({
    verified: true,
  });
});

test.each([
  ['SSD fallback', { target: '/' }],
  ['wrong UUID', { uuid: '493d6733-2a8b-482b-b39f-a7ecc1ce8863' }],
  ['unknown UUID', { uuid: null }],
  ['wrong filesystem', { fstype: 'xfs' }],
  ['unknown device', { 'maj:min': null }],
  ['wrong device', () => ({ 'maj:min': wrongDevice(device) })],
  ['bind subdirectory', { fsroot: '/subdir' }],
])('refuses %s mount evidence', (_name, changes) => {
  if (typeof changes === 'function') {
    changes = changes();
    expect(changes['maj:min']).not.toBe(device);
  }
  expect(() =>
    verifyPostgresHdd(env, { probe: (target) => fixtureProbe(target, changes), rootDevice: -1n }),
  ).toThrow('HDD guard: mount verification failed');
});

test.each(['8:1', '0:0', '259:2'])(
  'refuses wrong-device evidence with injected matching fixture device %s',
  (matchingDevice) => {
    // Inject only fixture st_dev and mount evidence, not a real mounted HDD.
    const [major, minor] = matchingDevice.split(':').map(BigInt);
    const fixtureDev = (major << 8n) | minor;
    const filesystem = {
      ...fs,
      lstatSync(entry, options) {
        const stat = fs.lstatSync(entry, options);
        if (entry === mount || entry === data) stat.dev = fixtureDev;
        return stat;
      },
    };
    device = deviceId(fixtureDev);
    expect(device).toBe(matchingDevice);
    expect(verifyPostgresHdd(env, { filesystem, probe: fixtureProbe, rootDevice: -1n })).toEqual({
      verified: true,
    });
    const mismatchedDevice = wrongDevice(device);
    expect(() =>
      verifyPostgresHdd(env, {
        filesystem,
        probe: (target) => fixtureProbe(target, { 'maj:min': mismatchedDevice }),
        rootDevice: -1n,
      }),
    ).toThrow('HDD guard: mount verification failed');
    expect(mismatchedDevice).toMatch(/^\d+:\d+$/);
    expect(mismatchedDevice).not.toBe(device);
  },
);

test('refuses a nested data mount even on the expected filesystem', () => {
  expect(() =>
    verifyPostgresHdd(env, {
      probe: (target) => fixtureProbe(target, target === data ? { target: data } : {}),
      rootDevice: -1n,
    }),
  ).toThrow();
});

test('refuses the actual root/SSD device despite matching injected UUID', () => {
  expect(() => verifyPostgresHdd(env, { probe: fixtureProbe })).toThrow(
    'HDD guard: mount verification failed',
  );
});

test.each([
  '',
  '{}',
  'secret malformed',
  '{"filesystems":[]}',
  '{"filesystems":[{},{}]}',
  '{"filesystems":[{"children":[{}]}]}',
])('refuses malformed or ambiguous JSON %j', (output) => {
  expect(() => verifyPostgresHdd(env, { probe: () => output, rootDevice: -1n })).toThrow(
    'HDD guard: mount verification failed',
  );
});

test.each(['ENOENT', 'ETIMEDOUT', 'ENOBUFS', 'nonzero'])('sanitizes %s probe failures', (code) => {
  expect(() =>
    verifyPostgresHdd(env, {
      probe: () => {
        throw Object.assign(new Error('credential-secret'), { code });
      },
      rootDevice: -1n,
    }),
  ).toThrow('HDD guard: mount verification failed');
});

test.each([[[]], [['--check', 'extra']], [['--']], [['unknown']], [['--unknown']], [['--', '']]])(
  'invalid CLI %j suppresses child before verification',
  async (argv) => {
    let called = false;
    const result = await runGuarded(argv, {
      env,
      guardOptions: {
        probe: () => {
          called = true;
          return fixtureProbe();
        },
        rootDevice: -1n,
      },
      diagnostic: () => {},
    });
    expect(result).toEqual({ code: 1, signal: null });
    expect(called).toBe(false);
  },
);

test('refused guard never executes sentinel child or creates absent data', async () => {
  const sentinel = path.join(base, 'sentinel');
  fs.rmdirSync(data);
  const result = await runGuarded(
    [
      '--',
      process.execPath,
      '-e',
      'require("fs").writeFileSync(process.argv[1], "executed")',
      sentinel,
    ],
    { env, diagnostic: () => {} },
  );
  expect(result).toEqual({ code: 1, signal: null });
  expect(fs.existsSync(sentinel)).toBe(false);
  expect(fs.existsSync(data)).toBe(false);
});

test('check mode passes injected fixture without spawning a child', async () => {
  expect(
    await runGuarded(['--check'], { env, guardOptions: { probe: fixtureProbe, rootDevice: -1n } }),
  ).toEqual({ code: 0, signal: null });
});

test('allowed fixture launch preserves literal argv and foreground exit status', async () => {
  const resultPath = path.join(base, 'argv.json');
  const args = ['space value', '$(touch forbidden)', '; exit 99', '*', '"quotes"'];
  const result = await runGuarded(
    [
      '--',
      process.execPath,
      '-e',
      'require("fs").writeFileSync(process.argv[1],JSON.stringify(process.argv.slice(2)));process.exit(37)',
      resultPath,
      ...args,
    ],
    { env, guardOptions: { probe: fixtureProbe, rootDevice: -1n } },
  );
  expect(result).toEqual({ code: 37, signal: null });
  expect(JSON.parse(fs.readFileSync(resultPath, 'utf8'))).toEqual(args);
});

test('spawn failure has a fixed diagnostic, not raw command/error', async () => {
  const messages = [];
  expect(
    await runGuarded(['--', path.join(base, 'credential-secret-command')], {
      env,
      guardOptions: { probe: fixtureProbe, rootDevice: -1n },
      diagnostic: (message) => messages.push(message),
    }),
  ).toEqual({ code: 1, signal: null });
  expect(messages).toEqual(['HDD guard: child launch failed']);
});

test('returns actual child termination signal', async () => {
  expect(
    await runGuarded(['--', process.execPath, '-e', 'process.kill(process.pid,"SIGTERM")'], {
      env,
      guardOptions: { probe: fixtureProbe, rootDevice: -1n },
    }),
  ).toEqual({ code: null, signal: 'SIGTERM' });
});

test('import is silent and side-effect free with hostile environment', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(script)});`],
    {
      env: { ...process.env, POSTGRES_HDD_MOUNT: '/credential-secret' },
      encoding: 'utf8',
      timeout: 3000,
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
});

test('real production CLI refuses SSD fixture despite test-named environment bypass attempts', () => {
  const sentinel = path.join(base, 'never');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--',
      process.execPath,
      '-e',
      'require("fs").writeFileSync(process.argv[1], "bad")',
      sentinel,
    ],
    {
      env: { ...process.env, ...env, NODE_ENV: 'test', POSTGRES_HDD_GUARD_TEST: 'success' },
      encoding: 'utf8',
      timeout: 3000,
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('HDD guard: mount verification failed\n');
  expect(fs.existsSync(sentinel)).toBe(false);
});

test.each(['SIGINT', 'SIGTERM', 'SIGHUP', 'IGNORE'])(
  'foreground wrapper forwards %s and propagates termination',
  async (signal) => {
    const childCode = `${signal === 'IGNORE' ? 'process.on("SIGTERM",()=>{});' : ''}console.log("READY:"+process.pid);setInterval(()=>{},1000);`;
    const driver = `import { main } from ${JSON.stringify(script)};await main(${JSON.stringify(['--', process.execPath, '-e', childCode])},{env:${JSON.stringify(env)},guardOptions:{rootDevice:-1n,probe:()=>${JSON.stringify(fixtureProbe())}}});`;
    const wrapper = spawn(process.execPath, ['--input-type=module', '-e', driver], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childPid;
    let output = '';
    let error = '';
    let watchdog;
    const outcome = new Promise((resolve, reject) => {
      watchdog = setTimeout(() => reject(new Error('foreground lifecycle deadline')), 4000);
      wrapper.stdout.on('data', (chunk) => {
        output += chunk;
        const match = /READY:(\d+)/.exec(output);
        if (match && !childPid) {
          childPid = Number(match[1]);
          wrapper.kill(signal === 'IGNORE' ? 'SIGTERM' : signal);
        }
      });
      wrapper.stderr.on('data', (chunk) => {
        error += chunk;
      });
      wrapper.once('error', reject);
      wrapper.once('exit', (code, terminated) => resolve({ code, signal: terminated }));
    });
    try {
      expect(await outcome).toEqual({
        code: null,
        signal: signal === 'IGNORE' ? 'SIGKILL' : signal,
      });
      expect(error).toBe('');
      expect(childPid).toBeGreaterThan(0);
      expect(() => process.kill(childPid, 0)).toThrow();
    } finally {
      clearTimeout(watchdog);
      if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL');
      if (childPid) {
        try {
          process.kill(childPid, 'SIGKILL');
        } catch {
          /* Already reaped owned child. */
        }
      }
    }
  },
);

test('real probe invocation is absolute, bounded, shell-free and carries no caller secrets', () => {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return fixtureProbe();
  };
  expect(verifyPostgresHdd(env, { execute, rootDevice: -1n })).toEqual({ verified: true });
  expect(calls).toHaveLength(2);
  for (const [index, call] of calls.entries()) {
    expect(call.command).toBe('/usr/bin/findmnt');
    expect(call.args).toEqual([
      '--json',
      '--target',
      index === 0 ? mount : data,
      '--output',
      'TARGET,UUID,FSTYPE,MAJ:MIN,FSROOT',
    ]);
    expect(call.options).toEqual({
      encoding: 'utf8',
      timeout: 2000,
      killSignal: 'SIGKILL',
      maxBuffer: 16384,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
    });
  }
});

test.each(['timeout', 'overflow', 'nonzero'])(
  'actual bounded execFileSync %s is sanitized and suppresses launch',
  async (kind) => {
    let called = false;
    const execute = (_command, _args, options) => {
      called = true;
      const code = {
        timeout: 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)',
        overflow: 'process.stdout.write("x".repeat(20000))',
        nonzero: 'process.stderr.write("credential-secret");process.exit(3)',
      }[kind];
      return execFileSync(process.execPath, ['-e', code], options);
    };
    const messages = [];
    const sentinel = path.join(base, 'never');
    const result = await runGuarded(
      [
        '--',
        process.execPath,
        '-e',
        'require("fs").writeFileSync(process.argv[1], "bad")',
        sentinel,
      ],
      {
        env,
        guardOptions: { execute, rootDevice: -1n },
        diagnostic: (message) => messages.push(message),
      },
    );
    expect(called).toBe(true);
    expect(result).toEqual({ code: 1, signal: null });
    expect(messages).toEqual(['HDD guard: mount verification failed']);
    expect(fs.existsSync(sentinel)).toBe(false);
  },
);

test.each(['configuration', 'UUID', 'nested', 'mode', 'owner', 'symlink', 'malformed'])(
  'forbidden %s launch has zero sentinel invocations',
  async (kind) => {
    let probe = fixtureProbe;
    if (kind === 'configuration') delete env.POSTGRES_HDD_UUID;
    if (kind === 'UUID') probe = (target) => fixtureProbe(target, { uuid: null });
    if (kind === 'nested') probe = (target) => fixtureProbe(target, { target: data });
    if (kind === 'mode') fs.chmodSync(data, 0o777);
    if (kind === 'owner') env.POSTGRES_DATA_UID = String(process.getuid() + 1);
    if (kind === 'symlink') {
      fs.rmdirSync(data);
      fs.symlinkSync(base, data);
    }
    if (kind === 'malformed') probe = () => 'credential-secret invalid JSON';
    const sentinel = path.join(base, 'sentinel');
    const messages = [];
    expect(
      await runGuarded(
        [
          '--',
          process.execPath,
          '-e',
          'require("fs").writeFileSync(process.argv[1], "bad")',
          sentinel,
        ],
        {
          env,
          guardOptions: { probe, rootDevice: -1n },
          diagnostic: (message) => messages.push(message),
        },
      ),
    ).toEqual({ code: 1, signal: null });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages.join('')).not.toMatch(/credential-secret|sentinel|postgres/);
  },
);

test('detects inconsistent stat device evidence with parameter-only filesystem fixture', () => {
  const filesystem = {
    ...fs,
    lstatSync: (entry, options) => {
      const stat = fs.lstatSync(entry, options);
      if (entry === data) Object.defineProperty(stat, 'dev', { value: stat.dev + 1n });
      return stat;
    },
  };
  expect(() =>
    verifyPostgresHdd(env, { probe: fixtureProbe, filesystem, rootDevice: -1n }),
  ).toThrow('HDD guard: mount verification failed');
});

test('detects changed existing path identity after probes', () => {
  expect(() =>
    verifyPostgresHdd(env, {
      rootDevice: -1n,
      probe: (target) => {
        if (target === data) {
          fs.renameSync(data, `${data}-old`);
          fs.mkdirSync(data, { mode: 0o700 });
        }
        return fixtureProbe(target);
      },
    }),
  ).toThrow('HDD guard: unsafe or unavailable path');
});

test('actual CLI invalid arguments refuse without leaking argv', () => {
  const result = spawnSync(process.execPath, [script, '--credential-secret'], {
    encoding: 'utf8',
    timeout: 3000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('HDD guard: invalid CLI\n');
});

test('direct CLI through a script symlink still verifies instead of silent exit0', () => {
  const alias = path.join(base, 'guard-alias.mjs');
  fs.symlinkSync(script, alias);
  const result = spawnSync(process.execPath, [alias, '--check'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 3000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('HDD guard: mount verification failed\n');
});
