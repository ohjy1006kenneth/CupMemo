import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { runPrivateStack } from '../infrastructure/scripts/private-stack-start.mjs';

const { queueMicrotask } = globalThis;
const moduleUrl = new URL('../infrastructure/scripts/private-stack-start.mjs', import.meta.url);

test('invalid CLI refuses before inspecting configuration or launching', async () => {
  const { runPrivateStack } = await import(moduleUrl.href);
  const messages = [];
  const env = new Proxy(
    {},
    {
      get() {
        throw new Error('must not inspect');
      },
    },
  );
  expect(
    await runPrivateStack(['--', 'arbitrary'], {
      env,
      diagnostic: (message) => messages.push(message),
      spawn() {
        throw new Error('must not launch');
      },
    }),
  ).toEqual({ code: 1, signal: null });
  expect(messages).toEqual(['Private stack: invalid CLI']);
});

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const composeKeys = [
  'CUPMEMO_WEB_IMAGE',
  'CUPMEMO_API_IMAGE',
  'CUPMEMO_POSTGRES_IMAGE',
  'CUPMEMO_API_ENV_FILE',
  'POSTGRES_PASSWORD_FILE',
  'POSTGRES_DATA_DIR',
  'POSTGRES_DATA_UID',
  'POSTGRES_DB',
  'POSTGRES_USER',
];
const required = [
  ...composeKeys,
  'POSTGRES_HDD_MOUNT',
  'POSTGRES_HDD_UUID',
  'CUPMEMO_DOCKER_CONFIG_DIR',
];
let base, env, guardOptions, messages, calls, child, signals;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.homedir(), 'cupmemo32-start-'));
  const mount = path.join(base, 'mount');
  const data = path.join(mount, 'data');
  fs.mkdirSync(mount, { mode: 0o755 });
  fs.mkdirSync(data, { mode: 0o700 });
  env = {
    CUPMEMO_WEB_IMAGE: `sha256:${'1'.repeat(64)}`,
    CUPMEMO_API_IMAGE: `registry.invalid/cupmemo/api@sha256:${'2'.repeat(64)}`,
    CUPMEMO_POSTGRES_IMAGE: `postgres:17-bookworm@sha256:${'3'.repeat(64)}`,
    CUPMEMO_API_ENV_FILE: path.join(base, 'api.env'),
    POSTGRES_PASSWORD_FILE: path.join(base, 'password'),
    POSTGRES_DATA_DIR: data,
    POSTGRES_DATA_UID: String(process.getuid()),
    POSTGRES_DB: 'offline_db',
    POSTGRES_USER: 'offline_user',
    POSTGRES_HDD_MOUNT: mount,
    POSTGRES_HDD_UUID: '68391fd3-3c92-4cfe-82db-47a5e6abb2ee',
    CUPMEMO_DOCKER_CONFIG_DIR: path.join(base, 'docker-config'),
  };
  const dev = fs.lstatSync(data, { bigint: true }).dev;
  const device = `${((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)}:${(dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)}`;
  // Real SSD directories plus injected mount evidence; NOT an HDD/real launch.
  guardOptions = {
    rootDevice: -1n,
    probe: vi.fn(() =>
      JSON.stringify({
        filesystems: [
          {
            target: mount,
            uuid: env.POSTGRES_HDD_UUID,
            fstype: 'ext4',
            'maj:min': device,
            fsroot: '/',
          },
        ],
      }),
    ),
  };
  messages = [];
  calls = [];
  child = new EventEmitter();
  signals = new EventEmitter();
  child.kill = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(base, { recursive: true, force: true });
});

