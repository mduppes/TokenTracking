import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { createApp } from '../server/src/server.js';

let server, db, home, port;
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'tt-test-'));
  const config = { ...loadConfig({ TOKENTRACKING_HOME: home }), port: 0 };
  db = openDb(config.dbPath);
  server = createApp({ db, config });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  config.port = port; // host check uses the real port
  server.close(); // re-create with the correct port in the allow-list
  server = createApp({ db, config });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
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

const snapshot = {
  provider: 'claude', source: 'json:test', capturedAt: new Date().toISOString(),
  meters: [{ id: 'five-hour', label: 'Current session (5h)', window: 'session', usedPercent: 30, resetsAt: new Date(Date.now() + 2 * 36e5).toISOString() }],
};

test('ingest from extension origin, then read status', async () => {
  const r = await call('POST', '/api/ingest', { body: { snapshots: [snapshot] }, headers: { 'content-type': 'application/json', origin: EXT } });
  assert.equal(r.status, 200);
  assert.equal(r.body.inserted, 1);
  assert.equal(r.headers['access-control-allow-origin'], EXT);
  const dup = await call('POST', '/api/ingest', { body: snapshot, headers: { 'content-type': 'application/json', origin: EXT } });
  assert.equal(dup.body.inserted, 0, 'identical repeat is deduped');
  const s = await call('GET', '/api/status');
  assert.equal(s.body.providers[0].id, 'claude');
  assert.equal(s.body.providers[0].meters[0].usedPercent, 30);
  assert.ok(s.body.providers[0].meters[0].pace.expectedPercent > 0);
});

test('rejects web origins, foreign hosts, wrong content-type, junk', async () => {
  assert.equal((await call('POST', '/api/ingest', { body: snapshot, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('GET', '/api/status', { headers: { host: 'evil.example:7878' } })).status, 403);
  assert.equal((await call('POST', '/api/ingest', { body: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  const junk = await call('POST', '/api/ingest', { body: { provider: '../etc', meters: [] }, headers: { 'content-type': 'application/json' } });
  assert.equal(junk.body.rejected, 1);
});

test('serves dashboard, blocks traversal', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.body, /TokenTracking/);
  assert.equal((await call('GET', '/../package.json')).status, 404);
});
