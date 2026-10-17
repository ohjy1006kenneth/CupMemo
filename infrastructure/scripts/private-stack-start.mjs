import process from 'node:process';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawn as spawnChild } from 'node:child_process';
import { constants } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';
import { verifyPostgresHdd } from './postgres-hdd-guard.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
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
const component = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const registry = '(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)';
const image = new RegExp(
  `^(?:sha256:|${registry}?${component}(?:/${component})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?@sha256:)[a-f0-9]{64}$`,
);

function configuration(env) {
  // Snapshot only explicitly required strings; use the same data/UID for guard and child.
  const settings = Object.fromEntries(required.map((key) => [key, env[key]]));
  if (
    required.some(
      (key) =>
        typeof settings[key] !== 'string' ||
        settings[key].trim().length === 0 ||
        /\p{Cc}/u.test(settings[key]),
    )
  )
    throw new Error();
  if (composeKeys.slice(0, 3).some((key) => !image.test(settings[key]))) throw new Error();
  for (const key of [
    'CUPMEMO_API_ENV_FILE',
    'POSTGRES_PASSWORD_FILE',
    'CUPMEMO_DOCKER_CONFIG_DIR',
  ]) {
    const value = settings[key];
    if (
      !path.isAbsolute(value) ||
      value === '/' ||
      path.normalize(value) !== value ||
      value.endsWith('/') ||
      value === repository ||
      value.startsWith(`${repository}/`)
    )
      throw new Error();
  }
  return settings;
}

// All test injection is parameter-only; the production CLI cannot replace transport or guard.
export async function runPrivateStack(
  argv,
  {
    env = process.env,
    guardOptions,
    spawn = spawnChild,
    signals = process,
    diagnostic = (message) => process.stderr.write(`${message}\n`),
  } = {},
) {
  if (argv.length !== 1 || argv[0] !== '--start') {
    diagnostic('Private stack: invalid CLI');
    return { code: 1, signal: null };
  }
  let settings;
  try {
    settings = configuration(env);
  } catch {
    diagnostic('Private stack: invalid configuration');
    return { code: 1, signal: null };
  }
  try {
    verifyPostgresHdd(settings, guardOptions);
  } catch {
    diagnostic('Private stack: HDD verification refused');
    return { code: 1, signal: null };
  }
  const childEnv = Object.fromEntries(composeKeys.map((key) => [key, settings[key]]));
  Object.assign(childEnv, { PATH: '/usr/bin:/bin', LC_ALL: 'C', COMPOSE_DISABLE_ENV_FILE: '1' });
  diagnostic('Private stack: launching');
  return new Promise((resolve) => {
    let child, escalation;
    let settled = false;
    const forwarded = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const finish = (result, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(escalation);
      forwarded.forEach((signal, index) => signals.removeListener(signal, handlers[index]));
      diagnostic(message);
      resolve(result);
    };
    const failed = () => finish({ code: 1, signal: null }, 'Private stack: child launch failed');
    const kill = (signal) => {
      try {
        child.kill(signal);
      } catch {
        failed();
      }
    };
    const handlers = forwarded.map((signal) => () => {
      if (settled) return;
      kill(signal);
      if (!settled && !escalation) {
        escalation = setTimeout(() => kill('SIGKILL'), 2000);
        escalation.unref();
      }
    });
    try {
      child = spawn(
        '/usr/bin/docker',
        [
          '--host',
          'unix:///var/run/docker.sock',
          '--config',
          settings.CUPMEMO_DOCKER_CONFIG_DIR,
          'compose',
          '--env-file',
          '/dev/null',
          '--project-name',
          'cupmemo-private',
          '--file',
          `${repository}/infrastructure/docker/production.compose.yml`,
          'up',
          '--no-build',
          '--pull',
          'never',
          '--abort-on-container-failure',
        ],
        { shell: false, detached: false, stdio: 'ignore', env: childEnv },
      );
      forwarded.forEach((signal, index) => signals.on(signal, handlers[index]));
      child.once('error', failed);
      child.once('exit', (code, signal) => {
        if (signal && Object.hasOwn(constants.signals, signal)) {
          finish({ code: null, signal }, `Private stack: child signal ${signal}`);
        } else if (signal === null && Number.isInteger(code) && code >= 0 && code <= 255) {
          finish({ code, signal: null }, `Private stack: child exit ${code}`);
        } else failed();
      });
    } catch {
      failed();
    }
  });
}

export async function main(argv = process.argv.slice(2), options) {
  const { code, signal } = await runPrivateStack(argv, options);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code;
}

if (import.meta.main) await main();
