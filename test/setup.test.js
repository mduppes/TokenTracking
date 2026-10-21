import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { loadConfig } from '../server/src/config.js';
import { SETUP_PROVIDER_IDS, updateSetup, providerEnabled } from '../server/src/setup.js';
import { runHeadlessRefresh } from '../server/src/headless/refresh.js';
import { openLoginWindow } from '../server/src/headless/login.js';
import { openDb } from '../server/src/db.js';
import { createApp } from '../server/src/server.js';

function temporary() {
  const home = mkdtempSync(join(tmpdir(), 'tt-setup-'));
  const env = { TOKENTRACKING_HOME: home, TOKENTRACKING_HEADLESS: '0', TOKENTRACKING_CHROME: join(home, 'missing-chrome') };
  return { home, env, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('fresh setup collects nothing, saves private preferences and resumes before completion', async () => {
  const t = temporary();
  try {
    const config = loadConfig(t.env);
    assert.deepEqual(config.setup, { version: 1, selectedProviders: [], completed: false });
    assert.equal(statSync(config.setupPath).mode & 0o777, 0o600);
    // No selected service means no browser or Antigravity process probing, even if refresh is requested.
    const result = await runHeadlessRefresh({ config, db: { addSnapshot() { assert.fail('unexpected reading'); } } });
    assert.deepEqual(result.results, {});
    updateSetup(config, { selectedProviders: ['cursor', 'claude', 'cursor'], completed: false });
    assert.deepEqual(loadConfig(t.env).setup.selectedProviders, ['claude', 'cursor']);
    assert.equal(loadConfig(t.env).setup.completed, false);
    assert.equal(providerEnabled(config, 'gemini'), false);
    config.headless.disabled = ['claude'];
    assert.equal(providerEnabled(config, 'claude'), false);
    assert.equal(providerEnabled(config, 'cursor'), true);
    const before = readFileSync(config.setupPath, 'utf8');
    for (const value of [null, {}, { selectedProviders: ['unknown'], completed: true }, { selectedProviders: [], completed: true }, { selectedProviders: ['claude'], completed: 'yes' }]) {
      assert.throws(() => updateSetup(config, value), /Choose at least one supported service/);
      assert.equal(readFileSync(config.setupPath, 'utf8'), before);
    }
    updateSetup(config, { selectedProviders: ['claude'], completed: true });
    assert.equal(loadConfig(t.env).setup.completed, true);
  } finally { t.cleanup(); }
});

test('existing database or browser profile keeps collection enabled; damaged setup never widens access', () => {
  for (const legacy of ['database', 'profile']) {
    const t = temporary();
    try {
      if (legacy === 'database') writeFileSync(join(t.home, 'tokentracking.db'), '');
      else mkdirSync(join(t.home, 'browser-profile'));
      const config = loadConfig(t.env);
      assert.deepEqual(config.setup.selectedProviders, SETUP_PROVIDER_IDS);
      assert.equal(config.setup.completed, true);
      writeFileSync(config.setupPath, 'broken JSON');
      assert.deepEqual(loadConfig(t.env).setup, { version: 1, selectedProviders: [], completed: false });
    } finally { t.cleanup(); }
  }
});

test('setup endpoints persist selection, filter status, reject cross-site writes and handle missing Chrome', async () => {
  const t = temporary();
  const config = loadConfig(t.env);
  const db = openDb(config.dbPath);
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  config.port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const app = createApp({ db, config });
  app.listen(config.port, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${config.port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const setup = await (await fetch(base + '/api/setup')).json();
    assert.equal(setup.needsSetup, true);
    assert.equal(setup.chromeAvailable, false);
    assert.equal(setup.browserOpen, false);
    assert.deepEqual((await (await fetch(base + '/api/status')).json()).providers, []);
    assert.equal((await post('/api/setup', { selectedProviders: ['claude'], completed: true }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(base + '/api/setup', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await post('/api/setup', { selectedProviders: [], completed: true })).status, 400);
    assert.equal((await post('/api/login', { provider: 'claude' })).status, 409);
    const saved = await (await post('/api/setup', { selectedProviders: ['claude'], completed: false })).json();
    assert.deepEqual(saved.selectedProviders, ['claude']);
    assert.equal(saved.needsSetup, true);
    const meter = { id: 'weekly', label: 'Weekly limit', window: 'weekly', usedPercent: 20, used: null, limit: null, unit: null, resetText: null, resetsAt: new Date(Date.now() + 864e5).toISOString() };
    for (const provider of ['claude', 'cursor']) db.addSnapshot(provider, { capturedAt: new Date().toISOString(), source: 'test', plan: null }, meter);
    const status = await (await fetch(base + '/api/status')).json();
    assert.deepEqual(status.providers.map((p) => p.id), ['claude']);
    assert.equal(status.setup.chromeAvailable, false);
    const login = await post('/api/login', { provider: 'claude' });
    assert.equal(login.status, 409);
    assert.match((await login.json()).reason, /Chrome was not found/);
    assert.equal((await fetch(base + '/api/health')).status, 200, 'failed browser launch must not kill the service');
    mkdirSync(config.headless.profileDir);
    symlinkSync(`test-${process.pid}`, join(config.headless.profileDir, 'SingletonLock'));
    assert.equal((await (await fetch(base + '/api/setup')).json()).browserOpen, true);
    await post('/api/setup', { selectedProviders: ['claude'], completed: true });
    assert.equal((await (await fetch(base + '/api/setup')).json()).needsSetup, false);
    assert.deepEqual(loadConfig(t.env).setup.selectedProviders, ['claude']);
  } finally {
    await new Promise((r) => app.close(r));
    db.close();
    t.cleanup();
  }
});

test('a non-executable Chrome path returns a login error instead of an uncaught process error', async () => {
  const t = temporary();
  try {
    const config = loadConfig(t.env);
    writeFileSync(config.headless.chromePath, 'not executable', { mode: 0o600 });
    const result = await openLoginWindow(config, ['claude']);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Chrome could not start/);
  } finally { t.cleanup(); }
});
