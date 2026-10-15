import { Buffer } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  transformSamba,
  transformSyncthing,
  preflight,
  runPlan,
  verifySyncthingScope,
} from '../infrastructure/scripts/nas-isolation-plan.mjs';

describe('NAS isolation candidates (unit fixtures, not deployed policy)', () => {
  it('adds only the reserved-name veto inside nas, preserving every original byte', () => {
    const original =
      '# private settings\r\n[global]\r\n  workgroup = SECRET_SENTINEL\r\n[nas]\r\n  path = /home/juyoungoh/nas\r\n  guest ok = yes\r\n[other]\r\n  read only = no\r\n';
    expect(transformSamba(original)).toBe(
      original.replace('[nas]\r\n', '[nas]\r\n  veto files = /cupmemo/\r\n'),
    );
  });
  it.each([
    '[other]\npath = /x\n',
    '[nas]\n[nas]\n',
    '[nas]\nveto files = /old/\n',
    '[global]\ninclude = /unknown\n[nas]\n',
    '[nas]\npath = /x\nPATH = /y\n',
    '[NAS]\npath = /x\n',
    '[nas]\ninclude = /unknown\n',
    '[nas]\npath = /x\\\n continuation\n',
  ])('refuses unsupported or ambiguous Samba policy', (text) => {
    expect(() => transformSamba(text)).toThrow('NAS isolation: unsupported Samba source');
  });
});
const compose =
  'name: local-syncthing\nservices:\n  big-bear-syncthing:\n    image: syncthing/syncthing:2.0\n    restart: unless-stopped\n    volumes:\n      - /ssd/appdata:/var/syncthing:rw\n      - "/DATA/nas:/DATA/nas:rw"\n    environment:\n      PRIVATE: SECRET_SENTINEL\n';
describe('Syncthing byte-preserving narrow transform', () => {
  it('changes BOTH endpoints only, retaining image/appdata/settings', () => {
    expect(transformSyncthing(compose)).toBe(
      compose.replace('/DATA/nas:/DATA/nas:rw', '/DATA/nas/University:/DATA/nas/University:rw'),
    );
  });
  it('preserves blank lines and CRLF', () => {
    const input = compose.replace('services:', '\nservices:').replaceAll('\n', '\r\n');
    expect(transformSyncthing(input)).toBe(
      input.replace('/DATA/nas:/DATA/nas:rw', '/DATA/nas/University:/DATA/nas/University:rw'),
    );
  });
  it.each([
    compose.replace(':rw"', ':ro"'),
    compose.replace('/DATA/nas:/DATA/nas', '${HDD}:/DATA/nas'),
    compose.replace('    image:', '    image: x\n    image:'),
    compose.replace('  big-bear-syncthing:', '  wrong-service:'),
    compose.replace('services:', 'services: &anchor'),
    compose.replace(
      '      - "/DATA/nas:/DATA/nas:rw"',
      '      - type: bind\n        source: /DATA/nas\n        target: /DATA/nas',
    ),
    compose + 'services:\n  other:\n    image: x\n',
    compose.replace(
      '      - "/DATA/nas:/DATA/nas:rw"',
      '      - /DATA/nas:/DATA/nas\n      - /DATA/nas:/DATA/nas',
    ),
  ])('refuses ambiguous/unsupported declarations including long syntax', (text) => {
    expect(() => transformSyncthing(text)).toThrow('NAS isolation: unsupported Compose source');
  });
});

