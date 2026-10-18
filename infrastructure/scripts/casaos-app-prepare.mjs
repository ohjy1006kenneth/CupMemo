import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  fchmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const keys = [
  'CUPMEMO_WEB_IMAGE',
  'CUPMEMO_API_IMAGE',
  'CUPMEMO_POSTGRES_IMAGE',
  'POSTGRES_DATA_UID',
  'POSTGRES_HDD_UUID',
  'POSTGRES_HDD_MOUNT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_DATA_DIR',
  'POSTGRES_PASSWORD_FILE',
  'CUPMEMO_DATABASE_URL_PRODUCTION',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
];
const component = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const registry = '(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]+)?/)';
const image = new RegExp(
  `^(?:sha256:|${registry}?${component}(?:/${component})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?@sha256:)[a-f0-9]{64}$`,
);

function absolute(value) {
  if (
    !path.isAbsolute(value) ||
    value === '/' ||
    path.normalize(value) !== value ||
    value.endsWith('/') ||
    /\p{Cc}/u.test(value)
  )
    throw new Error();
}

function privateParent(file) {
  absolute(file);
  const parent = path.dirname(file);
  if (realpathSync(parent) !== parent) throw new Error();
  const stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700)
    throw new Error();
}

export function prepareCasaosApp(config, output) {
  privateParent(config);
  privateParent(output);
  let input;
  try {
    input = openSync(config, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(input);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid() ||
      ![0o400, 0o600].includes(stat.mode & 0o7777) ||
      stat.size > 65536
    )
      throw new Error();
    const settings = JSON.parse(readFileSync(input, 'utf8'));
    if (
      !settings ||
      Array.isArray(settings) ||
      Object.keys(settings).length !== keys.length ||
      keys.some(
        (key) =>
          !Object.hasOwn(settings, key) ||
          typeof settings[key] !== 'string' ||
          !settings[key].trim() ||
          settings[key].includes('\0') ||
          !settings[key].isWellFormed(),
      )
    )
      throw new Error();
    if (keys.slice(0, 3).some((key) => !image.test(settings[key]))) throw new Error();
    if (
      !/^[1-9][0-9]*$/.test(settings.POSTGRES_DATA_UID) ||
      Number(settings.POSTGRES_DATA_UID) > 4294967294
    )
      throw new Error();
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(settings.POSTGRES_HDD_UUID))
      throw new Error();
    for (const key of ['POSTGRES_HDD_MOUNT', 'POSTGRES_DATA_DIR', 'POSTGRES_PASSWORD_FILE']) {
      const value = settings[key];
      absolute(value);
      if (value === repository || value.startsWith(`${repository}/`)) throw new Error();
    }
    if (!settings.POSTGRES_DATA_DIR.startsWith(`${settings.POSTGRES_HDD_MOUNT}/`))
      throw new Error();
    const source = readFileSync(new URL('../casaos/docker-compose.yml', import.meta.url), 'utf8');
    // Stock install interpolates, marshals that model to disk, then reloads it.
    // Keep one Compose escape in the retained file for every literal dollar,
    // including the PG healthcheck's container-side variable references.
    const rendered = source
      .replaceAll('$$', () => '$$$$')
      .replace(/\$\{([A-Z_]+):\?[^}\n]*\}/g, (_, key) => {
        if (!keys.includes(key)) throw new Error();
        // A quoted JSON string is also a YAML scalar: no YAML or service injection.
        return JSON.stringify(settings[key].replaceAll('$', () => '$$$$')).replace(
          /[\u0085\u2028\u2029]/gu,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
        );
      });
    const fd = openSync(
      output,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, rendered);
    } finally {
      closeSync(fd);
    }
  } finally {
    if (input !== undefined) closeSync(input);
  }
}

export function main(argv) {
  try {
    if (argv.length !== 4 || argv[0] !== '--config' || argv[2] !== '--output') throw new Error();
    prepareCasaosApp(argv[1], argv[3]);
    process.stderr.write('CasaOS app: private configuration prepared\n');
    return 0;
  } catch {
    process.stderr.write('CasaOS app: preparation refused\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
