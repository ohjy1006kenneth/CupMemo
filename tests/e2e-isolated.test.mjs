import { describe, expect, test } from 'vitest';
/* global AbortController */
import { URL } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat, realpath } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {
  validateEnvironment,
  resolveOutput,
  childEnvironment,
  verifyIdentity,
  verifyOwnership,
  fixtureLifecycle,
  assertPortsFree,
  waitForTcp,
  createServices,
  commandExecutor,
  runIsolated,
} from '../scripts/e2e-isolated.mjs';

describe('isolated runner inherited configuration boundary', () => {
  test.each([
    ['NODE_ENV', 'production'],
    ['DATABASE_URL', 'postgresql://private-value@example.invalid/production'],
    ['CUPMEMO_DB_ENV', 'test'],
    ['CUPMEMO_DATABASE_URL_TEST', 'private-value'],
    ['CUPMEMO_DATABASE_URL_DEVELOPMENT', 'private-value'],
    ['CUPMEMO_DATABASE_URL_PRODUCTION', 'private-value'],
    ['CUPMEMO_TEST_DATABASE', 'cupmemo_test_other'],
  ])('refuses %s without reflecting values', (key, value) => {
    expect(() => validateEnvironment({ [key]: value })).toThrow(/Inherited configuration refused/);
    try {
      validateEnvironment({ [key]: value });
    } catch (error) {
      expect(error.message).not.toContain(value);
    }
  });
  test('accepts a configuration-free shell without changing it', () => {
    const env = Object.freeze({ PATH: '/bin', NODE_ENV: 'development' });
    expect(() => validateEnvironment(env)).not.toThrow();
    expect(env).toEqual({ PATH: '/bin', NODE_ENV: 'development' });
  });
});

