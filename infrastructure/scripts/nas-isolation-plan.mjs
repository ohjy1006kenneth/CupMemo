import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import { fileURLToPath, URL } from 'node:url';

const HDD = '/DATA/nas';
const UUID = '68391fd3-3c92-4cfe-82db-47a5e6abb2ee';
const SSD_UUID = '493d6733-2a8b-482b-b39f-a7ecc1ce8863';
const SAMBA_ROOT = '/etc/samba/smb.conf';
const SAMBA_SOURCE = '/etc/samba/smb.casa.conf';
const COMPOSE_SOURCE = '/var/lib/casaos/apps/local-syncthing/docker-compose.yml';
const REPOSITORY = '/home/juyoungoh/CupMemo';
const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const LIMIT = 65536;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
class PlanError extends Error {}
function refuse(reason) {
  throw new PlanError(`NAS isolation: ${reason}`);
}

export function transformSamba(text) {
  if (typeof text !== 'string' || text.includes('\0') || text.includes('\\'))
    refuse('unsupported Samba source');
  const sections = new Set();
  let keys = new Set();
  let nas = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^[ \t]*[#;]/.test(line)) continue;
    const section = line.match(/^[ \t]*\[([^\]\r\n]+)\][ \t]*$/);
    if (section) {
      const name = section[1].toLowerCase();
      if (sections.has(name) || (name === 'nas' && section[1] !== 'nas'))
        refuse('unsupported Samba source');
      sections.add(name);
      keys = new Set();
      if (name === 'nas') nas++;
    } else {
      const directive = line.match(/^[ \t]*([^=]+?)\s*=.*$/);
      if (!directive || !sections.size) refuse('unsupported Samba source');
      const key = directive[1].trim().toLowerCase().replace(/\s+/g, ' ');
      if (keys.has(key) || ['include', 'veto files', 'copy'].includes(key))
        refuse('unsupported Samba source');
      keys.add(key);
    }
  }
  if (nas !== 1 || !/^[ \t]*\[nas\][ \t]*\r?\n/m.test(text)) refuse('unsupported Samba source');
  return text.replace(/^([ \t]*\[nas\][ \t]*)(\r?\n)/m, '$1$2  veto files = /cupmemo/$2');
}

