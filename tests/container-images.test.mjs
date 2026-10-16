import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

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
  for (const service of ['web', 'api']) {
    it(`${service} has an immutable, nonroot compiled runtime contract`, () => {
      const filename = `infrastructure/docker/${service}.Dockerfile`;
      expect(existsSync(path.join(root, filename)), `missing ${filename}`).toBe(true);
      const dockerfile = read(filename);
      const from = [...dockerfile.matchAll(/^FROM (\S+) AS (\S+)$/gm)];
      expect(from.map((entry) => entry[1])).toEqual([base, base]);
      expect(dockerfile).toContain('pnpm@10.34.6');
      expect(dockerfile).toContain('install --frozen-lockfile');
      expect(dockerfile).toContain(`--filter @cupmemo/${service} deploy --legacy --prod /out`);
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
        expect(command).toEqual([
          'node',
          'node_modules/next/dist/bin/next',
          'start',
          '--hostname',
          '0.0.0.0',
          '--port',
          '3101',
        ]);
        expect(dockerfile).toContain('packages/ui/dist');
        expect(dockerfile).toContain('cp -a apps/web/.next /out/.next');
      } else {
        expect(command).toEqual(['node', 'dist/server.js']);
        expect(dockerfile).toContain('CUPMEMO_API_HOST=0.0.0.0');
        expect(dockerfile).toContain('CUPMEMO_API_PORT=4101');
        expect(dockerfile).toContain('packages/database/dist');
        expect(dockerfile).toContain('packages/database/drizzle');
      }
      expect(dockerfile).toContain('packages/contracts/dist');
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
