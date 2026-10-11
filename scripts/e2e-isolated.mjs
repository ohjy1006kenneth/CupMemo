import { randomBytes } from 'node:crypto';
/* global AbortController */
import { setTimeout, clearTimeout } from 'node:timers';
import { lstat, realpath, mkdir, mkdtemp, writeFile, readFile, rm, rmdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function validateEnvironment(env) {
  if (env.NODE_ENV === 'production') throw new Error('Inherited configuration refused: NODE_ENV');
  for (const key of [
    'DATABASE_URL',
    'CUPMEMO_DB_ENV',
    'CUPMEMO_DATABASE_URL_TEST',
    'CUPMEMO_DATABASE_URL_DEVELOPMENT',
    'CUPMEMO_DATABASE_URL_PRODUCTION',
    'CUPMEMO_TEST_DATABASE',
  ]) {
    if (env[key]) throw new Error(`Inherited configuration refused: ${key}`);
  }
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function resolveOutput(root, args) {
  if (args.length > 1 || args.some((arg) => !arg.startsWith('--output=') || arg.length === 9)) {
    throw new Error('Only one --output=<new test-results directory> is supported');
  }
  root = await realpath(root);
  const boundary = path.join(root, 'test-results');
  const target = path.resolve(
    root,
    args[0]?.slice(9) ?? `test-results/e2e-isolated/${randomBytes(16).toString('hex')}`,
  );
  if (!contained(boundary, target))
    throw new Error('Output must be inside repository test-results');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('Output path must not contain symlinks or files');
      if (current === target)
        throw new Error('Output already exists; evidence is never overwritten');
      if (!contained(root, await realpath(current))) throw new Error('Output escapes repository');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}
export function childEnvironment(env, fixture) {
  // Allowlist tool/runtime configuration; do not carry libpq, app, NODE_OPTIONS,
  // dotenv preload or operator credentials into the disposable fixture.
  const child = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'COREPACK_HOME', 'PNPM_HOME']) {
    if (env[key]) child[key] = env[key];
  }
  return {
    ...child,
    CUPMEMO_DB_ENV: 'test',
    CUPMEMO_TEST_DATABASE: fixture.database,
    CUPMEMO_DATABASE_URL_TEST: `postgresql://${fixture.role}:${fixture.password}@127.0.0.1:${fixture.pgPort}/${fixture.database}`,
    BETTER_AUTH_SECRET: fixture.secret,
    BETTER_AUTH_URL: `http://127.0.0.1:${fixture.webPort}`,
    CUPMEMO_API_ORIGIN: `http://127.0.0.1:${fixture.apiPort}`,
  };
}
export function verifyIdentity(row, fixture) {
  if (
    row?.database !== fixture.database ||
    row?.role !== fixture.role ||
    row?.version !== '17.6' ||
    row?.search_path !== 'public'
  ) {
    throw new Error('Authenticated fixture identity mismatch');
  }
  return true;
}

export function verifyOwnership(container, volume, fixture) {
  const owned = (labels) =>
    labels?.['org.cupmemo.owner'] === 'e2e-isolated' && labels?.['org.cupmemo.run'] === fixture.run;
  if (
    !volume ||
    volume.Name !== fixture.volume ||
    volume.Driver !== 'local' ||
    !owned(volume.Labels) ||
    (fixture.mountpoint && volume.Mountpoint !== fixture.mountpoint)
  ) {
    throw new Error('Fixture volume ownership mismatch; deletion refused');
  }
  if (container) {
    const bindings = container.Ports?.['5432/tcp'];
    if (
      container.Id !== fixture.containerId ||
      container.Name !== `/${fixture.containerName}` ||
      !owned(container.Labels) ||
      container.Mounts?.length !== 1 ||
      container.Mounts[0].Type !== 'volume' ||
      container.Mounts[0].Name !== fixture.volume ||
      container.Mounts[0].Destination !== '/var/lib/postgresql/data' ||
      (fixture.mountpoint && container.Mounts[0].Source !== fixture.mountpoint) ||
      bindings?.length !== 1 ||
      bindings[0].HostIp !== '127.0.0.1' ||
      bindings[0].HostPort !== String(fixture.pgPort)
    ) {
      throw new Error('Fixture container ownership mismatch; deletion refused');
    }
  }
  return true;
}