export function transformSyncthing(text) {
  if (typeof text !== 'string' || /[\t\0$&*!{}]/.test(text)) refuse('unsupported Compose source');
  const lines = text.split(/\r?\n/);
  const scopes = [];
  let services = false;
  let service = false;
  let volumes = false;
  let target = -1;
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || /^[ ]*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const mapping = line.match(/^ *(\w[\w-]*):(?: .*|)$/);
    if (mapping) {
      while (scopes.length && scopes.at(-1).indent > indent) scopes.pop();
      if (!scopes.length || scopes.at(-1).indent < indent) scopes.push({ indent, keys: new Set() });
      if (scopes.at(-1).keys.has(mapping[1])) refuse('unsupported Compose source');
      scopes.at(-1).keys.add(mapping[1]);
      if (indent === 0) {
        services = line === 'services:';
        service = false;
      }
      if (services && indent === 2) {
        if (line !== '  big-bear-syncthing:') refuse('unsupported Compose source');
        service = true;
      }
      if (service && indent === 4) volumes = line === '    volumes:';
      if (volumes && indent > 4) refuse('unsupported Compose source'); // long form not supported
    } else if (volumes && service && indent === 6) {
      const mount = line.match(/^ {6}- (["']?)(\/[^\s"']+)\1$/);
      if (!mount) refuse('unsupported Compose source');
      if (mount[2].includes('/DATA/nas')) {
        if (target !== -1 || !/^\/DATA\/nas:\/DATA\/nas(?::rw)?$/.test(mount[2]))
          refuse('unsupported Compose source');
        target = index;
      }
    } else if (!mapping) refuse('unsupported Compose source');
  }
  if (target === -1) refuse('unsupported Compose source');
  return text.replace(
    lines[target],
    lines[target].replace('/DATA/nas:/DATA/nas', '/DATA/nas/University:/DATA/nas/University'),
  );
}

function probe(execute, command, args, input) {
  try {
    const value = execute(command, args, {
      encoding: 'utf8',
      timeout: 2000,
      killSignal: 'SIGKILL',
      maxBuffer: LIMIT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { LC_ALL: 'C', PATH: '/usr/bin:/bin', HOME: '/nonexistent' },
      ...(input === undefined ? {} : { input }),
    });
    if (typeof value !== 'string' || Buffer.byteLength(value) > LIMIT) throw new Error();
    return value;
  } catch {
    refuse('probe failed');
  }
}

function device(dev) {
  return `${((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)}:${(dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)}`;
}

function mount(entry, execute) {
  try {
    const value = JSON.parse(
      probe(execute, '/usr/bin/findmnt', [
        '--json',
        '--target',
        entry,
        '--output',
        'TARGET,UUID,FSTYPE,MAJ:MIN,FSROOT',
      ]),
    );
    if (
      !Array.isArray(value.filesystems) ||
      value.filesystems.length !== 1 ||
      value.filesystems[0].children !== undefined
    )
      throw new Error();
    return value.filesystems[0];
  } catch {
    refuse('mount verification failed');
  }
}

function inspect(entry, filesystem, directory = true) {
  try {
    const parts = entry.split('/').filter(Boolean);
    for (let index = 0; index <= parts.length; index++) {
      const current = '/' + parts.slice(0, index).join('/');
      const stat = filesystem.lstatSync(current, { bigint: true });
      if (
        stat.isSymbolicLink() ||
        filesystem.realpathSync(current) !== current ||
        (index < parts.length && !stat.isDirectory())
      )
        throw new Error();
    }
    const stat = filesystem.lstatSync(entry, { bigint: true });
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error();
    return stat;
  } catch {
    refuse('unsafe or unavailable path');
  }
}

function identity(stat) {
  return Object.fromEntries(
    ['dev', 'ino', 'mode', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [
      key,
      String(stat[key]),
    ]),
  );
}

function acl(entry, stat, execute) {
  const perms = (n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
  const mode = Number(stat.mode & 0o777n);
  const expected = `user::${perms(mode >> 6)}\ngroup::${perms(mode >> 3)}\nother::${perms(mode)}`;
  if (
    probe(execute, '/usr/bin/getfacl', ['--omit-header', '--numeric', '--', entry]).trim() !==
    expected
  )
    refuse('ACL verification failed');
}

function rootSnapshot(filesystem, execute) {
  const entries = ['/', '/DATA', HDD, `${HDD}/Photos`, `${HDD}/Projects`, `${HDD}/University`];
  const snapshot = {};
  const stats = entries.map((entry) => inspect(entry, filesystem));
  for (const [index, entry] of entries.entries()) {
    const stat = stats[index];
    const mode = stat.mode & 0o7777n;
    if (index <= 1 && (stat.uid !== 0n || stat.gid !== 0n || (mode & 0o7022n) !== 0n))
      refuse('ancestry drift');
    if (index === 2 && (stat.uid !== 0n || stat.gid !== 0n || ![0o777n, 0o755n].includes(mode)))
      refuse('root metadata drift');
    if (
      index > 2 &&
      (stat.uid !== 1000n ||
        stat.gid !== (index === 4 ? 982n : 1000n) ||
        mode !== (index === 5 ? 0o755n : 0o775n))
    )
      refuse('child metadata drift');
    acl(entry, stat, execute);
    if (index <= 1) {
      const row = mount(entry, execute);
      if (
        stat.dev !== stats[0].dev ||
        Object.entries({
          target: '/',
          uuid: SSD_UUID,
          fstype: 'ext4',
          'maj:min': device(stat.dev),
          fsroot: '/',
        }).some(([key, value]) => row[key] !== value)
      )
        refuse('ancestry mount drift');
    }
    if (index >= 2) {
      const row = mount(entry, execute);
      if (
        stat.dev === stats[0].dev ||
        device(stat.dev) !== '8:1' ||
        Object.entries({
          target: HDD,
          uuid: UUID,
          fstype: 'ext4',
          'maj:min': device(stat.dev),
          fsroot: '/',
        }).some(([key, value]) => row[key] !== value)
      )
        refuse('mount verification failed');
    }
    snapshot[entry] = identity(stat);
  }
  return snapshot;
}

function privateRead(entry, filesystem, execute, expectedMode, owner = 0n) {
  const before = inspect(entry, filesystem, false);
  if (
    before.uid !== owner ||
    before.gid !== owner ||
    (before.mode & 0o7777n) !== expectedMode ||
    before.size > BigInt(LIMIT)
  )
    refuse('source metadata drift');
  acl(entry, before, execute);
  let fd;
  try {
    fd = filesystem.openSync(entry, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = filesystem.fstatSync(fd, { bigint: true });
    if (
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      !stat.isFile() ||
      stat.size > BigInt(LIMIT)
    )
      throw new Error();
    const buffer = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length <= LIMIT) {
      const count = filesystem.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    const bytes = buffer.subarray(0, length);
    if (bytes.length > LIMIT || !Buffer.from(bytes.toString('utf8')).equals(bytes))
      throw new Error();
    if (!same(identity(before), identity(inspect(entry, filesystem, false)))) throw new Error();
    return bytes.toString('utf8');
  } catch {
    refuse('source unavailable or changed');
  } finally {
    if (fd !== undefined) filesystem.closeSync(fd);
  }
}

function sambaPreflight(filesystem, execute, sambaHashes) {
  const root = privateRead(SAMBA_ROOT, filesystem, execute, 0o644n);
  const source = privateRead(SAMBA_SOURCE, filesystem, execute, 0o644n);
  if (hash(root) !== sambaHashes.root || hash(source) !== sambaHashes.source)
    refuse('Samba baseline drift');
  const includes = [...root.matchAll(/^[ \t]*include[ \t]*=[ \t]*([^\r\n]+)[ \t]*$/gim)];
  if (includes.length !== 1 || includes[0][1].trim() !== SAMBA_SOURCE)
    refuse('Samba include ambiguity');
  const candidate = transformSamba(source);
  probe(execute, '/usr/bin/testparm', ['-s', SAMBA_ROOT]);
  return { root, source, candidate, sourcePath: SAMBA_SOURCE };
}

// Parameter-only injection. Production CLI always uses these exact host paths and actual probes.
export function preflight(component, options = {}) {
  const {
    filesystem = fs,
    execute = execFileSync,
    sambaHashes = {
      root: 'a2dfab4ff5dbbf4c5996fcded684259dfa5185b0cf93afb82f3eff0f1243c18e',
      source: 'ca11dffe24389ec26f994be3edbfcf4fde23716ca3cf84f4012f1ad729c8866e',
    },
  } = options;
  try {
    if (!['samba', 'syncthing'].includes(component)) refuse('invalid component');
    const before = rootSnapshot(filesystem, execute);
    const data =
      component === 'samba'
        ? sambaPreflight(filesystem, execute, sambaHashes)
        : syncthingPreflight(filesystem, execute);
    const after = rootSnapshot(filesystem, execute);
    if (!same(before, after)) refuse('filesystem drift');
    return {
      ...data,
      snapshot: before,
      receipt: {
        evidence: Object.keys(options).length
          ? 'injected-unit-fixtures'
          : 'actual-host-observations',
        component,
        eligible: true,
        applied: false,
        fullIsolation: 'UNVERIFIED',
        backupExclusion: 'UNVERIFIED',
        rootState:
          before[HDD].mode === String(0o40777)
            ? '0777-awaiting-owner-activation'
            : '0755-observed-not-reapplied',
        sourcePath: data.sourcePath,
        baselineSha256: hash(data.source),
        candidateSha256: hash(data.candidate),
      },
    };
  } catch (error) {
    if (error instanceof PlanError) throw error;
    refuse('verification failed');
  }
}

// Deliberately restricted XML: no entities, DTD, comments or processing instructions.
// Consume every token/attribute and balance the document before trusting folder scope.
function folderScope(xml) {
  if (
    typeof xml !== 'string' ||
    xml.includes('&') ||
    [...xml].some((char) => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char))
  )
    throw new Error();
  xml = xml.replace(/^\s*<\?xml version="1\.0"(?: encoding="[Uu][Tt][Ff]-8")?\s*\?>/, '');
  const stack = [];
  let roots = 0;
  let folder;
  const tokens =
    /<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)>|[^<]+/gy;
  let offset = 0;
  while (offset < xml.length) {
    tokens.lastIndex = offset;
    const token = tokens.exec(xml);
    if (!token) throw new Error();
    offset = tokens.lastIndex;
    if (token[1]) {
      if (stack.pop() !== token[1]) throw new Error();
    } else if (token[2]) {
      const selfClosing = token[3].endsWith('/');
      let remaining = selfClosing ? token[3].slice(0, -1) : token[3];
      const attributes = Object.create(null);
      while (remaining.trim()) {
        const attribute = remaining.match(
          /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/,
        );
        if (!attribute || Object.hasOwn(attributes, attribute[1])) throw new Error();
        attributes[attribute[1]] = attribute[2] ?? attribute[3];
        remaining = remaining.slice(attribute[0].length);
      }
      if (!stack.length && (++roots !== 1 || token[2] !== 'configuration')) throw new Error();
      if (token[2] === 'folder') {
        if (folder || stack.length !== 1 || stack[0] !== 'configuration') throw new Error();
        folder = attributes;
      }
      if (!selfClosing) stack.push(token[2]);
    } else if (!stack.length && token[0].trim()) throw new Error();
  }
  if (stack.length || roots !== 1 || !folder) throw new Error();
  return folder;
}

export function verifySyncthingScope(original, candidate, runtime, xml) {
  try {
    if (original.name !== 'local-syncthing' || Object.keys(original.services).length !== 1)
      throw new Error();
    const service = original.services['big-bear-syncthing'];
    if (
      service.image !== 'syncthing/syncthing:2.0' ||
      service.restart !== 'unless-stopped' ||
      service.env_file !== undefined ||
      service.volumes.length !== 2
    )
      throw new Error();
    const index = service.volumes.findIndex(
      (v) => v.type === 'bind' && v.source === HDD && v.target === HDD && v.read_only !== true,
    );
    if (index === -1) throw new Error();
    const appdata = service.volumes[1 - index];
    if (
      appdata.type !== 'bind' ||
      appdata.target !== '/var/syncthing' ||
      !path.isAbsolute(appdata.source) ||
      appdata.source === HDD ||
      appdata.source.startsWith(`${HDD}/`) ||
      appdata.read_only === true
    )
      throw new Error();
    const expected = JSON.parse(JSON.stringify(original));
    expected.services['big-bear-syncthing'].volumes[index].source = `${HDD}/University`;
    expected.services['big-bear-syncthing'].volumes[index].target = `${HDD}/University`;
    if (
      !isDeepStrictEqual(expected, candidate) ||
      runtime.image !== 'sha256:4a961394ca471f4e48f31ad2cef50697e502c8799e2e98477a1c3844e0c5bc54' ||
      runtime.running !== true ||
      runtime.project !== 'local-syncthing' ||
      runtime.service !== 'big-bear-syncthing' ||
      runtime.configFiles !== COMPOSE_SOURCE ||
      runtime.workingDir !== path.dirname(COMPOSE_SOURCE) ||
      runtime.mounts.length !== 2
    )
      throw new Error();
    if (
      service.volumes.some(
        (v) =>
          !runtime.mounts.some(
            (m) =>
              m.Type === 'bind' &&
              m.Source === v.source &&
              m.Destination === v.target &&
              m.RW === true,
          ),
      )
    )
      throw new Error();
    const values = folderScope(xml);
    if (
      values.path !== `${HDD}/University` ||
      values.type !== 'sendreceive' ||
      values.paused !== 'false' ||
      values.ignorePerms !== 'false'
    )
      throw new Error();
    return true;
  } catch {
    refuse('Syncthing scope drift');
  }
}

function syncthingPreflight(filesystem, execute) {
  const source = privateRead(COMPOSE_SOURCE, filesystem, execute, 0o600n);
  const candidate = transformSyncthing(source);
  const config = (input) =>
    JSON.parse(
      probe(
        execute,
        '/usr/bin/docker',
        [
          'compose',
          '--env-file',
          '/dev/null',
          '--project-directory',
          path.dirname(COMPOSE_SOURCE),
          '--project-name',
          'local-syncthing',
          '-f',
          '-',
          'config',
          '--format',
          'json',
          '--no-env-resolution',
          '--no-path-resolution',
        ],
        input,
      ),
    );
  const original = config(source);
  const changed = config(candidate);
  const format =
    '{"image":{{json .Image}},"running":{{json .State.Running}},"mounts":{{json .Mounts}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"configFiles":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"workingDir":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}}}';
  const runtime = JSON.parse(
    probe(execute, '/usr/bin/docker', ['inspect', '--format', format, 'big-bear-syncthing']),
  );
  const appdata = runtime.mounts.find(
    (m) => m.Type === 'bind' && m.Destination === '/var/syncthing',
  );
  if (!appdata || !safeOutputName(appdata.Source) || appdata.Source.startsWith(`${HDD}/`))
    refuse('Syncthing scope drift');
  const xml = privateRead(
    path.join(appdata.Source, 'config/config.xml'),
    filesystem,
    execute,
    0o600n,
    1000n,
  );
  verifySyncthingScope(original, changed, runtime, xml);
  return {
    source,
    candidate,
    sourcePath: COMPOSE_SOURCE,
    scopeFingerprint: hash(JSON.stringify(runtime) + xml),
  };
}

export function runPlan(
  argv,
  {
    diagnostic = (message) => process.stderr.write(`${message}\n`),
    report = (receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`),
    ...options
  } = {},
) {
  const check = argv.length === 3 && argv[0] === '--check' && argv[1] === '--component';
  const prepare =
    argv.length === 4 &&
    argv[0] === '--prepare' &&
    argv[2] === '--component' &&
    safeOutputName(argv[1]);
  const component = argv.at(-1);
  if ((!check && !prepare) || !['samba', 'syncthing'].includes(component)) {
    diagnostic('NAS isolation: invalid CLI');
    return { code: 1 };
  }
  try {
    const result = preflight(component, options);
    if (prepare) prepareFiles(argv[1], result, options);
    report(result.receipt);
    return { code: 0 };
  } catch (error) {
    diagnostic(error instanceof PlanError ? error.message : 'NAS isolation: verification failed');
    return { code: 1 };
  }
}

function safeOutputName(value) {
  return (
    typeof value === 'string' &&
    path.isAbsolute(value) &&
    path.normalize(value) === value &&
    /^[A-Za-z0-9_./-]+$/.test(value) &&
    !value.endsWith('/')
  );
}
function outputSnapshot(output, filesystem, execute, empty) {
  if (
    !safeOutputName(output) ||
    output === os.homedir() ||
    [REPOSITORY, CHECKOUT].some((entry) => output === entry || output.startsWith(`${entry}/`)) ||
    [
      '/etc',
      '/var',
      '/DATA',
      '/mnt',
      '/media',
      '/root',
      '/usr',
      '/proc',
      '/sys',
      '/dev',
      '/boot',
      '/run',
    ].some((entry) => output === entry || output.startsWith(`${entry}/`))
  )
    refuse('unsafe output location');
  const stat = inspect(output, filesystem);
  if (
    stat.uid !== BigInt(process.getuid()) ||
    (stat.mode & 0o7777n) !== 0o700n ||
    stat.dev !== filesystem.lstatSync('/', { bigint: true }).dev
  )
    refuse('unsafe output directory');
  const row = mount(output, execute);
  if (
    Object.entries({
      target: '/',
      uuid: SSD_UUID,
      fstype: 'ext4',
      fsroot: '/',
      'maj:min': device(stat.dev),
    }).some(([key, value]) => row[key] !== value)
  )
    refuse('output SSD verification failed');
  if (empty && filesystem.readdirSync(output).length !== 0) refuse('output not empty');
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: String(stat.uid),
    mode: String(stat.mode),
  };
}

function prepareFiles(output, result, options) {
  const { outputFilesystem: filesystem = fs, execute = execFileSync } = options;
  const before = outputSnapshot(output, filesystem, execute, true);
  const created = [];
  const write = (name, bytes) => {
    if (!same(before, outputSnapshot(output, filesystem, execute, false))) refuse('output drift');
    const filename = path.join(output, name);
    const fd = filesystem.openSync(
      filename,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    const owned = { filename };
    created.push(owned); // A successful exclusive open is a partial output even if fstat fails.
    try {
      const stat = filesystem.fstatSync(fd, { bigint: true });
      Object.assign(owned, { dev: stat.dev, ino: stat.ino });
      if ((stat.mode & 0o7777n) !== 0o600n || stat.uid !== BigInt(process.getuid()))
        refuse('output file permissions failed');
      filesystem.writeFileSync(fd, bytes);
      filesystem.fsyncSync(fd);
    } finally {
      filesystem.closeSync(fd);
    }
  };
  try {
    const name =
      result.receipt.component === 'samba' ? 'samba.candidate.conf' : 'syncthing.candidate.yml';
    write(name, result.candidate);
    if (result.receipt.component === 'samba') {
      const redirected = result.root.replace(
        /(^[ \t]*include[ \t]*=[ \t]*)[^\r\n]+/im,
        `$1${path.join(output, name)}`,
      );
      write('samba.validation-root.conf', redirected);
      probe(execute, '/usr/bin/testparm', ['-s', path.join(output, 'samba.validation-root.conf')]);
      const temporary = created.at(-1);
      const stat = filesystem.lstatSync(temporary.filename, { bigint: true });
      if (stat.dev !== temporary.dev || stat.ino !== temporary.ino || stat.isSymbolicLink())
        refuse('output drift');
      filesystem.unlinkSync(temporary.filename);
      created.pop();
    }
    const fresh = preflight(result.receipt.component, options);
    if (
      !same(fresh.snapshot, result.snapshot) ||
      fresh.scopeFingerprint !== result.scopeFingerprint ||
      fresh.receipt.baselineSha256 !== result.receipt.baselineSha256 ||
      fresh.receipt.candidateSha256 !== result.receipt.candidateSha256
    )
      refuse('preparation drift');
    result.receipt.prepared = true;
    result.receipt.privateFiles = 2;
    write('receipt.json', JSON.stringify(result.receipt, null, 2) + '\n');
    if (!same(before, outputSnapshot(output, filesystem, execute, false))) refuse('output drift');
    for (const { filename, dev, ino } of created) {
      const stat = filesystem.lstatSync(filename, { bigint: true });
      if (
        stat.dev !== dev ||
        stat.ino !== ino ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o7777n) !== 0o600n
      )
        refuse('output drift');
    }
  } catch {
    // Remove only this invocation's exact still-owned inode, never pre-existing/replaced files.
    let partial = false;
    for (const { filename, dev, ino } of created.reverse()) {
      try {
        const stat = filesystem.lstatSync(filename, { bigint: true });
        if (
          stat.dev !== dev ||
          stat.ino !== ino ||
          stat.uid !== BigInt(process.getuid()) ||
          stat.isSymbolicLink()
        ) {
          partial = true;
          continue;
        }
        filesystem.unlinkSync(filename);
      } catch {
        partial = true;
      }
    }
    refuse(
      partial
        ? 'preparation failed; private partial outputs retained'
        : 'preparation failed; own outputs removed',
    );
  }
}

if (import.meta.main) process.exitCode = runPlan(process.argv.slice(2)).code;
