import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github/workflows/ci.yml');

async function workflow() {
  return readFile(workflowPath, 'utf8');
}

describe('GitHub Actions CI contract', () => {
  it('runs on pull requests and pushes to main with pinned actions', async () => {
    const source = await workflow();
    assert.match(source, /^name: CupMemo CI$/m);
    assert.match(source, /^ {2}pull_request:$/m);
    assert.match(source, /^ {2}push:\n {4}branches:\n {6}- main$/m);
    assert.match(source, /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);
    assert.match(source, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/);
  });

  it('uses bounded read-only CI settings without production credentials or deployment', async () => {
    const source = await workflow();
    assert.match(source, /runs-on: ubuntu-24\.04/);
    assert.match(source, /timeout-minutes: 15/);
    assert.match(source, /permissions:\n {2}contents: read/);
    assert.match(source, /cancel-in-progress: true/);
    assert.doesNotMatch(
      source,
      /pull_request_target|secrets\.|\bdeploy\b|continue-on-error|self-hosted/,
    );
    assert.doesNotMatch(source, /\$\{\{\s*github\.event\./);
  });

  it('installs frozen dependencies and runs every nonmutating root quality gate', async () => {
    const source = await workflow();
    for (const command of [
      'corepack pnpm install --frozen-lockfile',
      'corepack pnpm format:check',
      'corepack pnpm lint',
      'corepack pnpm typecheck',
      'corepack pnpm test',
      'corepack pnpm build',
    ]) {
      assert.ok(source.includes(`run: ${command}`), `missing required CI command: ${command}`);
    }
    assert.match(source, /npm install --global corepack@0\.36\.0/);
    assert.match(source, /node-version: 24\.15\.0/);
    assert.match(source, /test "\$\(corepack pnpm --version\)" = "10\.34\.6"/);
  });
});