export async function fixtureLifecycle(fixture, services, report) {
  let phase;
  let createdVolume = false;
  let createdContainer = false;
  const run = async (name, action) => {
    phase = name;
    const entry = { name, status: 'running' };
    report.phases.push(entry);
    try {
      if (services.signal?.aborted) throw new Error('Interrupted');
      const result = await action();
      entry.exitCode = result?.exitCode ?? 0;
      if (entry.exitCode !== 0)
        throw Object.assign(new Error('Child failed'), { exitCode: entry.exitCode });
      entry.status = 'passed';
      return result;
    } catch (error) {
      entry.status = 'failed';
      entry.exitCode = error.exitCode ?? 1;
      throw error;
    }
  };
  report.exitCode = 1;
  try {
    await run('volume', async () => {
      const name = await services.createVolume();
      createdVolume = true;
      if (name !== fixture.volume) throw new Error('Volume identity mismatch');
    });
    await run('container', async () => {
      fixture.containerId = await services.createContainer();
      createdContainer = true;
      if (!/^[a-f0-9]{64}$/.test(fixture.containerId))
        throw new Error('Container identity mismatch');
    });
    await run('ownership', async () => {
      const state = await services.inspect();
      if (!state.container) throw new Error('Container missing');
      verifyOwnership(state.container, state.volume, fixture);
      fixture.mountpoint = state.volume.Mountpoint;
      report.ownership = state;
    });
    await run('start', () => services.start());
    await run('wait', () => services.wait());
    await run('database-build', () => services.command('database-build'));
    await run('identity', async () => {
      const identity = await services.identity();
      report.identity = identity;
      verifyIdentity(identity, fixture);
    });
    for (const name of ['migrate-1', 'migrate-2', 'status', 'browser'])
      await run(name, () => services.command(name));
    report.exitCode = 0;
  } catch {
    report.failedPhase = phase;
    report.exitCode = services.signal?.aborted ? 143 : 1;
  } finally {
    createdContainer ||= Boolean(fixture.containerId);
    const cleanup = async (name, action) => {
      try {
        await action();
        report.cleanup.push({ name, status: 'passed' });
        return true;
      } catch {
        report.cleanup.push({ name, status: 'failed' });
        report.exitCode = report.exitCode || 1;
        return false;
      }
    };
    const drained = await cleanup('children', () => services.stopChildren());
    if (createdVolume && drained)
      await cleanup('resources', async () => {
        const state = await services.inspect();
        if (!state.volume) throw new Error('Volume missing; ownership cannot be verified');
        verifyOwnership(createdContainer ? state.container : null, state.volume, fixture);
        if (createdContainer && state.container) await services.removeContainer();
        else if (createdContainer) report.cleanup.push({ name: 'container', status: 'missing' });
        // Fresh volume readback after exact container removal prevents stale deletion authority.
        const after = await services.inspect();
        if (after.container) throw new Error('Container removal not verified');
        verifyOwnership(null, after.volume, fixture);
        await services.removeVolume();
      });
    await cleanup('private-files', () => services.removePrivate());
  }
  return report;
}

async function bind(port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    return server;
  } catch {
    throw new Error('Loopback port occupied or unavailable; listener left untouched');
  }
}
export async function assertPortsFree(ports) {
  const servers = [];
  try {
    for (const port of ports) servers.push(await bind(port));
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}
async function tcpConnect(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once('connect', () => finish());
    socket.once('error', finish);
    socket.setTimeout(500, () => finish(new Error('TCP timeout')));
  });
}
export async function waitForTcp(port, { timeout = 60_000, signal, connect = tcpConnect } = {}) {
  const deadline = Date.now() + timeout;
  do {
    if (signal?.aborted) throw new Error('Interrupted');
    try {
      await connect(port);
      return;
    } catch {
      /* Initialization may still be in progress. */
    }
    if (Date.now() < deadline) await delay(Math.min(100, deadline - Date.now()));
  } while (Date.now() < deadline);
  throw new Error('PostgreSQL TCP readiness deadline exceeded');
}

