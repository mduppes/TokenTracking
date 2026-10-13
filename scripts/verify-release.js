// Exercise the packaged runtime and service after moving the app to a path with spaces.
// No provider requests or real user data: this uses a temporary home with headless disabled.
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/verify-release.js build/release-arm64/TokenTracking.app');
const temp = await mkdtemp(join(tmpdir(), 'TokenTracking release '));
let child;
let exited;
let output = '';
try {
  const app = join(temp, 'Moved App', 'TokenTracking.app');
  await cp(resolve(source), app, { recursive: true });
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  child = spawn(join(app, 'Contents/Helpers/node'), ['--disable-warning=ExperimentalWarning', 'server/src/index.js'], {
    cwd: join(app, 'Contents/Resources/service'),
    env: { PATH: '/usr/bin:/bin', HOME: temp, TOKENTRACKING_HOME: join(temp, 'data'), TOKENTRACKING_PORT: String(port), TOKENTRACKING_HEADLESS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = once(child, 'exit');
  child.on('error', (error) => { output += error.message; });
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  let url;
  for (let i = 0; i < 600; i++) { // Rosetta's first translation can take longer than a native launch.
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match && match[1] !== '0') { url = match[0]; break; }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(url, `Packaged service did not start (exit ${child.exitCode}, signal ${child.signalCode}): ${output}`);
  for (const path of ['/api/health', '/api/status', '/', '/app.js', '/favicon.png']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200, path);
    if (path === '/api/status') assert.ok(Array.isArray((await response.json()).providers));
    else await response.arrayBuffer();
  }
  console.log('Packaged runtime, SQLite, status and dashboard work from a moved app with no external Node or checkout.');
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  }
  await rm(temp, { recursive: true, force: true });
}
