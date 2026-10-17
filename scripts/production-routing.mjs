// Isolated HTTP transport control, NOT Fastify/Better Auth/DB acceptance.
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { closeSync, openSync } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = resolve(root, 'apps/web');
const cookies = [
  'transport_one=synthetic; Path=/; HttpOnly; SameSite=Lax',
  'transport_two=synthetic; Path=/; HttpOnly; SameSite=Lax',
];
const deadline = (ms = 5000) => globalThis.AbortSignal.timeout(ms);
const checks = [];
let child;
let browser;
let fixture;
let log;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  killOwned(child, 'SIGTERM');
};

function killOwned(child, signal) {
  if (!child?.pid) return;
  try {
    // Each child owns a new process group; never signal an unrelated process.
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function launch(command, args, env) {
  const process = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', log, log],
  });
  // Attach immediately: spawn errors must not become unhandled events.
  process.finished = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return process;
}

async function stop(process) {
  if (!process) return;
  killOwned(process, 'SIGTERM');
  const timer = setTimeout(() => killOwned(process, 'SIGKILL'), 3000);
  try {
    await process.finished;
  } finally {
    clearTimeout(timer);
    killOwned(process, 'SIGKILL');
  }
}

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function main() {
  const reuseBuild = process.argv.length === 3 && process.argv[2] === '--built';
  assert.ok(process.argv.length === 2 || reuseBuild, 'Only --built is accepted');
  // Next auto-loads dotenv files. Refuse them without reading private contents.
  for (const dir of [root, web]) {
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      let exists = false;
      try {
        await access(resolve(dir, name));
        exists = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      assert.equal(exists, false, 'Refusing implicit dotenv configuration');
    }
  }
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  const evidence = await mkdtemp(resolve(root, 'test-results/production-routing-'));
  log = openSync(resolve(evidence, 'process.log'), 'wx', 0o600);
  console.log(`Transport-control evidence: ${evidence}`);
  const env = {
    PATH: process.env.PATH,
    HOME: evidence,
    TMPDIR: evidence,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--max-old-space-size=1536',
  };
  const requests = [];
  fixture = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const received = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(chunks).toString(),
    };
    requests.push(received);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('vary', 'Cookie');
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/v1/auth/sign-in/email') {
      response.writeHead(401);
      response.end(
        JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Transport only' }),
      );
    } else {
      response.setHeader('set-cookie', cookies);
      response.writeHead(201);
      response.end(JSON.stringify(received));
    }
  });
  let compiledOrigin;
  if (reuseBuild) {
    const manifest = JSON.parse(await readFile(resolve(web, '.next/routes-manifest.json'), 'utf8'));
    const rewrite = Object.values(manifest.rewrites).flat()[0];
    compiledOrigin = new URL(rewrite.destination).origin;
    const url = new URL(compiledOrigin);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.ok(url.port);
  }
  const upstream = await listen(fixture, compiledOrigin ? Number(new URL(compiledOrigin).port) : 0);
  env.CUPMEMO_API_ORIGIN = upstream;
  if (!reuseBuild) {
    child = launch('corepack', ['pnpm', '--filter', '@cupmemo/web', 'build'], env);
    const buildTimer = setTimeout(() => killOwned(child, 'SIGKILL'), 300000);
    let built;
    try {
      built = await child.finished;
    } finally {
      clearTimeout(buildTimer);
    }
    assert.deepEqual(built, { code: 0, signal: null }, 'Actual production build must succeed');
  }
  assert.equal(interrupted, false);
  checks.push(
    reuseBuild
      ? 'REUSED existing production build; caller must verify source identity'
      : 'actual Next production build',
  );
  const manifest = JSON.parse(await readFile(resolve(web, '.next/routes-manifest.json'), 'utf8'));
  const rewrites = Object.values(manifest.rewrites).flat();
  assert.deepEqual(
    rewrites.map(({ source, destination }) => ({ source, destination })),
    [{ source: '/api/v1/:path*', destination: `${upstream}/api/v1/:path*` }],
  );
  checks.push('compiled rewrite has exactly the internal versioned API target');
  // Assemble exactly the standalone web/static/public layout used by web.Dockerfile.
  const standalone = resolve(web, '.next/standalone/apps/web');
  await cp(resolve(web, '.next/static'), resolve(standalone, '.next/static'), { recursive: true });
  await cp(resolve(web, 'public'), resolve(standalone, 'public'), { recursive: true });
  const reservation = createServer();
  const origin = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  child = launch(process.execPath, [resolve(standalone, 'server.js')], {
    ...env,
    HOSTNAME: '127.0.0.1',
    PORT: new URL(origin).port,
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.equal(interrupted, false);
    assert.equal(child.exitCode, null, 'Owned Next server exited before readiness');
    try {
      ready =
        (await globalThis.fetch(`${origin}/sign-in`, { signal: deadline(1000) })).status === 200;
    } catch {
      // Only poll this owned process, never reuse or stop an existing server.
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Owned production server readiness');
  const path = '/api/v1/transport/a%20b?tag=one&tag=two&next=%2Fapp%3Fx%3D1';
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const body = ['GET', 'HEAD'].includes(method) ? undefined : '{"transport":"synthetic"}';
    const response = await globalThis.fetch(`${origin}${path}`, {
      method,
      headers: {
        cookie: 'transport_in=synthetic; second=literal',
        origin,
        'x-transport-control': 'literal-header',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body }),
      signal: deadline(),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.headers.getSetCookie(), cookies);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(
      response.headers
        .get('vary')
        .split(',')
        .some((token) => token.trim().toLowerCase() === 'cookie'),
    );
    const received = requests.at(-1);
    assert.equal(received.url, path);
    assert.equal(received.method, method);
    assert.equal(received.body, body ?? '');
    assert.equal(received.headers.cookie, 'transport_in=synthetic; second=literal');
    assert.equal(received.headers.origin, origin);
    assert.equal(received.headers['x-transport-control'], 'literal-header');
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.deepEqual(await response.json(), received);
  }
  checks.push(
    'six HTTP methods, exact encoded path/query/body/header/cookie and separate Set-Cookie transport',
  );
  const before = requests.length;
  assert.equal(
    (await globalThis.fetch(`${origin}/api/v2/not-routed`, { signal: deadline() })).status,
    404,
  );
  assert.equal(requests.length, before);
  checks.push('non-v1 requests do not reach upstream');
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserRequests = [];
  const errors = [];
  page.on('request', (request) => browserRequests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/sign-in`);
  await page.getByLabel('Email').fill('transport@example.test');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-transport-only');
  const authRequest = page.waitForResponse(`${origin}/api/v1/auth/sign-in/email`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  assert.equal((await authRequest).status(), 401);
  assert.equal(requests.at(-1).url, '/api/v1/auth/sign-in/email');
  assert.equal(requests.at(-1).headers.origin, origin);
  assert.deepEqual(JSON.parse(requests.at(-1).body), {
    email: 'transport@example.test',
    password: 'synthetic-transport-only',
  });
  await page.locator('form').getByRole('alert').waitFor();
  assert.equal(
    await page.locator('form').getByRole('alert').textContent(),
    'Email or password is incorrect. Try again.',
  );
  const browserTransport = await page.evaluate(async () => {
    const response = await globalThis.fetch('/api/v1/browser-control');
    return { status: response.status, url: response.url };
  });
  assert.deepEqual(browserTransport, { status: 201, url: `${origin}/api/v1/browser-control` });
  assert.equal(requests.at(-1).url, '/api/v1/browser-control');
  assert.equal(requests.at(-1).headers['sec-fetch-site'], 'same-origin');
  const stored = await context.cookies();
  for (const cookie of stored) {
    assert.ok(['transport_one', 'transport_two'].includes(cookie.name));
    assert.equal(cookie.domain, '127.0.0.1');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Lax');
  }
  assert.equal(stored.length, 2);
  assert.ok(browserRequests.every((url) => new URL(url).origin === origin));
  assert.deepEqual(errors, []);
  checks.push(
    'real compiled auth client and browser relative fetch use only web origin; synthetic cookies accepted',
  );
  await browser.close();
  browser = undefined;
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  const unavailable = await globalThis.fetch(`${origin}/api/v1/transport/down`, {
    signal: deadline(),
  });
  assert.equal(unavailable.status, 500);
  assert.equal(await unavailable.text(), 'Internal Server Error');
  checks.push('upstream-down generic 500 without upstream URL, stack or connection details');
  await writeFile(
    resolve(evidence, 'result.json'),
    JSON.stringify(
      {
        control:
          'HTTP transport only; NOT real Fastify, Better Auth, DB or public HTTPS acceptance',
        checks,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      { checks, result: 'PASS', limits: 'Transport control only; Issue41 remains open' },
      null,
      2,
    ),
  );
}

process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  await browser?.close();
  fixture?.closeAllConnections();
  if (fixture?.listening) await new Promise((resolve) => fixture.close(resolve));
  await stop(child);
  if (log !== undefined) closeSync(log);
}
