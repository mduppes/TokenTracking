import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { createApp } from '../server/src/server.js';

let server, db, home, port, refreshCalls = 0;
let refreshOutcome = { at: 'now', results: {} };

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'tt-test-'));
  const config = loadConfig({ TOKENTRACKING_HOME: home, TOKENTRACKING_HEADLESS: '0' });
  db = openDb(config.dbPath);
  // Find a free port, then start for real with that port in the Host allow-list.
  const probe = createApp({ db, config });
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  port = probe.address().port;
  await new Promise((r) => probe.close(r));
  config.port = port;
  server = createApp({ db, config, refresh: async () => { refreshCalls++; if (refreshOutcome === 'throw') throw new Error('Chrome launch failed'); return refreshOutcome; } });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  const resetsAt = new Date(Date.now() + 2 * 36e5).toISOString();
  db.addSnapshot('claude', { capturedAt: new Date().toISOString(), source: 'test', plan: null },
    { id: 'five-hour', label: 'Current session (5h)', window: 'session', usedPercent: 30, used: null, limit: null, unit: null, resetsAt, resetText: null });
});
after(() => { server.close(); db.close(); rmSync(home, { recursive: true, force: true }); });

function call(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data && res.headers['content-type']?.includes('json') ? JSON.parse(data) : data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body)); else req.end();
  });
}

test('status includes stored meters with pacing', async () => {
  const s = await call('GET', '/api/status');
  assert.equal(s.status, 200);
  assert.equal(s.body.providers[0].id, 'claude');
  assert.equal(s.body.providers[0].meters[0].usedPercent, 30);
  assert.ok(s.body.providers[0].meters[0].pace.expectedPercent > 0);
});

test('refresh: allowed from the dashboard origin, needs JSON', async () => {
  const ok = await call('POST', '/api/refresh', { body: {}, headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` } });
  assert.equal(ok.status, 200);
  assert.equal(refreshCalls, 1);
  assert.equal((await call('POST', '/api/refresh', { body: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('rejects other origins (incl. extensions) and foreign hosts', async () => {
  const json = { 'content-type': 'application/json' };
  assert.equal((await call('POST', '/api/refresh', { body: {}, headers: { ...json, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('GET', '/api/status', { headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } })).status, 403);
  assert.equal((await call('GET', '/api/status', { headers: { host: 'evil.example:7878' } })).status, 403);
  assert.equal((await call('POST', '/api/ingest', { body: {}, headers: json })).status, 404, 'extension ingest endpoint is gone');
  assert.equal(refreshCalls, 1);
});

test('login endpoint: validates provider and origin', async () => {
  const json = { 'content-type': 'application/json' };
  assert.equal((await call('POST', '/api/login', { body: { provider: 'nope' }, headers: json })).status, 400);
  assert.equal((await call('POST', '/api/login', { body: { provider: '../x' }, headers: json })).status, 400);
  assert.equal((await call('POST', '/api/login', { body: { provider: 'muse' }, headers: { ...json, origin: 'https://evil.example' } })).status, 403);
});

test('serves dashboard, blocks traversal', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.body, /TokenTracking/);
  assert.equal((await call('GET', '/../package.json')).status, 404);
});

test('refresh failures return HTTP 500 rather than a successful response', async () => {
  const headers = { 'content-type': 'application/json' };
  try {
    refreshOutcome = null;
    assert.equal((await call('POST', '/api/refresh', { body: {}, headers })).status, 500);
    refreshOutcome = 'throw';
    assert.equal((await call('POST', '/api/refresh', { body: {}, headers })).status, 500);
  } finally { refreshOutcome = { at: 'now', results: {} }; }
});
