import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const members = {
  'apps/web': '@cupmemo/web',
  'apps/api': '@cupmemo/api',
  'packages/database': '@cupmemo/database',
  'packages/contracts': '@cupmemo/contracts',
  'packages/ui': '@cupmemo/ui',
  'packages/config': '@cupmemo/config',
};
const appNames = new Set(['@cupmemo/web', '@cupmemo/api']);
const packageNames = new Set([
  '@cupmemo/database',
  '@cupmemo/contracts',
  '@cupmemo/ui',
  '@cupmemo/config',
]);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function dependencyNames(manifest) {
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });
}

describe('workspace foundation contracts', () => {
  it('contains exactly the six documented members with matching package names', async () => {
    const rootPackage = await json('package.json');
    assert.deepEqual(rootPackage.packageManager, 'pnpm@10.34.6');
    const workspacePaths = [
      ...(await readdir(path.join(root, 'apps'))).map((name) => `apps/${name}`),
      ...(await readdir(path.join(root, 'packages'))).map((name) => `packages/${name}`),
    ].sort();
    assert.deepEqual(Object.keys(members).sort(), [
      'apps/api',
      'apps/web',
      'packages/config',
      'packages/contracts',
      'packages/database',
      'packages/ui',
    ]);
    assert.deepEqual(workspacePaths, Object.keys(members).sort());
    for (const [directory, expectedName] of Object.entries(members)) {
      assert.equal((await json(`${directory}/package.json`)).name, expectedName);
    }
  });

  it('keeps every member on the shared strict TypeScript base', async () => {
    const base = await json('tsconfig.json');
    assert.equal(base.compilerOptions.strict, true);
    for (const directory of Object.keys(members)) {
      const config = await json(`${directory}/tsconfig.json`);
      assert.equal(config.extends, '../../tsconfig.json', `${directory} must inherit base config`);
      assert.notEqual(config.compilerOptions.strict, false, `${directory} must not disable strict`);
    }
  });

  it('keeps shared packages independent from apps and enforces subsystem boundaries', async () => {
    const manifests = Object.fromEntries(
      await Promise.all(
        Object.entries(members).map(async ([directory, name]) => [
          name,
          await json(`${directory}/package.json`),
        ]),
      ),
    );
    const dependencies = Object.fromEntries(
      Object.entries(manifests).map(([name, manifest]) => [name, dependencyNames(manifest)]),
    );
    for (const name of packageNames) {
      for (const dependency of dependencies[name]) {
        assert.ok(!appNames.has(dependency), `${name} must not depend on app ${dependency}`);
      }
    }

    assert.ok(!dependencies['@cupmemo/web'].includes('@cupmemo/database'));
    assert.ok(!dependencies['@cupmemo/api'].includes('@cupmemo/ui'));
    assert.ok(!dependencies['@cupmemo/contracts'].includes('@cupmemo/database'));
    assert.ok(!dependencies['@cupmemo/contracts'].includes('@cupmemo/config'));
    assert.ok(!dependencies['@cupmemo/database'].includes('@cupmemo/web'));
    assert.ok(!dependencies['@cupmemo/database'].includes('@cupmemo/api'));
    assert.ok(!dependencies['@cupmemo/ui'].includes('@cupmemo/api'));
    assert.ok(!dependencies['@cupmemo/config'].includes('@cupmemo/web'));
    assert.ok(!dependencies['@cupmemo/config'].includes('@cupmemo/api'));
    assert.ok(!dependencies['@cupmemo/config'].includes('@cupmemo/database'));
    assert.ok(!dependencies['@cupmemo/config'].includes('@cupmemo/contracts'));
    assert.ok(!dependencies['@cupmemo/config'].includes('@cupmemo/ui'));
    const config = manifests['@cupmemo/config'];
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      assert.deepEqual(config[field] ?? {}, {}, `config must not declare runtime ${field}`);
    }
  });

  it('allows @cupmemo/config only as a development dependency', async () => {
    for (const [directory, name] of Object.entries(members)) {
      const manifest = await json(`${directory}/package.json`);
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
        assert.ok(
          !Object.hasOwn(manifest[field] ?? {}, '@cupmemo/config'),
          `${name} must not declare @cupmemo/config in ${field}`,
        );
      }
    }
  });
});