const digest = (text) => createHash('sha256').update(text).digest('hex');
const effective = {
  name: 'local-syncthing',
  services: {
    'big-bear-syncthing': {
      image: 'syncthing/syncthing:2.0',
      restart: 'unless-stopped',
      environment: { PRIVATE: 'SECRET_SENTINEL' },
      volumes: [
        { type: 'bind', source: '/ssd/appdata', target: '/var/syncthing', read_only: false },
        { type: 'bind', source: '/DATA/nas', target: '/DATA/nas', read_only: false },
      ],
    },
  },
};
const runtime = {
  image: 'sha256:4a961394ca471f4e48f31ad2cef50697e502c8799e2e98477a1c3844e0c5bc54',
  running: true,
  project: 'local-syncthing',
  service: 'big-bear-syncthing',
  configFiles: '/var/lib/casaos/apps/local-syncthing/docker-compose.yml',
  workingDir: '/var/lib/casaos/apps/local-syncthing',
  mounts: [
    { Type: 'bind', Source: '/ssd/appdata', Destination: '/var/syncthing', RW: true },
    { Type: 'bind', Source: '/DATA/nas', Destination: '/DATA/nas', RW: true },
  ],
};
const folderXml =
  '<configuration><folder path="/DATA/nas/University" type="sendreceive" paused="false" ignorePerms="false"></folder></configuration>';
