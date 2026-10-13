import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

class GuardError extends Error {}
function refuse(reason) {
  throw new GuardError(`HDD guard: ${reason}`);
}

function configuration(env) {
  const mount = env.POSTGRES_HDD_MOUNT;
  const data = env.POSTGRES_DATA_DIR;
  const uuid = env.POSTGRES_HDD_UUID;
  const uid = env.POSTGRES_DATA_UID;
  const safePath = (value) =>
    typeof value === 'string' &&
    path.isAbsolute(value) &&
    value !== '/' &&
    !value.includes('\0') &&
    path.normalize(value) === value &&
    !value.endsWith('/');
  if (
    !safePath(mount) ||
    !safePath(data) ||
    !data.startsWith(`${mount}/`) ||
    typeof uuid !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) ||
    typeof uid !== 'string' ||
    !/^[1-9][0-9]*$/.test(uid) ||
    !Number.isSafeInteger(Number(uid)) ||
    Number(uid) >= 4294967295
  ) {
    refuse('invalid configuration');
  }
  return { mount, data, uuid, uid: BigInt(uid) };
}

function inspectPaths(config, filesystem) {
  const { mount, data, uid } = config;
  try {
    if (data === repository || data.startsWith(`${repository}/`)) throw new Error();
    const paths = ['/'];
    for (const part of data.split('/').filter(Boolean)) {
      paths.push(path.join(paths.at(-1), part));
    }
    return paths.map((entry) => {
      const stat = filesystem.lstatSync(entry, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || filesystem.realpathSync(entry) !== entry)
        throw new Error();
      if ((entry === mount || entry.startsWith(`${mount}/`)) && (stat.mode & 0o022n) !== 0n)
        throw new Error();
      if (entry === data && (stat.uid !== uid || ![0o700n, 0o750n].includes(stat.mode & 0o7777n)))
        throw new Error();
      return { entry, stat };
    });
  } catch {
    refuse('unsafe or unavailable path');
  }
}

function probeMount(target, execute) {
  return execute(
    '/usr/bin/findmnt',
    ['--json', '--target', target, '--output', 'TARGET,UUID,FSTYPE,MAJ:MIN,FSROOT'],
    {
      encoding: 'utf8',
      timeout: 2000,
      killSignal: 'SIGKILL',
      maxBuffer: 16384,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
    },
  );
}

function deviceId(dev) {
  return `${((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)}:${(dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)}`;
}

function mounted(config, target, dev, probe) {
  try {
    const output = probe(target);
    if (typeof output !== 'string' || Buffer.byteLength(output) > 16384) throw new Error();
    const json = JSON.parse(output);
    if (!Array.isArray(json.filesystems) || json.filesystems.length !== 1) throw new Error();
    const row = json.filesystems[0];
    if (
      !row ||
      row.children !== undefined ||
      row.target !== config.mount ||
      row.uuid !== config.uuid ||
      row.fstype !== 'ext4' ||
      row.fsroot !== '/' ||
      row['maj:min'] !== deviceId(dev)
    )
      throw new Error();
  } catch {
    refuse('mount verification failed');
  }
}

// Dependency injection is parameter-only. The CLI never receives test dependencies.
export function verifyPostgresHdd(
  env,
  {
    execute = execFileSync,
    probe = (target) => probeMount(target, execute),
    filesystem = fs,
    rootDevice,
  } = {},
) {
  const config = configuration(env);
  const before = inspectPaths(config, filesystem);
  const mountStat = before.find(({ entry }) => entry === config.mount).stat;
  const dataStat = before.at(-1).stat;
  if (mountStat.dev === (rootDevice ?? before[0].stat.dev) || dataStat.dev !== mountStat.dev)
    refuse('mount verification failed');
  mounted(config, config.mount, mountStat.dev, probe);
  mounted(config, config.data, dataStat.dev, probe);
  const after = inspectPaths(config, filesystem);
  if (
    before.some(({ stat }, index) =>
      ['dev', 'ino', 'mode', 'uid', 'gid'].some((key) => stat[key] !== after[index].stat[key]),
    )
  )
    refuse('unsafe or unavailable path');
  return { verified: true };
}

export async function runGuarded(
  argv,
  {
    env = process.env,
    guardOptions,
    diagnostic = (message) => process.stderr.write(`${message}\n`),
  } = {},
) {
  const check = argv.length === 1 && argv[0] === '--check';
  const launch =
    argv.length >= 2 &&
    argv[0] === '--' &&
    argv.slice(1).every((arg) => typeof arg === 'string' && !arg.includes('\0')) &&
    argv[1].length > 0;
  if (!check && !launch) {
    diagnostic('HDD guard: invalid CLI');
    return { code: 1, signal: null };
  }
  try {
    verifyPostgresHdd(env, guardOptions);
  } catch (error) {
    diagnostic(error instanceof GuardError ? error.message : 'HDD guard: verification failed');
    return { code: 1, signal: null };
  }
  if (check) return { code: 0, signal: null };
  return new Promise((resolve) => {
    let child;
    let escalation;
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const forward = (signal) => {
      child.kill(signal);
      // Bound interruption drain even if the trusted foreground child ignores it.
      escalation ??= setTimeout(() => child.kill('SIGKILL'), 2000);
      escalation.unref();
    };
    const handlers = signals.map((signal) => () => forward(signal));
    const finish = (result) => {
      clearTimeout(escalation);
      signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
      resolve(result);
    };
    try {
      child = spawn(argv[1], argv.slice(2), {
        shell: false,
        detached: false,
        stdio: 'inherit',
        env,
      });
      signals.forEach((signal, index) => process.on(signal, handlers[index]));
      child.once('error', () => {
        diagnostic('HDD guard: child launch failed');
        finish({ code: 1, signal: null });
      });
      child.once('exit', (code, signal) => finish({ code, signal }));
    } catch {
      diagnostic('HDD guard: child launch failed');
      finish({ code: 1, signal: null });
    }
  });
}

export async function main(argv = process.argv.slice(2), options) {
  const { code, signal } = await runGuarded(argv, options);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code;
}

if (import.meta.main) {
  await main();
}
