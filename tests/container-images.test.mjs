import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { chmodSync, lstatSync, readlinkSync, renameSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Independent owner-contract expectation, not derived from the implementation list.
const approvedPayloads = [
  ['@fastify+ajv-compiler@4.0.6', '@fastify/ajv-compiler', 'test'],
  ['@fastify+error@4.2.0', '@fastify/error', 'test'],
  ['@fastify+fast-json-stringify-compiler@5.1.0', '@fastify/fast-json-stringify-compiler', 'test'],
  ['@fastify+merge-json-schemas@0.2.1', '@fastify/merge-json-schemas', 'test'],
  ['@fastify+proxy-addr@5.1.1', '@fastify/proxy-addr', 'test'],
  ['@pinojs+redact@0.4.0', '@pinojs/redact', 'test'],
  ...[
    'avvio@9.3.0',
    'fast-json-stringify@6.4.0',
    'fast-json-stringify@7.0.1',
    'fast-uri@3.1.8',
    'fast-uri@4.2.1',
    'fastify@5.8.5',
    'fastq@1.20.3',
    'find-my-way@9.9.0',
    'json-schema-ref-resolver@3.0.0',
    'light-my-request@6.6.0',
    'on-exit-leak-free@2.1.2',
    'pg-types@2.2.0',
    'pino-abstract-transport@3.0.0',
    'pino-std-serializers@7.1.0',
    'pino@10.4.0',
    'process-warning@4.0.1',
    'process-warning@5.1.0',
    'quick-format-unescaped@4.0.4',
    'rfdc@1.4.1',
    'safe-regex2@5.1.1',
    'secure-json-parse@4.1.0',
    'thread-stream@4.2.0',
  ].map((store) => [store, store.slice(0, store.lastIndexOf('@')), 'test']),
  ['json-schema-traverse@1.0.0', 'json-schema-traverse', 'spec/fixtures'],
  ...['fixtures', 'test', 'types/tests'].map((dir) => ['sonic-boom@4.2.1', 'sonic-boom', dir]),
  ...['4.3.6', '4.6.5'].flatMap((version) =>
    ['v3/tests', 'v4/classic/tests', 'v4/core/tests', 'v4/mini/tests'].map((dir) => [
      `zod@${version}`,
      'zod',
      `src/${dir}`,
    ]),
  ),
]
  .map(([store, name, dir]) => `node_modules/.pnpm/${store}/node_modules/${name}/${dir}`)
  .sort();

function payloadFixture() {
  const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-api-assembly-'));
  const out = path.join(temp, 'out');
  const evidence = path.join(temp, 'evidence');
  const put = (name, bytes = 'runtime sentinel') => {
    const p = path.join(out, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, bytes);
    return p;
  };
  put('package.json', '{"name":"fixture","version":"1.0.0","main":"dist/server.js"}');
  put('dist/server.js');
  for (const target of approvedPayloads) {
    const [, store, name] = target.match(
      /^node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//,
    );
    const packageRoot = `node_modules/.pnpm/${store}/node_modules/${name}`;
    put(
      `${packageRoot}/package.json`,
      JSON.stringify({
        name,
        version: store.slice(store.lastIndexOf('@') + 1),
        main: 'index.js',
        exports: './index.js',
      }),
    );
    put(`${packageRoot}/index.js`);
    put(`${target}/nested/test.js`, 'unnecessary payload');
  }
  const run = (mutate = (script) => script) => {
    const dockerfile = read('infrastructure/docker/api.Dockerfile');
    const match = dockerfile.match(
      /RUN node --input-type=module - \/out \/assembly-evidence <<'API_ASSEMBLY'\n([\s\S]*?)\nAPI_ASSEMBLY/,
    );
    expect(
      match,
      'Dockerfile must execute the testable inline assembly, not a test substitute',
    ).not.toBeNull();
    const result = spawnSync(process.execPath, ['--input-type=module', '-', out, evidence], {
      input: mutate(match[1]),
      encoding: 'utf8',
      timeout: 10000,
    });
    return result;
  };
  return { temp, out, evidence, put, run };
}

describe('exact API test-payload assembly', () => {
  it('uses supported workspace-hoist suppression for the observed deploy self-link', () => {
    expect(read('infrastructure/docker/api.Dockerfile')).toContain(
      'deploy --legacy --prod --no-optional --config.hoist-workspace-packages=false /out',
    );
  });
  for (const fault of [
    'observed self',
    'wrong name',
    'wrong version',
    'wrong entry',
    'wrong slot',
    'other target',
    'dangling',
    'cycle',
    'root alias',
    'parent',
    'removal',
    'absolute retained',
  ]) {
    it(`refuses ${fault} links with complete raw diagnostics before any deletion`, () => {
      const f = payloadFixture();
      try {
        const bytes = JSON.stringify({ name: '@cupmemo/api', version: '0.1.0' });
        f.put('package.json', bytes);
        const source = path.join(f.temp, 'work/apps/api');
        mkdirSync(source, { recursive: true });
        writeFileSync(
          path.join(source, 'package.json'),
          fault === 'wrong name'
            ? '{"name":"third-party","version":"0.1.0"}'
            : fault === 'wrong version'
              ? '{"name":"@cupmemo/api","version":"999.0.0"}'
              : bytes,
        );
        if (fault === 'wrong entry')
          writeFileSync(path.join(source, 'server.js'), 'not runtime payload');
        const rel =
          fault === 'wrong slot'
            ? 'dist/api-alias'
            : 'node_modules/.pnpm/node_modules/@cupmemo/api';
        const link = path.join(f.out, rel);
        mkdirSync(path.dirname(link), { recursive: true });
        let target = source;
        if (fault === 'other target') {
          target = path.join(f.temp, 'work/apps/other');
          mkdirSync(target, { recursive: true });
        }
        if (fault === 'dangling') target = path.join(f.temp, 'absent');
        if (fault === 'cycle') target = link;
        if (fault === 'root alias') target = f.out;
        if (fault === 'parent') target = f.temp;
        if (fault === 'removal') target = path.join(f.out, approvedPayloads[0]);
        if (fault === 'absolute retained') target = path.join(f.out, 'dist/server.js');
        const readlink =
          fault === 'absolute retained' ? target : path.relative(path.dirname(link), target);
        symlinkSync(readlink, link);
        const run = f.run();
        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toMatch(/confinement|symlink/);
        expect(existsSync(path.join(f.out, approvedPayloads[0]))).toBe(true);
        expect(readlinkSync(link)).toBe(readlink);
        expect(
          existsSync(path.join(f.evidence, 'raw.json')),
          'complete pre-mutation raw evidence must survive refusal',
        ).toBe(true);
        const raw = JSON.parse(readFileSync(path.join(f.evidence, 'raw.json'), 'utf8'));
        expect(raw.link_inventory.find((item) => item.path === rel)).toMatchObject({
          readlink,
          source_package: { name: '@cupmemo/api', version: '0.1.0' },
          runtime_package: { name: '@cupmemo/api', version: '0.1.0' },
        });
        expect(raw.raw_snapshot[rel].link).toBe(readlink);
        expect(run.stdout).toContain('raw-link-inventory');
        expect(existsSync(path.join(f.evidence, 'assembly.json'))).toBe(false);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  it('imports the retained compiled fixture after relocation with no builder tree', () => {
    const f = payloadFixture();
    try {
      f.put('package.json', '{"name":"@cupmemo/api","version":"0.1.0","type":"module"}');
      const pkg = 'node_modules/.pnpm/retained-runtime@1.0.0/node_modules/retained-runtime';
      f.put(
        `${pkg}/package.json`,
        '{"name":"retained-runtime","version":"1.0.0","type":"module","exports":"./index.js"}',
      );
      f.put(`${pkg}/index.js`, 'export const portable = 32;');
      symlinkSync(
        '.pnpm/retained-runtime@1.0.0/node_modules/retained-runtime',
        path.join(f.out, 'node_modules/retained-runtime'),
      );
      f.put(
        'dist/app.js',
        "import {portable} from 'retained-runtime'; if(portable!==32) throw Error('bad entry'); console.log(portable);",
      );
      const run = f.run();
      expect(run.status, run.stderr).toBe(0);
      const app = path.join(f.temp, 'app');
      renameSync(f.out, app);
      const imported = spawnSync(process.execPath, [path.join(app, 'dist/app.js')], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(imported.status, imported.stderr).toBe(0);
      expect(imported.stdout.trim()).toBe('32');
      const evidence = JSON.parse(readFileSync(path.join(f.evidence, 'assembly.json'), 'utf8'));
      expect(evidence.retained_before).toEqual(evidence.retained_after);
      expect(evidence.link_inventory).toHaveLength(1);
    } finally {
      rmSync(f.temp, { recursive: true, force: true });
    }
  });
  for (const fault of ['root deletion', 'baseline reset mutation']) {
    it(`refuses ${fault} without resetting the raw baseline or deleting the root`, () => {
      const f = payloadFixture();
      try {
        const run = f.run((script) =>
          fault === 'root deletion'
            ? script.replace('for(const root of roots)', "roots[0]='';\nfor(const root of roots)")
            : script.replace(
                'const before=',
                "writeFileSync(join(out,'dist/server.js'),'corrupt');\nconst before=",
              ),
        );
        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toMatch(/confinement|retained payload changed/);
        expect(existsSync(path.join(f.out, 'package.json'))).toBe(true);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  for (const [nested, privatePackage] of [
    ['benchmark', true],
    ['dist/esm', false],
  ]) {
    it(`preserves nested ${nested} metadata without treating it as a dependency root`, () => {
      const f = payloadFixture();
      try {
        const pkg = 'node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri';
        const rel = `${pkg}/${nested}/package.json`;
        const bytes = JSON.stringify({
          name: 'nested-scope',
          version: '1.0.0',
          private: privatePackage,
          type: 'module',
          main: 'index.js',
          exports: './absent.js',
        });
        f.put(rel, bytes);
        f.put(`${pkg}/${nested}/resource.txt`, 'preserved nested resource');
        const before = lstatSync(path.join(f.out, rel));
        const run = f.run();
        expect(run.status, run.stderr).toBe(0);
        expect(readFileSync(path.join(f.out, rel), 'utf8')).toBe(bytes);
        expect(existsSync(path.join(f.out, pkg, nested, 'index.js'))).toBe(false);
        expect(readFileSync(path.join(f.out, pkg, nested, 'resource.txt'), 'utf8')).toBe(
          'preserved nested resource',
        );
        const evidence = JSON.parse(readFileSync(path.join(f.evidence, 'assembly.json'), 'utf8'));
        expect(evidence.retained_before).toEqual(evidence.retained_after);
        expect(evidence.retained_after[rel]).toMatchObject({
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ino: before.ino,
          mode: before.mode,
          mtime_ms: before.mtimeMs,
        });
        expect(evidence.entries.some((entry) => entry.package === rel)).toBe(false);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  for (const pkg of [
    'node_modules/direct-runtime',
    'node_modules/@scope/runtime',
    'node_modules/.pnpm/runtime@1.0.0/node_modules/runtime',
    'node_modules/.pnpm/@scope+runtime@1.0.0/node_modules/@scope/runtime',
    'node_modules/parent/node_modules/nested-runtime',
  ]) {
    for (const kind of ['main', 'exports']) {
      it(`rejects missing ${kind} at runtime boundary ${pkg} before deletion`, () => {
        const f = payloadFixture();
        try {
          f.put(
            `${pkg}/package.json`,
            JSON.stringify({ name: 'runtime', version: '1.0.0', [kind]: './absent.js' }),
          );
          const run = f.run();
          expect(run.status, run.stderr).not.toBe(0);
          expect(run.stderr).toContain(`${kind === 'main' ? 'entry' : 'export'} target missing:`);
          expect(existsSync(path.join(f.out, approvedPayloads[0], 'nested/test.js'))).toBe(true);
          expect(existsSync(path.join(f.evidence, 'assembly.json'))).toBe(false);
        } finally {
          rmSync(f.temp, { recursive: true, force: true });
        }
      });
    }
  }
  it('validates actual package boundaries even without name/version metadata', () => {
    const f = payloadFixture();
    try {
      f.put('node_modules/runtime/package.json', '{"private":true,"main":"absent.js"}');
      const run = f.run();
      expect(run.status, run.stderr).not.toBe(0);
      expect(run.stderr).toContain('entry target missing:');
      expect(existsSync(path.join(f.out, approvedPayloads[0]))).toBe(true);
    } finally {
      rmSync(f.temp, { recursive: true, force: true });
    }
  });
  it('deduplicates direct, scoped and nested aliases of a pnpm real package root', () => {
    const f = payloadFixture();
    try {
      const pkg = 'node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri';
      for (const alias of [
        'node_modules/uri-alias',
        'node_modules/@scope/uri-alias',
        'node_modules/parent/node_modules/uri-alias',
        'node_modules/.pnpm/node_modules/uri-alias',
      ]) {
        const target = path.join(f.out, alias);
        mkdirSync(path.dirname(target), { recursive: true });
        symlinkSync(path.relative(path.dirname(target), path.join(f.out, pkg)), target);
      }
      const run = f.run();
      expect(run.status, run.stderr).toBe(0);
      const evidence = JSON.parse(readFileSync(path.join(f.evidence, 'assembly.json'), 'utf8'));
      expect(evidence.entries.filter((entry) => entry.package === `${pkg}/package.json`)).toEqual([
        { package: `${pkg}/package.json`, kind: 'main', target: `${pkg}/index.js` },
        { package: `${pkg}/package.json`, kind: 'export', target: `${pkg}/index.js` },
        { package: `${pkg}/package.json`, kind: 'export', target: `${pkg}/index.js` },
      ]);
      expect(evidence.entries.some((entry) => entry.package.includes('uri-alias'))).toBe(false);
      expect(evidence.retained_before).toEqual(evidence.retained_after);
    } finally {
      rmSync(f.temp, { recursive: true, force: true });
    }
  });
  for (const destination of ['sibling', 'parent']) {
    it(`refuses package aliases to the external ${destination} before deletion`, () => {
      const f = payloadFixture();
      try {
        const external = destination === 'parent' ? f.temp : path.join(f.temp, 'external');
        mkdirSync(external, { recursive: true });
        const bytes = '{"name":"external","version":"1.0.0"}';
        writeFileSync(path.join(external, 'package.json'), bytes);
        symlinkSync(external, path.join(f.out, 'node_modules/external'));
        const run = f.run();
        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toContain('confinement:');
        expect(readFileSync(path.join(external, 'package.json'), 'utf8')).toBe(bytes);
        expect(existsSync(path.join(f.out, approvedPayloads[0]))).toBe(true);
        expect(existsSync(path.join(f.evidence, 'assembly.json'))).toBe(false);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  it('accepts the installed Better Auth exports without shipping dormant dev-source targets', () => {
    const f = payloadFixture();
    try {
      const installed = path.join(
        root,
        'node_modules/.pnpm/@better-auth+drizzle-adapter@1.7.7_@better-auth+core@1.7.7_@better-auth+utils@0.4.2_@be_866e6372712699d3ce53c2c24adcd989/node_modules/@better-auth/drizzle-adapter',
      );
      const manifestBytes = readFileSync(path.join(installed, 'package.json'), 'utf8');
      const manifest = JSON.parse(manifestBytes);
      const pkg = 'node_modules/@better-auth/drizzle-adapter';
      f.put(`${pkg}/package.json`, manifestBytes);
      for (const target of Object.values(manifest.exports)) {
        expect(existsSync(path.join(installed, target['dev-source']))).toBe(false);
        f.put(`${pkg}/${target.default}`, readFileSync(path.join(installed, target.default)));
      }
      const run = f.run();
      expect(run.status, run.stderr).toBe(0);
      expect(readFileSync(path.join(f.out, pkg, 'package.json'), 'utf8')).toBe(manifestBytes);
      const evidence = JSON.parse(readFileSync(path.join(f.evidence, 'assembly.json'), 'utf8'));
      expect(evidence.retained_before).toEqual(evidence.retained_after);
    } finally {
      rmSync(f.temp, { recursive: true, force: true });
    }
  });
  for (const [name, exports] of [
    [
      'dormant conditions',
      {
        types: './absent.d.ts',
        'dev-source': './src.ts',
        bun: './bun.js',
        browser: './browser.js',
        custom: './custom.js',
        node: './index.js',
      },
    ],
    ['default before node', { default: './index.js', node: './absent.js' }],
    [
      'node before import and require',
      { node: './index.js', import: './absent.mjs', require: './absent.cjs' },
    ],
    ['nested unmatched condition', { node: { custom: './absent.js' }, default: './index.js' }],
    ['array first resolved target', [{ custom: './absent.js' }, './index.js', './absent.js']],
    ['null blocks fallback', { node: null, default: './absent.js' }],
    [
      'separate import and require',
      { import: './index.js', require: './index.js', default: './absent.js' },
    ],
  ]) {
    it(`preserves Node export selection for ${name}`, () => {
      const f = payloadFixture();
      try {
        f.put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', exports }));
        f.put('index.js');
        const run = f.run();
        expect(run.status, run.stderr).toBe(0);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  for (const exports of [
    { import: './absent.mjs', require: './index.js' },
    { import: './index.js', require: './absent.cjs' },
    { node: './absent.js', default: './index.js' },
    { default: './absent.js', node: './index.js' },
    ['./absent.js', './index.js'],
    { './feature': { node: { import: './absent.js', require: './index.js' } } },
  ]) {
    it(`rejects missing selected runtime export ${JSON.stringify(exports)} before deletion`, () => {
      const f = payloadFixture();
      try {
        f.put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', exports }));
        f.put('index.js');
        const run = f.run();
        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toContain('export target missing:');
        expect(existsSync(path.join(f.out, approvedPayloads[0], 'nested/test.js'))).toBe(true);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  for (const fault of ['evidence directory symlink', 'evidence file symlink']) {
    it(`refuses ${fault} before deletion or external writes`, () => {
      const f = payloadFixture();
      try {
        const external = path.join(f.temp, 'external');
        mkdirSync(external);
        const sentinel = path.join(external, 'assembly.json');
        writeFileSync(sentinel, 'external sentinel');
        if (fault === 'evidence directory symlink') symlinkSync(external, f.evidence);
        else {
          mkdirSync(f.evidence);
          symlinkSync(sentinel, path.join(f.evidence, 'assembly.json'));
        }
        const run = f.run();
        expect(run.status, run.stderr).not.toBe(0);
        expect(readFileSync(sentinel, 'utf8')).toBe('external sentinel');
        expect(existsSync(path.join(f.out, approvedPayloads[0]))).toBe(true);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  for (const fault of [
    'missing late target',
    'version drift',
    'file target',
    'removed main',
    'missing export',
    'removed wildcard export',
    'retained link into deletion',
    'path escape',
  ]) {
    it(`preflights ${fault} before deleting any approved payload`, () => {
      const f = payloadFixture();
      try {
        const target = approvedPayloads.at(-1);
        const pkg = target.slice(0, target.indexOf('/src/'));
        let mutate = (script) => script;
        if (fault === 'missing late target') rmSync(path.join(f.out, target), { recursive: true });
        if (fault === 'version drift')
          f.put(`${pkg}/package.json`, '{"name":"zod","version":"999.0.0","main":"index.js"}');
        if (fault === 'file target') {
          rmSync(path.join(f.out, target), { recursive: true });
          f.put(target);
        }
        if (fault === 'removed main')
          f.put(
            `${pkg}/package.json`,
            '{"name":"zod","version":"4.6.5","main":"src/v4/mini/tests/nested/test.js"}',
          );
        if (fault === 'missing export')
          f.put(
            `${pkg}/package.json`,
            '{"name":"zod","version":"4.6.5","exports":{"import":"./absent.js"}}',
          );
        if (fault === 'removed wildcard export')
          f.put(
            `${pkg}/package.json`,
            '{"name":"zod","version":"4.6.5","exports":{"./*":"./src/v4/mini/tests/nested/*.js"}}',
          );
        if (fault === 'retained link into deletion')
          symlinkSync(`../${target}/nested/test.js`, path.join(f.out, 'dist/unsafe.js'));
        if (fault === 'path escape')
          mutate = (script) =>
            script.replace("'src/v4/mini/tests'", "'../../../../../../../../escape'");
        const run = f.run(mutate);
        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toMatch(/preflight|target|symlink|version|export|entry|confinement/);
        expect(existsSync(path.join(f.out, approvedPayloads[0], 'nested/test.js'))).toBe(true);
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  // Each ancestor (including /out and the target itself) must be checked with lstat.
  const symlinkTarget = approvedPayloads.at(-1);
  const components = symlinkTarget.split('/');
  for (let depth = 0; depth <= components.length; depth++) {
    it(`refuses symlink traversal at target ancestor depth ${depth} without deleting inside or outside /out`, () => {
      const f = payloadFixture();
      try {
        const victim = path.join(f.out, ...components.slice(0, depth));
        const external = path.join(f.temp, 'external');
        renameSync(victim, external);
        symlinkSync(external, victim);
        const run = f.run();
        expect(run.status, run.stderr).not.toBe(0);
        expect(run.stderr).toMatch(/symlink/);
        expect(existsSync(path.join(external, ...components.slice(depth), 'nested/test.js'))).toBe(
          true,
        );
      } finally {
        rmSync(f.temp, { recursive: true, force: true });
      }
    });
  }
  it('detects retained byte changes rather than merely reporting a successful deletion', () => {
    const f = payloadFixture();
    try {
      const run = f.run((script) =>
        script.replace(
          'const after=snapshot();',
          "writeFileSync(join(out,'dist/server.js'),'corrupted');\nconst after=snapshot();",
        ),
      );
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('retained payload changed');
    } finally {
      rmSync(f.temp, { recursive: true, force: true });
    }
  });
  it('removes exactly the 40 approved roots while retaining adjacent runtime bytes, metadata and links', () => {
    const f = payloadFixture();
    try {
      const unapproved = f.put('node_modules/adjacent-runtime/tests/unknown.js');
      const adjacent = f.put(
        'node_modules/.pnpm/thread-stream@4.2.0/node_modules/thread-stream/lib/worker.js',
      );
      chmodSync(adjacent, 0o751);
      const link = path.join(f.out, 'dist/worker-link.js');
      symlinkSync(
        '../node_modules/.pnpm/thread-stream@4.2.0/node_modules/thread-stream/lib/worker.js',
        link,
      );
      const before = {
        stat: lstatSync(adjacent),
        hash: createHash('sha256').update(readFileSync(adjacent)).digest('hex'),
        link: readlinkSync(link),
      };
      const run = f.run();
      expect(run.status, run.stderr).toBe(0);
      for (const target of approvedPayloads)
        expect(existsSync(path.join(f.out, target)), target).toBe(false);
      expect(existsSync(unapproved)).toBe(true);
      expect(readFileSync(adjacent, 'utf8')).toBe('runtime sentinel');
      expect(lstatSync(adjacent).mode).toBe(before.stat.mode);
      expect(lstatSync(adjacent).mtimeMs).toBe(before.stat.mtimeMs);
      expect(readlinkSync(link)).toBe(before.link);
      const manifest = JSON.parse(readFileSync(path.join(f.evidence, 'assembly.json'), 'utf8'));
      expect(manifest.removed.map((p) => p.path).sort()).toEqual(approvedPayloads);
      expect(
        manifest.removed.every(
          (p) => p.files === 1 && p.bytes === Buffer.byteLength('unnecessary payload'),
        ),
      ).toBe(true);
      expect(manifest.retained_before).toEqual(manifest.retained_after);
      expect(
        manifest.retained_before[
          'node_modules/.pnpm/thread-stream@4.2.0/node_modules/thread-stream/lib/worker.js'
        ].sha256,
      ).toBe(before.hash);
      expect(existsSync(path.join(f.out, 'assembly.json'))).toBe(false);
    } finally {
      rmSync(f.temp, { recursive: true, force: true });
    }
  });
});

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const base =
  'node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5';

// This is deliberately opt-in: the coder must serialize required Docker work.
// Unlike a home-grown glob/regex matcher, BuildKit exercises Docker's real ignore
// semantics, including directory pruning and nested files. No RUN, base pull,
// image export, container, host mount, port or database is involved.
const probe = process.env.CUPMEMO_CONTEXT_PROBE === '1' ? it : it.skip;

describe('application image preparation', () => {
  it('executes CI retained Fastify injection, Pino logging and Zod validation against real packages', () => {
    const workflow = read('.github/workflows/ci.yml');
    const body = workflow.match(
      / {10}\/\/ BEGIN retained API behavior\n([\s\S]*?) {10}\/\/ END retained API behavior/,
    );
    expect(body, 'CI must execute retained behavior, not just imports').not.toBeNull();
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          "import assert from 'node:assert/strict';",
          "import {createRequire} from 'node:module';",
          "import {realpathSync,existsSync} from 'node:fs';",
          "import {dirname,join} from 'node:path';",
          body[1],
          'console.log(JSON.stringify({behavior,resources}));',
        ].join('\n'),
      ],
      { cwd: path.join(root, 'apps/api'), encoding: 'utf8', timeout: 10000 },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({
      behavior: { valid: 200, invalid_schema: 400, invalid_zod: 422, pino_logged: true },
      resources: expect.any(Array),
    });
  });
  it('traces the repository root from the ESM config and preserves API rewrites', async () => {
    const { default: config } = await import('../apps/web/next.config.ts');
    expect(config.output).toBe('standalone');
    expect(config.outputFileTracingRoot).toBe(path.resolve(root));
    expect(await config.rewrites()).toEqual([
      {
        source: '/api/v1/:path*',
        destination: `${process.env.CUPMEMO_API_ORIGIN ?? 'http://127.0.0.1:4101'}/api/v1/:path*`,
      },
    ]);
  });
  it('audits standalone paths and loads declared API and PWA/session runtime boundaries in CI', () => {
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).not.toContain("'/app/apps','/app/packages'");
    expect(workflow).toContain("['node','apps/web/server.js']");
    expect(workflow).toContain('apps/web/.next/routes-manifest.json');
    expect(workflow).toContain("'/manifest.webmanifest'");
    expect(workflow).toContain("'/app', {redirect:'manual',signal:AbortSignal.timeout(2000)}");
    expect(workflow).toContain('Object.keys(manifest.dependencies ?? {})');
    expect(workflow).toContain("databaseRequire.resolve('pg')");
    expect(workflow).toContain('omitted_optional');
    expect(workflow).toContain("'next','react','react-dom'");
  });
  it('accepts traced monorepo layout but rejects first-party source and tooling in the actual CI audit', () => {
    const workflow = read('.github/workflows/ci.yml');
    const audit = workflow.match(/ {10}audit = r'''\n([\s\S]*?) {10}'''/)[1];
    const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-runtime-audit-'));
    const app = path.join(temp, 'app');
    const baseModules = path.join(temp, 'base');
    const put = (name, bytes = '{}') => {
      const target = path.join(app, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    };
    const runAudit = () => {
      const script = audit
        .replace('__BASE_NPM_CONFIG__', JSON.stringify({ path: '/not-present', sha256: '' }))
        .replace(/\/app(?=\/|')/g, app)
        .replaceAll('/usr/local/lib/node_modules', baseModules);
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(run.status, run.stderr).toBe(0);
      return JSON.parse(run.stdout);
    };
    try {
      mkdirSync(baseModules);
      put('apps/web/server.js');
      put('apps/web/.next/server/app/app/page.js');
      put('packages/contracts/dist/index.js');
      put(
        'node_modules/runtime/package.json',
        JSON.stringify({
          name: 'runtime',
          version: '1.0.0',
          peerDependenciesMeta: { absent: { optional: true } },
        }),
      );
      const clean = runAudit();
      expect(clean.forbidden).toEqual([]);
      expect(clean.tooling).toEqual([]);
      expect(clean.omitted_optional).toEqual([
        expect.objectContaining({ name: 'absent', resolved: false }),
      ]);
      put('node_modules/unapproved/tests/probe.js');
      put('apps/web/src/probe.ts');
      put('apps/web/.next/cache/probe');
      put('packages/contracts/tsconfig.json');
      put('node_modules/typescript/package.json', '{"name":"typescript","version":"5.9.3"}');
      put('apps/web/.env.production', 'non-secret sentinel');
      const dirty = runAudit();
      for (const name of [
        'node_modules/unapproved/tests',
        'apps/web/src',
        'apps/web/.next/cache',
        'packages/contracts/tsconfig.json',
        'apps/web/.env.production',
      ]) {
        expect(dirty.forbidden).toContain(path.join(app, name));
      }
      expect(dirty.tooling).toEqual([expect.objectContaining({ name: 'typescript' })]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
  for (const service of ['web', 'api']) {
    it(`${service} has an immutable, nonroot compiled runtime contract`, () => {
      const filename = `infrastructure/docker/${service}.Dockerfile`;
      expect(existsSync(path.join(root, filename)), `missing ${filename}`).toBe(true);
      const dockerfile = read(filename);
      const from = [...dockerfile.matchAll(/^FROM (\S+) AS (\S+)$/gm)];
      expect(from.map((entry) => entry[1])).toEqual(
        service === 'api' ? [base, 'scratch', base] : [base, base],
      );
      if (service === 'api') {
        expect(from.map((entry) => entry[2])).toEqual(['build', 'assembly-evidence', 'runtime']);
        expect(dockerfile).toContain('COPY --from=build /assembly-evidence/ /');
        expect(dockerfile.split(' AS runtime')[1]).not.toContain('assembly-evidence');
      }
      expect(dockerfile).toContain('pnpm@10.34.6');
      expect(dockerfile).toContain('install --frozen-lockfile');
      if (service === 'api') {
        expect(dockerfile).toContain(
          '--filter @cupmemo/api deploy --legacy --prod --no-optional --config.hoist-workspace-packages=false /out',
        );
      } else {
        expect(dockerfile).not.toMatch(/\bdeploy\b/);
      }
      expect(dockerfile).toContain('USER node');
      expect(dockerfile).toContain(`EXPOSE ${service === 'web' ? 3101 : 4101}`);
      expect(dockerfile).not.toMatch(
        /^(?:ARG|ADD)\s|COPY\s+\.\s|NEXT_PUBLIC_|BETTER_AUTH_SECRET|DATABASE_URL/gm,
      );
      const runtime = dockerfile.split(' AS runtime')[1];
      expect(runtime).not.toMatch(/corepack|pnpm|npm install|\/src\b/);
      const command = JSON.parse(runtime.match(/^CMD (.+)$/m)[1]);
      expect(command[0]).toBe('node');
      if (service === 'web') {
        expect(dockerfile).toContain('CUPMEMO_API_ORIGIN=http://cupmemo-api:4101');
        expect(command).toEqual(['node', 'apps/web/server.js']);
        expect(runtime).toContain('HOSTNAME=0.0.0.0 PORT=3101');
        expect(runtime).toContain('/work/apps/web/.next/standalone/ ./');
        expect(runtime).toContain('/work/apps/web/public/ ./apps/web/public/');
        expect(runtime).toContain('/work/apps/web/.next/static/ ./apps/web/.next/static/');
        expect(runtime).not.toContain('/out/');
      } else {
        expect(command).toEqual(['node', 'dist/server.js']);
        expect(dockerfile).toContain('CUPMEMO_API_HOST=0.0.0.0');
        expect(dockerfile).toContain('CUPMEMO_API_PORT=4101');
        expect(dockerfile).toContain('packages/database/dist');
        expect(dockerfile).toContain('packages/database/drizzle');
        expect(dockerfile).toContain('packages/contracts/dist');
      }
      // Every build-context COPY is explicitly allowlisted, never a directory root.
      for (const line of dockerfile
        .split('\n')
        .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))) {
        const inputs = line.slice(5).trim().split(/\s+/).slice(0, -1);
        for (const input of inputs) {
          expect(input).toMatch(
            /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.json|(?:apps|packages)\/(?:web|api|contracts|database|ui|config)\/(?:package\.json|tsconfig\.json|next-env\.d\.ts|next\.config\.ts|postcss\.config\.mjs|src|public|drizzle))$/,
          );
          expect(existsSync(path.join(root, input)), input).toBe(true);
        }
      }
    });
  }

  probe(
    'Docker excludes private/residue sentinels while retaining every allowlisted build input',
    () => {
      const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-image-context-'));
      const context = path.join(temp, 'context');
      const output = path.join(temp, 'output');
      mkdirSync(context);
      const put = (name, bytes = 'non-secret image context sentinel\n') => {
        const target = path.join(context, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      };
      try {
        put('.dockerignore', read('.dockerignore'));
        const retained = new Set();
        for (const service of ['web', 'api']) {
          for (const line of read(`infrastructure/docker/${service}.Dockerfile`)
            .split('\n')
            .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))) {
            for (const input of line.slice(5).trim().split(/\s+/).slice(0, -1)) {
              const fixture = /\.(json|yaml|ts|mjs)$/.test(input)
                ? input
                : `${input}/context-probe.txt`;
              retained.add(fixture);
            }
          }
        }
        const forbidden = [
          '.git/config',
          '.git',
          '.worktrees/task/source',
          'node_modules/probe',
          'apps/web/node_modules/probe',
          'apps/web/.next/probe',
          'packages/ui/dist/probe',
          '.env',
          '.env.production',
          'apps/api/.env.local',
          '.npmrc',
          '.pnpmfile.cjs',
          'apps/web/src/private.key',
          'apps/api/src/.env',
          'packages/database/src/probe.pem',
          'secrets/probe',
          'data/probe',
          'backups/probe.sql',
          'uploads/probe',
          'evidence/probe',
          'PGDATA/probe',
          'apps/api/src/probe.log',
        ];
        // A worktree .git is a file, not a directory; exercise both forms separately.
        for (const fixture of forbidden.filter((name) => name !== '.git')) put(fixture);
        for (const fixture of retained) put(fixture);
        const dockerfile = path.join(temp, 'context.Dockerfile');
        writeFileSync(dockerfile, 'FROM scratch\nCOPY . /\n');
        const run = spawnSync(
          'docker',
          [
            'buildx',
            'build',
            '--network=none',
            '--progress=plain',
            '--file',
            dockerfile,
            '--output',
            `type=local,dest=${output}`,
            context,
          ],
          { encoding: 'utf8', timeout: 120000 },
        );
        expect(run.error, run.stderr).toBeUndefined();
        expect(run.status, run.stderr).toBe(0);
        for (const fixture of retained)
          expect(existsSync(path.join(output, fixture)), fixture).toBe(true);
        for (const fixture of forbidden)
          expect(existsSync(path.join(output, fixture)), fixture).toBe(false);
        rmSync(path.join(context, '.git'), { recursive: true });
        put('.git');
        rmSync(output, { recursive: true });
        const worktree = spawnSync(
          'docker',
          [
            'buildx',
            'build',
            '--network=none',
            '--progress=plain',
            '--file',
            dockerfile,
            '--output',
            `type=local,dest=${output}`,
            context,
          ],
          { encoding: 'utf8', timeout: 120000 },
        );
        expect(worktree.status, worktree.stderr).toBe(0);
        expect(existsSync(path.join(output, '.git'))).toBe(false);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    },
    // Allow both 120s child-process limits plus setup, assertions and cleanup.
    300000,
  );
});