function options(overrides = {}) {
  return {
    env,
    guardOptions,
    signals,
    diagnostic: (message) => messages.push(message),
    spawn: (...args) => {
      calls.push(args);
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
    ...overrides,
  };
}

test('fresh verified fixture launches only fixed local Compose with allowlisted literal settings', async () => {
  env.CUPMEMO_DOCKER_CONFIG_DIR = path.join(base, 'config $(forbidden); space');
  env.POSTGRES_DB = 'literal $(forbidden); space';
  Object.assign(env, {
    COMPOSE_FILE: '/hostile',
    COMPOSE_PROFILES: 'bad',
    COMPOSE_ENV_FILES: '/hostile',
    DOCKER_HOST: 'tcp://remote',
    DOCKER_CONTEXT: 'remote',
    DOCKER_TLS_VERIFY: '1',
    NODE_OPTIONS: '--bad',
    HOME: '/secret',
    DATABASE_URL: 'secret',
  });
  expect(await runPrivateStack(['--start'], options())).toEqual({ code: 0, signal: null });
  expect(guardOptions.probe).toHaveBeenCalledTimes(2);
  const expectedEnv = Object.fromEntries(composeKeys.map((key) => [key, env[key]]));
  Object.assign(expectedEnv, { PATH: '/usr/bin:/bin', LC_ALL: 'C', COMPOSE_DISABLE_ENV_FILE: '1' });
  expect(calls).toEqual([
    [
      '/usr/bin/docker',
      [
        '--host',
        'unix:///var/run/docker.sock',
        '--config',
        env.CUPMEMO_DOCKER_CONFIG_DIR,
        'compose',
        '--env-file',
        '/dev/null',
        '--project-name',
        'cupmemo-private',
        '--file',
        `${root}/infrastructure/docker/production.compose.yml`,
        'up',
        '--no-build',
        '--pull',
        'never',
        '--abort-on-container-failure',
      ],
      { shell: false, detached: false, stdio: 'ignore', env: expectedEnv },
    ],
  ]);
  expect(messages).toEqual(['Private stack: launching', 'Private stack: child exit 0']);
});

test.each(required)(
  'refuses omitted/empty/control/nonstring %s before guard or child',
  async (key) => {
    for (const value of [undefined, '', '\u0000secret', 'secret\n', 'secret\u007f', 123]) {
      env[key] = value;
      messages.length = 0;
      expect(await runPrivateStack(['--start'], options())).toEqual({ code: 1, signal: null });
      expect(messages).toEqual(['Private stack: invalid configuration']);
    }
    expect(guardOptions.probe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  },
);

test.each(['CUPMEMO_WEB_IMAGE', 'CUPMEMO_API_IMAGE', 'CUPMEMO_POSTGRES_IMAGE'])(
  'rejects unsafe image shape in %s',
  async (key) => {
    for (const value of [
      'latest',
      'postgres:17',
      '--option',
      `-bad@sha256:${'a'.repeat(64)}`,
      `repo name@sha256:${'a'.repeat(64)}`,
      `repo@sha256:${'A'.repeat(64)}`,
      `sha256:${'1'.repeat(63)}`,
      `repo//@sha256:${'a'.repeat(64)}`,
      `repo:bad:tag@sha256:${'a'.repeat(64)}`,
      `repo/../image@sha256:${'a'.repeat(64)}`,
    ]) {
      env[key] = value;
      expect(await runPrivateStack(['--start'], options())).toEqual({ code: 1, signal: null });
    }
    expect(guardOptions.probe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  },
);

test.each(['CUPMEMO_API_ENV_FILE', 'POSTGRES_PASSWORD_FILE', 'CUPMEMO_DOCKER_CONFIG_DIR'])(
  'rejects unsafe external %s',
  async (key) => {
    for (const value of [
      '/',
      'relative',
      '/one/../two',
      '/one//two',
      '/one/',
      root,
      `${root}/secret`,
    ]) {
      env[key] = value;
      expect(await runPrivateStack(['--start'], options())).toEqual({ code: 1, signal: null });
    }
    expect(guardOptions.probe).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  },
);

test.each(['missing', 'symlink', 'permissions', 'UID', 'UUID', 'SSD', 'probe error'])(
  'guard %s refusal suppresses launch without mutations or raw diagnostics',
  async (kind) => {
    if (kind === 'missing') fs.rmdirSync(env.POSTGRES_DATA_DIR);
    if (kind === 'symlink') {
      fs.rmdirSync(env.POSTGRES_DATA_DIR);
      fs.symlinkSync(base, env.POSTGRES_DATA_DIR);
    }
    if (kind === 'permissions') fs.chmodSync(env.POSTGRES_DATA_DIR, 0o777);
    if (kind === 'UID') env.POSTGRES_DATA_UID = '0';
    if (kind === 'UUID') env.POSTGRES_HDD_UUID = 'credential-secret';
    if (kind === 'SSD') delete guardOptions.rootDevice;
    if (kind === 'probe error')
      guardOptions.probe = () => {
        throw new Error('credential-secret');
      };
    expect(await runPrivateStack(['--start'], options())).toEqual({ code: 1, signal: null });
    expect(messages).toEqual(['Private stack: HDD verification refused']);
    expect(calls).toEqual([]);
    if (kind === 'missing') expect(fs.existsSync(env.POSTGRES_DATA_DIR)).toBe(false);
  },
);

test('a second start checks new mount evidence rather than caching success', async () => {
  expect(await runPrivateStack(['--start'], options())).toEqual({ code: 0, signal: null });
  guardOptions.probe.mockReturnValue('{"filesystems":[]}');
  expect(await runPrivateStack(['--start'], options())).toEqual({ code: 1, signal: null });
  expect(calls).toHaveLength(1);
});

test.each([0, 37, 255])('preserves child exit code %i', async (code) => {
  expect(
    await runPrivateStack(
      ['--start'],
      options({
        spawn: () => {
          queueMicrotask(() => child.emit('exit', code, null));
          return child;
        },
      }),
    ),
  ).toEqual({ code, signal: null });
  expect(messages).toEqual(['Private stack: launching', `Private stack: child exit ${code}`]);
});

test.each(['throw', 'error'])(
  'sanitizes %s spawn failure and settles error/exit race once',
  async (kind) => {
    expect(
      await runPrivateStack(
        ['--start'],
        options({
          spawn: () => {
            if (kind === 'throw') throw new Error('credential-secret');
            queueMicrotask(() => {
              child.emit('error', new Error('credential-secret'));
              child.emit('exit', 99, null);
            });
            return child;
          },
        }),
      ),
    ).toEqual({ code: 1, signal: null });
    expect(messages).toEqual(['Private stack: launching', 'Private stack: child launch failed']);
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) expect(signals.listenerCount(name)).toBe(0);
  },
);

test.each(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGKILL'])(
  'preserves child signal %s without interpolating untrusted diagnostics',
  async (signal) => {
    expect(
      await runPrivateStack(
        ['--start'],
        options({
          spawn: () => {
            queueMicrotask(() => child.emit('exit', null, signal));
            return child;
          },
        }),
      ),
    ).toEqual({ code: null, signal });
    expect(messages).toEqual(['Private stack: launching', `Private stack: child signal ${signal}`]);
  },
);

test.each(['SIGINT', 'SIGTERM', 'SIGHUP'])(
  'forwards %s and removes handlers/timers',
  async (signal) => {
    vi.useFakeTimers();
    const existing = vi.fn();
    signals.on(signal, existing);
    child.kill.mockImplementation((name) => {
      queueMicrotask(() => child.emit('exit', null, name));
      return true;
    });
    const result = runPrivateStack(['--start'], options({ spawn: () => child }));
    signals.emit(signal);
    await vi.runAllTicks();
    expect(await result).toEqual({ code: null, signal });
    expect(child.kill).toHaveBeenCalledExactlyOnceWith(signal);
    expect(signals.listeners(signal)).toEqual([existing]);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test('ignored termination escalates once at 2000ms and settles with SIGKILL', async () => {
  vi.useFakeTimers();
  child.kill.mockImplementation((signal) => {
    if (signal === 'SIGKILL') child.emit('exit', null, signal);
    return true;
  });
  const result = runPrivateStack(['--start'], options({ spawn: () => child }));
  signals.emit('SIGTERM');
  signals.emit('SIGHUP');
  await vi.advanceTimersByTimeAsync(1999);
  expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGHUP']]);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ code: null, signal: 'SIGKILL' });
  expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGHUP'], ['SIGKILL']]);
  expect(vi.getTimerCount()).toBe(0);
  expect(signals.eventNames()).toEqual([]);
});

test('exit wins a late error race without duplicate diagnostics', async () => {
  expect(
    await runPrivateStack(
      ['--start'],
      options({
        spawn: () => {
          queueMicrotask(() => {
            child.emit('exit', 37, null);
            child.emit('error', new Error('credential-secret'));
          });
          return child;
        },
      }),
    ),
  ).toEqual({ code: 37, signal: null });
  expect(messages).toEqual(['Private stack: launching', 'Private stack: child exit 37']);
});

test.each([
  [null, 'credential-secret'],
  ['credential-secret', null],
])('refuses nontransport exit data %j/%j without printing it', async (code, signal) => {
  expect(
    await runPrivateStack(
      ['--start'],
      options({
        spawn: () => {
          queueMicrotask(() => child.emit('exit', code, signal));
          return child;
        },
      }),
    ),
  ).toEqual({ code: 1, signal: null });
  expect(messages).toEqual(['Private stack: launching', 'Private stack: child launch failed']);
});

test('CLI import is silent and real absent/unmounted/unsafe configuration never reaches transport', () => {
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl.href)})`],
    { env: {}, encoding: 'utf8', timeout: 3000 },
  );
  expect([imported.status, imported.stdout, imported.stderr]).toEqual([0, '', '']);
  // Absent or unsafe inputs refuse before /usr/bin/docker; no live daemon or HDD used.
  for (const [settings, reason] of [
    [{}, 'invalid configuration'],
    [env, 'HDD verification refused'],
    [{ ...env, POSTGRES_DATA_DIR: path.join(base, 'missing') }, 'HDD verification refused'],
  ]) {
    const result = spawnSync(process.execPath, [fileURLToPath(moduleUrl), '--start'], {
      env: settings,
      cwd: base,
      encoding: 'utf8',
      timeout: 3000,
    });
    expect([result.status, result.stdout, result.stderr]).toEqual([
      1,
      '',
      `Private stack: ${reason}\n`,
    ]);
  }
  expect(fs.existsSync(path.join(base, 'missing'))).toBe(false);
});

test.each(['exit', 'signal', 'missing executable', 'ignore termination'])(
  'real fake-child transport: %s, main propagation and discarded hostile output',
  (kind) => {
    const ready = path.join(base, 'ready');
    const childCode =
      kind === 'ignore termination'
        ? `process.on('SIGTERM',()=>{});require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`
        : kind === 'signal'
          ? `process.kill(process.pid,'SIGTERM');`
          : 'process.exit(37);';
    const driver = `
    import { main } from ${JSON.stringify(moduleUrl.href)};
    import { spawn } from 'node:child_process';
    import fs from 'node:fs';
    import process from 'node:process';
    import { setInterval, clearInterval } from 'node:timers';
    ${kind === 'ignore termination' ? `const poll=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(poll);process.kill(process.pid,'SIGTERM');}},10);` : ''}
    await main(['--start'], { env:${JSON.stringify(env)}, guardOptions: {rootDevice:-1n,probe:()=>${JSON.stringify(guardOptions.probe())}},
      spawn: (_command,_argv,options)=>spawn(${JSON.stringify(kind === 'missing executable' ? path.join(base, 'credential-secret-missing') : process.execPath)}, ['-e',${JSON.stringify(`process.stdout.write('credential-secret');process.stderr.write('credential-secret');${childCode}`)}],options)
    });`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
      env: {},
      cwd: base,
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe('');
    const outcome =
      kind === 'signal'
        ? 'child signal SIGTERM'
        : kind === 'ignore termination'
          ? 'child signal SIGKILL'
          : kind === 'exit'
            ? 'child exit 37'
            : 'child launch failed';
    expect(result.stderr).toBe(`Private stack: launching\nPrivate stack: ${outcome}\n`);
    expect({ code: result.status, signal: result.signal }).toEqual(
      kind === 'signal'
        ? { code: null, signal: 'SIGTERM' }
        : kind === 'ignore termination'
          ? { code: null, signal: 'SIGKILL' }
          : { code: kind === 'exit' ? 37 : 1, signal: null },
    );
  },
);

test('dormant service always invokes wrapper with explicit operator inputs and no activation wiring', () => {
  const source = fs.readFileSync(
    new URL('../infrastructure/systemd/cupmemo-private.service.in', import.meta.url),
    'utf8',
  );
  for (const setting of [
    'Type=simple',
    'Restart=no',
    'KillMode=control-group',
    'TimeoutStopSec=15s',
    'User=@CUPMEMO_OPERATOR_USER@',
    'EnvironmentFile=@CUPMEMO_STARTUP_ENV_FILE@',
    'WorkingDirectory=@CUPMEMO_RELEASE_DIR@',
    'ExecStart=/usr/bin/node @CUPMEMO_RELEASE_DIR@/infrastructure/scripts/private-stack-start.mjs --start',
  ])
    expect(source.split('\n')).toContain(setting);
  expect(source).not.toMatch(
    /ExecStartPre|ExecStop|\[Install\]|WantedBy|Requires=|Wants=|EnvironmentFile=-|\/bin\/sh|docker compose/,
  );
});