test('output validation refuses invalid CLI, existing evidence and symlink escapes before writing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-unit-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-outside-'));
  try {
    await mkdir(path.join(root, 'test-results/existing'), { recursive: true });
    await writeFile(path.join(root, 'test-results/existing/sentinel'), 'preserve');
    await symlink(outside, path.join(root, 'test-results/escape'));
    for (const args of [
      ['--keep'],
      ['--output='],
      ['--output=test-results/a', '--output=test-results/b'],
      ['--output=../other'],
      ['--output=test-results/existing'],
      ['--output=test-results/escape/new'],
    ])
      await expect(resolveOutput(root, args)).rejects.toThrow();
    expect(await readFile(path.join(root, 'test-results/existing/sentinel'), 'utf8')).toBe(
      'preserve',
    );
    expect(await resolveOutput(root, ['--output=test-results/fresh'])).toBe(
      path.join(root, 'test-results/fresh'),
    );
    expect(await resolveOutput(root, [])).not.toBe(await resolveOutput(root, []));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

const fixture = {
  run: '0123456789abcdef',
  database: 'cupmemo_test_0123456789abcdef',
  role: 'cupmemo_test_0123456789abcdef',
  password: 'private-db-password',
  secret: 'private-auth-secret',
  pgPort: 55001,
  webPort: 55002,
  apiPort: 55003,
  containerId: 'a'.repeat(64),
  containerName: 'cupmemo-e2e-0123456789abcdef',
  volume: 'cupmemo-e2e-0123456789abcdef-data',
};
test('children use only generated identity and matching origins with NODE_ENV unset', () => {
  const parent = Object.freeze({
    PATH: '/bin',
    NODE_ENV: 'development',
    BETTER_AUTH_URL: 'https://other.invalid',
    CUPMEMO_API_ORIGIN: 'https://other.invalid',
    PGHOST: 'other',
    PGOPTIONS: '-c search_path=other',
  });
  const env = childEnvironment(parent, fixture);
  expect(env.NODE_ENV).toBeUndefined();
  expect(env.PGHOST).toBeUndefined();
  expect(env.PGOPTIONS).toBeUndefined();
  expect(env.CUPMEMO_DB_ENV).toBe('test');
  expect(env.CUPMEMO_TEST_DATABASE).toBe(fixture.database);
  expect(env.BETTER_AUTH_URL).toBe('http://127.0.0.1:55002');
  expect(env.CUPMEMO_API_ORIGIN).toBe('http://127.0.0.1:55003');
  expect(env.BETTER_AUTH_SECRET).toBe(fixture.secret);
  const url = new URL(env.CUPMEMO_DATABASE_URL_TEST);
  expect(url.username).toBe(fixture.role);
  expect(url.password).toBe(fixture.password);
  expect(url.port).toBe('55001');
  expect(parent.PGHOST).toBe('other');
});

test('authenticated identity requires exact database, role, version and literal public search_path', () => {
  const row = {
    database: fixture.database,
    role: fixture.role,
    version: '17.6',
    search_path: 'public',
  };
  expect(verifyIdentity(row, fixture)).toBe(true);
  for (const key of Object.keys(row))
    expect(() => verifyIdentity({ ...row, [key]: 'different' }, fixture)).toThrow(/identity/);
});

const labels = { 'org.cupmemo.owner': 'e2e-isolated', 'org.cupmemo.run': fixture.run };
const container = {
  Id: fixture.containerId,
  Name: `/${fixture.containerName}`,
  Labels: labels,
  Mounts: [
    {
      Type: 'volume',
      Name: fixture.volume,
      Source: `/var/lib/docker/volumes/${fixture.volume}/_data`,
      Destination: '/var/lib/postgresql/data',
    },
  ],
  Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55001' }] },
};
const volume = {
  Name: fixture.volume,
  Labels: labels,
  Mountpoint: `/var/lib/docker/volumes/${fixture.volume}/_data`,
  Driver: 'local',
};
test('destructive lifecycle requires exact created ID, both labels, volume mount and endpoint', () => {
  expect(verifyOwnership(container, volume, fixture)).toBe(true);
  for (const changed of [
    { ...container, Id: 'b'.repeat(64) },
    { ...container, Labels: {} },
    { ...container, Mounts: [] },
    { ...container, Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55001' }] } },
  ]) {
    expect(() => verifyOwnership(changed, volume, fixture)).toThrow(/ownership/);
  }
  expect(() =>
    verifyOwnership(
      container,
      { ...volume, Labels: { ...labels, 'org.cupmemo.run': 'other' } },
      fixture,
    ),
  ).toThrow(/ownership/);
});

function fakeServices(failure, mismatch = false) {
  const calls = [];
  let removed = false;
  const step = (name, value) => async () => {
    calls.push(name);
    if (failure === name) throw new Error('private-message-must-not-be-recorded');
    return value;
  };
  return {
    calls,
    createVolume: step('volume', fixture.volume),
    createContainer: step('container', fixture.containerId),
    inspect: async () => {
      calls.push('inspect');
      return {
        container: removed ? null : container,
        volume: mismatch ? { ...volume, Labels: {} } : volume,
      };
    },
    start: step('start'),
    wait: step('wait'),
    identity: step('identity', {
      database: fixture.database,
      role: fixture.role,
      version: '17.6',
      search_path: 'public',
    }),
    command: async (name) => {
      calls.push(name);
      if (name === failure)
        throw Object.assign(new Error('private-message-must-not-be-recorded'), { exitCode: 9 });
      return { exitCode: 0 };
    },
    stopChildren: step('children'),
    removeContainer: async () => {
      calls.push('remove-container');
      removed = true;
    },
    removeVolume: step('remove-volume'),
    removePrivate: step('private'),
  };
}
test('fixture lifecycle executes ordered authenticated migrations twice and full browser then verified cleanup', async () => {
  const services = fakeServices();
  const report = await fixtureLifecycle({ ...fixture }, services, { phases: [], cleanup: [] });
  expect(report.exitCode).toBe(0);
  expect(services.calls).toEqual([
    'volume',
    'container',
    'inspect',
    'start',
    'wait',
    'database-build',
    'identity',
    'migrate-1',
    'migrate-2',
    'status',
    'browser',
    'children',
    'inspect',
    'remove-container',
    'inspect',
    'remove-volume',
    'private',
  ]);
});
test.each(['start', 'wait', 'identity', 'migrate-1', 'browser'])(
  'failure at %s retains phase and cleans exact owned resources',
  async (failure) => {
    const services = fakeServices(failure);
    const report = await fixtureLifecycle({ ...fixture }, services, { phases: [], cleanup: [] });
    expect(report.exitCode).not.toBe(0);
    expect(report.failedPhase).toBe(failure);
    expect(JSON.stringify(report)).not.toContain('private-message');
    expect(services.calls.slice(-6)).toEqual([
      'children',
      'inspect',
      'remove-container',
      'inspect',
      'remove-volume',
      'private',
    ]);
    if (failure !== 'browser') expect(services.calls).not.toContain('browser');
  },
);
test('cleanup mismatch refuses deletion and makes an otherwise successful run nonzero', async () => {
  const services = fakeServices();
  const inspect = services.inspect;
  let reads = 0;
  services.inspect = async () => {
    const result = await inspect();
    if (++reads > 1) result.volume = { ...volume, Labels: {} };
    return result;
  };
  const report = await fixtureLifecycle({ ...fixture }, services, { phases: [], cleanup: [] });
  expect(report.exitCode).not.toBe(0);
  expect(services.calls).not.toContain('remove-container');
  expect(services.calls).not.toContain('remove-volume');
  expect(services.calls).toContain('private');
  expect(report.cleanup.some((item) => item.status === 'failed')).toBe(true);
});

test('occupied loopback listener is refused and remains untouched', async () => {
  const listener = net.createServer((socket) => socket.end());
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  try {
    const port = listener.address().port;
    await expect(assertPortsFree([port])).rejects.toThrow(/occupied/);
    await waitForTcp(port, { timeout: 100 });
    expect(listener.listening).toBe(true);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});
test('TCP readiness is bounded and interruption-aware', async () => {
  let attempts = 0;
  await expect(
    waitForTcp(1, {
      timeout: 15,
      connect: async () => {
        attempts++;
        throw new Error('offline');
      },
    }),
  ).rejects.toThrow(/readiness/);
  expect(attempts).toBeGreaterThan(0);
  const controller = new AbortController();
  controller.abort();
  await expect(waitForTcp(1, { signal: controller.signal })).rejects.toThrow(/Interrupted/);
});
test('private Docker env file is mode0600 outside evidence and is completely removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-private-unit-'));
  let envFile;
  try {
    const services = await createServices({
      root,
      output: root,
      env: {},
      fixture: { ...fixture },
      execute: async (_command, args) => {
        envFile = args[args.indexOf('--env-file') + 1];
        return { stdout: fixture.containerId, exitCode: 0 };
      },
    });
    await services.createContainer();
    expect(path.dirname(envFile)).not.toBe(root);
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(envFile, 'utf8')).toContain(`POSTGRES_PASSWORD=${fixture.password}`);
    await services.removePrivate();
    await expect(stat(path.dirname(envFile))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (envFile) await rm(path.dirname(envFile), { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('private configuration refuses a temporary base inside the repository', async () => {
  const root = await realpath(os.tmpdir());
  let services;
  try {
    await expect(
      createServices({ root, output: root, env: {}, fixture: { ...fixture } }).then((value) => {
        services = value;
        return value;
      }),
    ).rejects.toThrow(/outside repository/);
  } finally {
    await services?.removePrivate();
  }
});

test('real spawned child failure preserves exit code and split-chunk secret redaction', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-executor-unit-'));
  try {
    const execute = commandExecutor({ root, env: {}, secrets: ['synthetic-secret'] });
    const log = path.join(root, 'child.log');
    await expect(
      execute(
        process.execPath,
        [
          '-e',
          "process.stdout.write('synthetic-'); setTimeout(() => {process.stdout.write('secret\\npositive-control\\n');process.exit(7)}, 20)",
        ],
        { log },
      ),
    ).rejects.toMatchObject({ exitCode: 7 });
    const text = await readFile(log, 'utf8');
    expect(text).toContain('positive-control');
    expect(text).toContain('[REDACTED]');
    expect(text).not.toContain('synthetic-secret');
    await execute.stopChildren();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SIGTERM-ignoring owned child is force-drained within the interruption deadline, not browser timeout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-signal-unit-'));
  const execute = commandExecutor({ root, env: {} });
  const controller = new AbortController();
  let pending;
  try {
    pending = execute(
      process.execPath,
      [
        '-e',
        "process.on('SIGTERM', () => {});require('node:fs').writeFileSync('ready', 'ready');setInterval(() => {}, 1000)",
      ],
      { signal: controller.signal, timeout: 20_000 },
    ).catch(() => 'drained');
    while (true) {
      try {
        await stat(path.join(root, 'ready'));
        break;
      } catch {
        await delay(10);
      }
    }
    controller.abort();
    expect(await Promise.race([pending, delay(7000).then(() => 'deadline-exceeded')])).toBe(
      'drained',
    );
  } finally {
    await execute.stopChildren();
    await pending;
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('top-level inherited refusal occurs before output writes or services invocation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-refusal-unit-'));
  let called = false;
  try {
    await expect(
      runIsolated({
        root,
        env: { NODE_ENV: 'production' },
        services: async () => {
          called = true;
        },
      }),
    ).rejects.toThrow(/Inherited/);
    expect(called).toBe(false);
    await expect(stat(path.join(root, 'test-results'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('interruption between fixture readiness and build prevents children and still cleans resources', async () => {
  const services = fakeServices();
  const controller = new AbortController();
  services.signal = controller.signal;
  services.wait = async () => {
    services.calls.push('wait');
    controller.abort();
  };
  const report = await fixtureLifecycle({ ...fixture }, services, { phases: [], cleanup: [] });
  expect(report.exitCode).toBe(143);
  expect(services.calls).not.toContain('database-build');
  expect(services.calls.slice(-6)).toEqual([
    'children',
    'inspect',
    'remove-container',
    'inspect',
    'remove-volume',
    'private',
  ]);
});