function scopedCandidate() {
  const next = JSON.parse(JSON.stringify(effective));
  next.services['big-bear-syncthing'].volumes[1].source = '/DATA/nas/University';
  next.services['big-bear-syncthing'].volumes[1].target = '/DATA/nas/University';
  return next;
}
describe('effective private Compose/runtime/folder invariance (unit fixtures)', () => {
  it('accepts only the two-endpoint bind difference', () =>
    expect(verifySyncthingScope(effective, scopedCandidate(), runtime, folderXml)).toBe(true));
  it('accepts an XML declaration, extra settings, single quotes and self-closing children', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      folderXml
        .replace('<folder ', '<folder id="unit-folder" ')
        .replace('></folder>', '><versioning type="simple"/></folder>')
        .replaceAll('"', "'");
    expect(verifySyncthingScope(effective, scopedCandidate(), runtime, xml)).toBe(true);
  });
  it.each([
    folderXml.replace('</folder>', ''),
    folderXml.replace('</configuration>', '</wrong>'),
    folderXml + '<configuration/>',
    folderXml.replace(' path=', ' junk path='),
    folderXml.replace(' path=', ' x:path='),
    folderXml.replace(' path=', ' path="/other" path='),
    folderXml.replace('<folder ', '<wrapper><folder ').replace('</folder>', '</folder></wrapper>'),
    folderXml.replace('paused="false"', 'paused="false"broken="x"'),
  ])('refuses malformed or ambiguous XML rather than extracting partial attributes', (xml) => {
    expect(() => verifySyncthingScope(effective, scopedCandidate(), runtime, xml)).toThrow(
      'NAS isolation: Syncthing scope drift',
    );
  });
  it.each([
    'image',
    'destination',
    'appdata',
    'secret-setting',
    'runtime',
    'folder',
    'duplicate-folder',
    'service',
    'readonly',
  ])('rejects %s drift without printing private data', (fault) => {
    const candidate = scopedCandidate();
    const live = JSON.parse(JSON.stringify(runtime));
    let xml = folderXml;
    if (fault === 'image') candidate.services['big-bear-syncthing'].image = 'unknown';
    if (fault === 'destination')
      candidate.services['big-bear-syncthing'].volumes[1].target = '/DATA/nas';
    if (fault === 'appdata') candidate.services['big-bear-syncthing'].volumes[0].source = '/other';
    if (fault === 'secret-setting')
      candidate.services['big-bear-syncthing'].environment.PRIVATE = 'different';
    if (fault === 'runtime') live.project = 'other';
    if (fault === 'folder') xml = folderXml.replace('University', 'Other');
    if (fault === 'duplicate-folder')
      xml = folderXml.replace('</configuration>', '<folder path="/other" /></configuration>');
    if (fault === 'service') candidate.services.other = { image: 'x' };
    if (fault === 'readonly') candidate.services['big-bear-syncthing'].volumes[1].read_only = true;
    expect(() => verifySyncthingScope(effective, candidate, live, xml)).toThrow(
      'NAS isolation: Syncthing scope drift',
    );
  });
});
const rootConfig = '[global]\n  include = /etc/samba/smb.casa.conf\n';
const sambaConfig = '[nas]\npath = /home/juyoungoh/nas\nguest ok = yes\n';
function fixture(action, backingFilesystem = fs) {
  const base = fs.mkdtempSync(path.join(os.homedir(), 'cupmemo-nas-unit-'));
  const physical = (entry) => (entry === '/' ? '/' : path.join(base, entry));
  for (const [entry, mode] of [
    ['/DATA', 0o755],
    ['/DATA/nas', 0o777],
    ['/DATA/nas/Photos', 0o775],
    ['/DATA/nas/Projects', 0o775],
    ['/DATA/nas/University', 0o755],
    ['/etc/samba', 0o755],
    ['/output', 0o700],
  ]) {
    fs.mkdirSync(physical(entry), { recursive: true, mode });
    fs.chmodSync(physical(entry), mode);
  }
  fs.writeFileSync(physical('/etc/samba/smb.conf'), rootConfig, { mode: 0o644 });
  fs.writeFileSync(physical('/etc/samba/smb.casa.conf'), sambaConfig, { mode: 0o644 });
  const calls = [];
  // Model approved devices independently of the host's root/home mounts. Keep real
  // inode, size, timestamps, mode and file type so production safety checks run.
  const ssdDevice = 2050n;
  const descriptors = new Map();
  const metadata = (stat, entry) => {
    const hdd = entry.startsWith('/DATA/nas');
    const child = hdd && entry !== '/DATA/nas';
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
      uid: child ? 1000n : 0n,
      gid: entry === '/DATA/nas/Projects' ? 982n : child ? 1000n : 0n,
      dev: hdd ? 2049n : ssdDevice,
    });
  };
  const filesystem = {
    ...backingFilesystem,
    lstatSync(entry, options) {
      return metadata(backingFilesystem.lstatSync(physical(entry), options), entry);
    },
    fstatSync(fd, options) {
      return metadata(backingFilesystem.fstatSync(fd, options), descriptors.get(fd));
    },
    realpathSync(entry) {
      const result = fs.realpathSync(physical(entry));
      return result === physical(entry) ? entry : result;
    },
    readFileSync(entry, options) {
      return fs.readFileSync(typeof entry === 'number' ? entry : physical(entry), options);
    },
    openSync(entry, flags, mode) {
      const fd = backingFilesystem.openSync(physical(entry), flags, mode);
      descriptors.set(fd, entry);
      return fd;
    },
    closeSync(fd) {
      descriptors.delete(fd);
      return backingFilesystem.closeSync(fd);
    },
  };
  // Physical output paths retain real ownership, on the same modeled SSD.
  const outputFilesystem = {
    ...backingFilesystem,
    lstatSync(entry, options) {
      return Object.assign(backingFilesystem.lstatSync(entry, options), { dev: ssdDevice });
    },
    fstatSync(fd, options) {
      return Object.assign(backingFilesystem.fstatSync(fd, options), { dev: ssdDevice });
    },
  };
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === '/usr/bin/findmnt') {
      const dev = ssdDevice;
      const id = `${((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)}:${(dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)}`;
      return JSON.stringify({
        filesystems: [
          !args[2].startsWith('/DATA/nas')
            ? {
                target: '/',
                uuid: '493d6733-2a8b-482b-b39f-a7ecc1ce8863',
                fstype: 'ext4',
                fsroot: '/',
                'maj:min': id,
              }
            : {
                target: '/DATA/nas',
                uuid: '68391fd3-3c92-4cfe-82db-47a5e6abb2ee',
                fstype: 'ext4',
                fsroot: '/',
                'maj:min': '8:1',
              },
        ],
      });
    }
    if (command === '/usr/bin/getfacl') {
      const mode = Number(filesystem.lstatSync(args.at(-1), { bigint: true }).mode & 0o777n);
      const perms = (n) => `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
      return `user::${perms(mode >> 6)}\ngroup::${perms(mode >> 3)}\nother::${perms(mode)}\n\n`;
    }
    if (command === '/usr/bin/testparm') {
      if (args[1].endsWith('samba.validation-root.conf'))
        calls.at(-1).validationRoot = fs.readFileSync(args[1], 'utf8');
      return '[nas]\n';
    }
    throw new Error('SECRET_SENTINEL unexpected command');
  };
  try {
    return action({
      base,
      physical,
      filesystem,
      outputFilesystem,
      execute,
      calls,
      sambaHashes: { root: digest(rootConfig), source: digest(sambaConfig) },
    });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

describe('preflight: real SSD files with injected HDD/ACL/probe UNIT FIXTURES', () => {
  it.each([2049n, 2052n])(
    'keeps real source/output checks coherent when underlying root dev is %s and home differs',
    (rootDevice) => {
      const homeDevice = 2051n;
      const backingFilesystem = {
        ...fs,
        lstatSync(entry, options) {
          return Object.assign(fs.lstatSync(entry, options), {
            dev: entry === '/' ? rootDevice : homeDevice,
          });
        },
        fstatSync(fd, options) {
          return Object.assign(fs.fstatSync(fd, options), { dev: homeDevice });
        },
      };
      expect(rootDevice).not.toBe(homeDevice);
      fixture((options) => {
        expect(preflight('samba', options).source).toBe(sambaConfig);
        const messages = [];
        const output = options.physical('/output');
        const result = runPlan(['--prepare', output, '--component', 'samba'], {
          ...options,
          diagnostic: (message) => messages.push(message),
          report: () => {},
        });
        expect(messages).toEqual([]);
        expect(result.code).toBe(0);
        expect(fs.readFileSync(path.join(output, 'samba.candidate.conf'), 'utf8')).toBe(
          transformSamba(sambaConfig),
        );
      }, backingFilesystem);
    },
  );
  it('checks read-only and labels eligibility separately from applied isolation', () =>
    fixture((options) => {
      const before = fs.readFileSync(options.physical('/etc/samba/smb.casa.conf'));
      const result = preflight('samba', options);
      expect(result.receipt).toMatchObject({
        evidence: 'injected-unit-fixtures',
        component: 'samba',
        eligible: true,
        applied: false,
        backupExclusion: 'UNVERIFIED',
        fullIsolation: 'UNVERIFIED',
        rootState: '0777-awaiting-owner-activation',
      });
      expect(fs.readFileSync(options.physical('/etc/samba/smb.casa.conf'))).toEqual(before);
      expect(fs.readdirSync(options.physical('/output'))).toEqual([]);
      expect(
        options.calls.every(({ command }) =>
          ['/usr/bin/findmnt', '/usr/bin/getfacl', '/usr/bin/testparm'].includes(command),
        ),
      ).toBe(true);
    }));
  it.each([
    'wrong-uuid',
    'ssd',
    'nested',
    'malformed',
    'multiple',
    'timeout',
    'oversized',
    'acl',
    'owner',
    'mode',
    'symlink',
    'missing',
    'disappeared',
    'drift',
    'source-drift',
  ])('refuses %s before outputs', (fault) =>
    fixture((options) => {
      const originalExecute = options.execute;
      options.execute = (command, args, opts) => {
        if (command === '/usr/bin/findmnt') {
          if (fault === 'malformed') return '{';
          if (fault === 'multiple') return '{"filesystems":[]}';
          if (fault === 'timeout') throw new Error('SECRET_SENTINEL ETIMEDOUT');
          if (fault === 'oversized') return 'x'.repeat(70000);
          const value = JSON.parse(originalExecute(command, args, opts));
          if (fault === 'wrong-uuid') value.filesystems[0].uuid = 'wrong';
          if (fault === 'ssd') value.filesystems[0].uuid = 'ssd-fallback';
          if (fault === 'nested') value.filesystems[0].fsroot = '/nested';
          if (fault === 'disappeared' && fs.existsSync(options.physical('/DATA/nas/University')))
            fs.rmdirSync(options.physical('/DATA/nas/University'));
          if (fault === 'drift') fs.chmodSync(options.physical('/DATA/nas'), 0o755);
          return JSON.stringify(value);
        }
        if (command === '/usr/bin/getfacl' && fault === 'acl')
          return 'user::rwx\nuser:1000:rwx\ngroup::rwx\nmask::rwx\nother::rwx\n';
        return originalExecute(command, args, opts);
      };
      if (fault === 'owner') {
        const original = options.filesystem.lstatSync;
        options.filesystem.lstatSync = (entry, opts) =>
          Object.assign(original(entry, opts), entry === '/DATA/nas' ? { uid: 1000n } : {});
      }
      if (fault === 'mode') fs.chmodSync(options.physical('/DATA/nas'), 0o775);
      if (fault === 'missing') fs.rmdirSync(options.physical('/DATA/nas/University'));
      if (fault === 'symlink') {
        fs.rmdirSync(options.physical('/DATA/nas/University'));
        fs.symlinkSync(
          options.physical('/DATA/nas/Photos'),
          options.physical('/DATA/nas/University'),
        );
      }
      if (fault === 'source-drift')
        fs.appendFileSync(options.physical('/etc/samba/smb.casa.conf'), '# changed\n');
      expect(() => preflight('samba', options)).toThrow(/^NAS isolation:/);
      expect(fs.readdirSync(options.physical('/output'))).toEqual([]);
    }),
  );
});

describe('bounded source reads (real SSD unit files)', () => {
  it('accepts the exact byte limit through repeated short reads and closes descriptors', () =>
    fixture((options) => {
      const source = sambaConfig + '#' + 'x'.repeat(65536 - Buffer.byteLength(sambaConfig) - 1);
      fs.writeFileSync(options.physical('/etc/samba/smb.casa.conf'), source);
      options.sambaHashes.source = digest(source);
      let reads = 0;
      let opens = 0;
      let closes = 0;
      const open = options.filesystem.openSync;
      options.filesystem.openSync = (...args) => {
        opens++;
        return open(...args);
      };
      options.filesystem.readSync = (fd, buffer, offset, length, position) => {
        reads++;
        return fs.readSync(fd, buffer, offset, Math.min(length, 997), position);
      };
      options.filesystem.closeSync = (fd) => {
        closes++;
        fs.closeSync(fd);
      };
      expect(preflight('samba', options).source).toBe(source);
      expect(reads).toBeGreaterThan(60);
      expect(closes).toBe(opens);
    }));
  it.each(['oversized-stat', 'growth-after-open', 'invalid-utf8', 'read-failure', 'inode-drift'])(
    'refuses %s with bounded reads and closed descriptors',
    (fault) =>
      fixture((options) => {
        const sourcePath = options.physical('/etc/samba/smb.casa.conf');
        if (fault === 'oversized-stat') fs.writeFileSync(sourcePath, 'x'.repeat(65537));
        if (fault === 'invalid-utf8') fs.writeFileSync(sourcePath, Buffer.from([0xff]));
        let opens = 0;
        let closes = 0;
        let bytes = 0;
        const open = options.filesystem.openSync;
        const fstat = options.filesystem.fstatSync;
        options.filesystem.openSync = (entry, ...args) => {
          if (fault === 'growth-after-open' && entry.endsWith('smb.casa.conf'))
            fs.appendFileSync(sourcePath, 'x'.repeat(65537));
          opens++;
          return open(entry, ...args);
        };
        options.filesystem.fstatSync = (fd, opts) =>
          Object.assign(
            fstat(fd, opts),
            fault === 'growth-after-open'
              ? { size: 1n }
              : fault === 'inode-drift'
                ? { ino: 0n }
                : {},
          );
        options.filesystem.readSync = (...args) => {
          if (fault === 'read-failure') throw new Error('SECRET_SENTINEL');
          const n = fs.readSync(...args);
          bytes += n;
          return n;
        };
        options.filesystem.closeSync = (fd) => {
          closes++;
          fs.closeSync(fd);
        };
        expect(() => preflight('samba', options)).toThrow(/^NAS isolation:/);
        expect(closes).toBe(opens);
        expect(bytes).toBeLessThanOrEqual(65537 + Buffer.byteLength(rootConfig));
        expect(fs.readdirSync(options.physical('/output'))).toEqual([]);
      }),
  );
});

describe('CLI boundary', () => {
  it.each(
    [
      [],
      ['--apply'],
      ['--check'],
      ['--check', '--component', 'all'],
      ['--prepare', 'relative', '--component', 'samba'],
      ['--check', '--component', 'samba', 'extra'],
    ].map((argv) => [argv]),
  )('rejects invalid argv before probing', (argv) => {
    const messages = [];
    const result = runPlan(argv, {
      diagnostic: (message) => messages.push(message),
      execute() {
        throw new Error('SECRET_SENTINEL');
      },
    });
    expect(result.code).toBe(1);
    expect(messages).toEqual(['NAS isolation: invalid CLI']);
  });
  it('real CLI does not accept environment bypasses or apply', () => {
    const result = spawnSync(
      process.execPath,
      ['infrastructure/scripts/nas-isolation-plan.mjs', '--apply'],
      {
        encoding: 'utf8',
        env: { ...process.env, NAS_TEST_MODE: 'true', SECRET: 'SECRET_SENTINEL' },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('NAS isolation: invalid CLI\n');
    expect(result.stdout).toBe('');
  });
  it('prepares exclusive private SSD outputs and leaves source bytes unchanged', () =>
    fixture((options) => {
      const output = options.physical('/output');
      const messages = [];
      const receipts = [];
      const result = runPlan(['--prepare', output, '--component', 'samba'], {
        ...options,
        diagnostic: (m) => messages.push(m),
        report: (r) => receipts.push(r),
      });
      expect(result.code).toBe(0);
      expect(messages).toEqual([]);
      expect(fs.readdirSync(output).sort()).toEqual(['receipt.json', 'samba.candidate.conf']);
      for (const name of fs.readdirSync(output))
        expect(fs.statSync(path.join(output, name)).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(path.join(output, 'samba.candidate.conf'), 'utf8')).toBe(
        transformSamba(sambaConfig),
      );
      expect(fs.readFileSync(options.physical('/etc/samba/smb.casa.conf'), 'utf8')).toBe(
        sambaConfig,
      );
      expect(receipts[0]).toMatchObject({
        prepared: true,
        applied: false,
        backupExclusion: 'UNVERIFIED',
        evidence: 'injected-unit-fixtures',
      });
      const validation = options.calls.find(({ args }) =>
        args[1].endsWith('samba.validation-root.conf'),
      );
      expect(validation.validationRoot).toBe(
        rootConfig.replace('/etc/samba/smb.casa.conf', path.join(output, 'samba.candidate.conf')),
      );
      const repeat = runPlan(['--prepare', output, '--component', 'samba'], {
        ...options,
        diagnostic: () => {},
        report: () => {
          throw new Error('must not publish');
        },
      });
      expect(repeat.code).toBe(1);
      expect(fs.readFileSync(path.join(output, 'samba.candidate.conf'), 'utf8')).toBe(
        transformSamba(sambaConfig),
      );
    }));
  it.each([
    os.homedir(),
    '/home/juyoungoh/CupMemo',
    '/home/juyoungoh/CupMemo/private-output',
    '/DATA/nas/private-output',
    '/etc/private-output',
    '/var/private-output',
    '/tmp/../etc/private-output',
  ])('refuses protected or escaping output %s without publishing', (output) =>
    fixture((options) => {
      const messages = [];
      let published = false;
      const result = runPlan(['--prepare', output, '--component', 'samba'], {
        ...options,
        diagnostic: (m) => messages.push(m),
        report: () => {
          published = true;
        },
      });
      expect(result.code).toBe(1);
      expect(published).toBe(false);
      expect(messages.join('')).toMatch(/^NAS isolation: (unsafe output location|invalid CLI)$/);
      expect(fs.readdirSync(options.physical('/output'))).toEqual([]);
    }),
  );
  it.each(['exclusive-race', 'replaced-inode', 'fstat-failure'])(
    'preserves foreign outputs and reports retained partials on %s',
    (fault) =>
      fixture((options) => {
        const output = options.physical('/output');
        const candidate = path.join(output, 'samba.candidate.conf');
        const messages = [];
        let published = false;
        const outputFilesystem = options.outputFilesystem;
        options.outputFilesystem = {
          ...outputFilesystem,
          openSync(entry, flags, mode) {
            if (fault === 'exclusive-race' && entry === candidate)
              fs.writeFileSync(entry, 'FOREIGN_SENTINEL', { mode: 0o600, flag: 'wx' });
            return fs.openSync(entry, flags, mode);
          },
          fstatSync(fd, opts) {
            if (fault === 'fstat-failure') throw new Error('SECRET_SENTINEL');
            return outputFilesystem.fstatSync(fd, opts);
          },
          writeFileSync(fd, bytes) {
            if (fault === 'replaced-inode') {
              fs.renameSync(candidate, path.join(output, 'displaced-own-file'));
              fs.writeFileSync(candidate, 'FOREIGN_SENTINEL', { mode: 0o600, flag: 'wx' });
              throw new Error('SECRET_SENTINEL');
            }
            return fs.writeFileSync(fd, bytes);
          },
        };
        const result = runPlan(['--prepare', output, '--component', 'samba'], {
          ...options,
          diagnostic: (m) => messages.push(m),
          report: () => {
            published = true;
          },
        });
        expect(result.code).toBe(1);
        expect(published).toBe(false);
        expect(messages.join('')).not.toContain('SECRET_SENTINEL');
        if (fault === 'fstat-failure') {
          expect(fs.existsSync(candidate)).toBe(true);
          expect(messages).toEqual([
            'NAS isolation: preparation failed; private partial outputs retained',
          ]);
        } else expect(fs.readFileSync(candidate, 'utf8')).toBe('FOREIGN_SENTINEL');
        if (fault === 'replaced-inode')
          expect(messages).toEqual([
            'NAS isolation: preparation failed; private partial outputs retained',
          ]);
        expect(fs.existsSync(path.join(output, 'receipt.json'))).toBe(false);
      }),
  );
  it.each([
    'mode',
    'nonempty',
    'symlink',
    'ssd',
    'owner',
    'failed-validation',
    'late-drift',
    'write-failure',
  ])('refuses private output %s without publishing a partial plan', (fault) =>
    fixture((options) => {
      const output = options.physical('/output');
      let published = false;
      if (fault === 'mode') fs.chmodSync(output, 0o755);
      if (fault === 'nonempty') fs.writeFileSync(path.join(output, 'sentinel'), 'untouched');
      if (fault === 'symlink') {
        fs.rmdirSync(output);
        fs.symlinkSync(options.physical('/DATA/nas'), output);
      }
      const original = options.execute;
      options.execute = (cmd, args, opts) => {
        if (fault === 'ssd' && cmd === '/usr/bin/findmnt' && args[2] === output)
          return '{"filesystems":[]}';
        if (cmd === '/usr/bin/testparm' && args[1].endsWith('samba.validation-root.conf')) {
          if (fault === 'failed-validation') throw new Error('SECRET_SENTINEL');
          if (fault === 'late-drift')
            fs.appendFileSync(options.physical('/etc/samba/smb.casa.conf'), '# drift\n');
        }
        return original(cmd, args, opts);
      };
      if (fault === 'owner') {
        const outputFilesystem = options.outputFilesystem;
        options.outputFilesystem = {
          ...outputFilesystem,
          lstatSync(entry, opts) {
            const s = outputFilesystem.lstatSync(entry, opts);
            return Object.assign(s, entry === output ? { uid: 0n } : {});
          },
        };
      }
      if (fault === 'write-failure')
        options.outputFilesystem = {
          ...options.outputFilesystem,
          writeFileSync() {
            throw new Error('SECRET_SENTINEL');
          },
        };
      const messages = [];
      const result = runPlan(['--prepare', output, '--component', 'samba'], {
        ...options,
        diagnostic: (m) => messages.push(m),
        report: () => {
          published = true;
        },
      });
      expect(result.code).toBe(1);
      expect(published).toBe(false);
      expect(messages.join('')).not.toContain('SECRET_SENTINEL');
      if (!['nonempty', 'symlink'].includes(fault)) expect(fs.readdirSync(output)).toEqual([]);
      if (fault === 'nonempty')
        expect(fs.readFileSync(path.join(output, 'sentinel'), 'utf8')).toBe('untouched');
    }),
  );
});