// No side effects at import time. Subprocess injection is an exported test seam,
// not a CLI option and never alters the application's behavior.
export function commandExecutor({ root, env, secrets = [], children = new Set() }) {
  const redact = (text) =>
    secrets.reduce((value, secret) => value.replaceAll(secret, '[REDACTED]'), text);
  const kill = (pid, signal) => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const stop = async (pid) => {
    kill(pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(-pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') return;
        throw error;
      }
      await delay(50);
    }
    kill(pid, 'SIGKILL');
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        process.kill(-pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') return;
        throw error;
      }
      await delay(50);
    }
    throw new Error('Owned process group did not drain');
  };
  const execute = async (command, args, { log, signal, timeout = 120_000 } = {}) => {
    if (signal?.aborted) throw new Error('Interrupted');
    const stream = log ? createWriteStream(log, { flags: 'wx', mode: 0o600 }) : null;
    const child = spawn(command, args, {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.pid) children.add(child.pid);
    let stdout = '';
    let pendingOut = '';
    let pendingErr = '';
    let terminated = false;
    const flush = (text) => {
      if (stream) stream.write(redact(text));
    };
    const chunks = (text, pending) => {
      const combined = pending + text;
      const last = combined.lastIndexOf('\n');
      if (last < 0) return combined;
      flush(combined.slice(0, last + 1));
      return combined.slice(last + 1);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      pendingOut = chunks(String(chunk), pendingOut);
    });
    child.stderr.on('data', (chunk) => {
      pendingErr = chunks(String(chunk), pendingErr);
    });
    let force;
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      if (child.pid) kill(child.pid, 'SIGTERM');
      force = setTimeout(() => {
        if (child.pid) kill(child.pid, 'SIGKILL');
      }, 5000);
    };
    signal?.addEventListener('abort', terminate, { once: true });
    const timer = setTimeout(terminate, timeout);

    let result;
    try {
      result = await new Promise((resolve, reject) => {
        child.once('error', () => reject(new Error('Child launch failed')));
        child.once('close', (code, exitSignal) =>
          resolve({ exitCode: code ?? 1, signal: exitSignal, stdout }),
        );
      });
    } finally {
      clearTimeout(timer);
      clearTimeout(force);
      signal?.removeEventListener('abort', terminate);
      flush(pendingOut);
      flush(pendingErr);
      if (stream) {
        stream.end();
        await once(stream, 'finish');
      }
      if (child.pid) {
        await stop(child.pid);
        children.delete(child.pid);
      }
    }
    if (result.exitCode !== 0 || terminated)
      throw Object.assign(new Error('Owned child failed; consult sanitized phase log'), {
        exitCode: result.exitCode || 1,
      });
    return result;
  };
  execute.stopChildren = async () => {
    for (const pid of children) {
      await stop(pid);
      children.delete(pid);
    }
  };
  return execute;
}

export async function createServices({
  root,
  output,
  env,
  fixture,
  signal,
  execute: injectedExecute,
}) {
  const privateBase = await realpath(os.tmpdir());
  const repository = await realpath(root);
  if (privateBase === repository || contained(repository, privateBase))
    throw new Error('Private temporary configuration must be outside repository');
  const privateDir = await mkdtemp(path.join(privateBase, 'cupmemo-e2e-private-'));
  const envFile = path.join(privateDir, 'postgres.env');
  const cidFile = path.join(privateDir, 'container.id');
  try {
    await writeFile(
      envFile,
      `POSTGRES_DB=${fixture.database}\nPOSTGRES_USER=${fixture.role}\nPOSTGRES_PASSWORD=${fixture.password}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  } catch {
    await rm(envFile, { force: true });
    await rmdir(privateDir);
    throw new Error('Private configuration creation failed');
  }
  const execute =
    injectedExecute ??
    commandExecutor({
      root,
      env: childEnvironment(env, fixture),
      secrets: [fixture.password, fixture.secret],
    });
  let serial = 0;
  // Fixed local socket: inherited Docker contexts/hosts cannot retarget cleanup.
  const docker = async (args) =>
    (
      await execute('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
        log: path.join(output, `docker-${++serial}.log`),
      })
    ).stdout.trim();
  const labels = [
    '--label',
    'org.cupmemo.owner=e2e-isolated',
    '--label',
    `org.cupmemo.run=${fixture.run}`,
  ];
  const inspect = async () => {
    const ids = await docker([
      'container',
      'ls',
      '-a',
      '--no-trunc',
      '--filter',
      `name=^/${fixture.containerName}$`,
      '--format',
      '{{.ID}}',
    ]);
    let container = null;
    if (ids) {
      if (ids !== fixture.containerId) throw new Error('Container ownership mismatch');
      const format =
        '{"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}},"Mounts":{{json .Mounts}},"Ports":{{json .HostConfig.PortBindings}},"PublishedPorts":{{json .NetworkSettings.Ports}}}';
      container = JSON.parse(
        await docker(['container', 'inspect', '--format', format, fixture.containerId]),
      );
    }
    const volumes = await docker([
      'volume',
      'ls',
      '--filter',
      `name=^${fixture.volume}$`,
      '--format',
      '{{.Name}}',
    ]);
    const volume = volumes
      ? JSON.parse(
          await docker([
            'volume',
            'inspect',
            '--format',
            '{"Name":{{json .Name}},"Labels":{{json .Labels}},"Mountpoint":{{json .Mountpoint}},"Driver":{{json .Driver}}}',
            fixture.volume,
          ]),
        )
      : null;
    return { container, volume };
  };
  return {
    signal,
    inspect,
    createVolume: () => docker(['volume', 'create', ...labels, fixture.volume]),
    createContainer: async () => {
      try {
        return await docker([
          'container',
          'create',
          '--name',
          fixture.containerName,
          '--cidfile',
          cidFile,
          ...labels,
          '--env-file',
          envFile,
          '--publish',
          `127.0.0.1:${fixture.pgPort}:5432`,
          '--mount',
          `type=volume,source=${fixture.volume},target=/var/lib/postgresql/data`,
          'postgres:17.6',
          '-c',
          'search_path=public',
        ]);
      } catch (error) {
        try {
          fixture.containerId = (await readFile(cidFile, 'utf8')).trim();
        } catch {
          /* No creation identity available. */
        }
        throw error;
      }
    },
    start: async () => {
      await assertPortsFree([fixture.pgPort, fixture.webPort, fixture.apiPort]);
      await docker(['container', 'start', fixture.containerId]);
    },
    wait: async () => {
      await waitForTcp(fixture.pgPort, { signal });
      const state = await inspect();
      verifyOwnership(state.container, state.volume, fixture);
      verifyOwnership(
        { ...state.container, Ports: state.container.PublishedPorts },
        state.volume,
        fixture,
      );
    },
    identity: async () => {
      const { createDatabase } = await import(path.join(root, 'packages/database/dist/index.js'));
      const connection = createDatabase(childEnvironment(env, fixture).CUPMEMO_DATABASE_URL_TEST, {
        max: 1,
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
        statement_timeout: 1500,
      });
      try {
        const result = await connection.pool.query(
          "SELECT current_database() AS database, current_user AS role, split_part(current_setting('server_version'), ' ', 1) AS version, current_setting('server_version') AS build, current_setting('search_path') AS search_path",
        );
        return result.rows[0];
      } finally {
        await connection.close();
      }
    },
    command: async (name) => {
      const args = {
        'database-build': ['pnpm', '--filter', '@cupmemo/database', 'build'],
        'migrate-1': ['pnpm', 'db:migrate'],
        'migrate-2': ['pnpm', 'db:migrate'],
        status: ['pnpm', 'db:status'],
        browser: ['pnpm', 'auth:test:e2e', `--output=${path.join(output, 'browser')}`],
      }[name];
      if (!args) throw new Error('Unknown phase');
      const result = await execute('corepack', args, {
        signal,
        timeout: name === 'browser' ? 1800_000 : 120_000,
        log: path.join(output, `${name}.log`),
      });
      if (name === 'status' && !result.stdout.includes('Migration status: current (3/3 applied).'))
        throw new Error('Migration status mismatch');
      if (name === 'browser' && !/\b81 passed\b/.test(result.stdout))
        throw new Error('Browser baseline count mismatch');
      return { exitCode: result.exitCode };
    },
    stopChildren: () => execute.stopChildren?.(),
    removeContainer: async () => {
      await docker(['container', 'rm', '--force', fixture.containerId]);
      if ((await inspect()).container) throw new Error('Owned container removal failed');
    },
    removeVolume: async () => {
      await docker(['volume', 'rm', fixture.volume]);
      if ((await inspect()).volume) throw new Error('Owned volume removal failed');
    },
    removePrivate: async () => {
      await rm(envFile);
      await rm(cidFile, { force: true });
      await rmdir(privateDir);
    },
  };
}

export async function runIsolated({
  root = fileURLToPath(new URL('../', import.meta.url)),
  args = [],
  env = process.env,
  signal,
  services: injectedServices,
} = {}) {
  validateEnvironment(env);
  const output = await resolveOutput(root, args);
  const listeners = [];
  let ports;
  try {
    for (let index = 0; index < 3; index++) listeners.push(await bind(0));
    ports = listeners.map((server) => server.address().port);
  } finally {
    await Promise.all(listeners.map((server) => new Promise((resolve) => server.close(resolve))));
  }
  await assertPortsFree(ports);
  // Exclusive leaf reservation; refused output paths never delete existing data.
  await mkdir(path.dirname(output), { recursive: true });
  await resolveOutput(root, [`--output=${output}`]);
  await mkdir(output, { mode: 0o700 });
  const run = randomBytes(16).toString('hex');
  const fixture = {
    run,
    database: `cupmemo_test_${run}`,
    role: `cupmemo_test_${run}`,
    containerName: `cupmemo-e2e-${run}`,
    volume: `cupmemo-e2e-${run}-data`,
    pgPort: ports[0],
    webPort: ports[1],
    apiPort: ports[2],
    password: randomBytes(32).toString('hex'),
    secret: randomBytes(32).toString('hex'),
  };
  const report = {
    run,
    output,
    phases: [],
    cleanup: [],
    database: fixture.database,
    role: fixture.role,
    containerName: fixture.containerName,
    volume: fixture.volume,
    ports: { postgres: fixture.pgPort, web: fixture.webPort, api: fixture.apiPort },
    browserOutput: path.join(output, 'browser'),
    exitCode: 1,
  };
  try {
    const git = commandExecutor({ root, env: childEnvironment(env, fixture) });
    try {
      report.commit = (await git('git', ['rev-parse', 'HEAD'])).stdout.trim();
      report.tree = (await git('git', ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    } catch {
      report.git = 'unavailable';
    }
    const services = injectedServices
      ? await injectedServices({ root, output, env, fixture, signal })
      : await createServices({ root, output, env, fixture, signal });
    await fixtureLifecycle(fixture, services, report);
    report.containerId = fixture.containerId;
    await assertPortsFree(ports);
    report.portsReleased = true;
  } catch {
    report.exitCode = 1;
    report.failedPhase ??= 'setup-or-final-verification';
  }
  report.recovery = report.cleanup.some((item) => item.status === 'failed')
    ? `Verify report ownership labels/run ${run}, container ID ${fixture.containerId ?? 'unavailable'} and volume ${fixture.volume} before any manual removal. See docs/E2E.md. Do not prune or remove by wildcard.`
    : null;
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    const report = await runIsolated({ args: process.argv.slice(2), signal: controller.signal });
    process.stdout.write(
      `Isolated E2E exit ${report.exitCode}; report: ${path.join(report.output, 'report.json')}\n`,
    );
    process.exitCode = report.exitCode;
  } catch (error) {
    // Only preflight errors have safe, runner-authored diagnostics.
    process.stderr.write(`Isolated E2E refused: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
