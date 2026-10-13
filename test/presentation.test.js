import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPresentation, planLabel } from '../server/src/status.js';

const NOW = new Date('2026-10-11T12:00:00Z');
const meter = (id, extra = {}) => ({ id, label: id, usedPercent: 50, resetsAt: null, stale: false, capturedAt: '2026-10-11T11:55:00Z', pace: { status: 'ok' }, ...extra });
const status = {
  providers: [
    { id: 'claude', name: 'Claude', plan: 'claude_max', meters: [meter('weekly', { resetsAt: '2026-10-13T00:00:00Z' }), meter('five-hour', { resetsAt: '2026-10-11T14:00:00Z', pace: { status: 'over-pace' } })] },
    { id: 'muse', name: 'Muse (Meta)', plan: null, meters: [meter('weekly', { stale: true, capturedAt: '2026-10-11T09:00:00Z', resetsAt: '2026-10-14T01:36:00Z' })] },
    { id: 'antigravity', name: 'Antigravity', plan: 'Pro', meters: [meter('pool-gemini')] },
  ],
};

test('notices: stale with reason, login, errors; skipped is silent', () => {
  const r = withPresentation(status, { results: {
    muse: { status: 'login' },
    gemini: { status: 'login' },
    cursor: { status: 'error', message: 'evaluate timeout' },
    antigravity: { status: 'skipped', message: "Antigravity isn't running" },
    claude: { status: 'ok' },
  } }, new Set(['muse', 'gemini', 'cursor', 'claude']), NOW);
  assert.deepEqual(r.notices.map((n) => [n.provider, n.kind, n.canLogIn]), [['muse', 'stale', true], ['gemini', 'login', true], ['cursor', 'error', true]]);
  assert.ok(r.notices.every((n) => n.actionLabel === 'Open browser'));
  assert.equal(r.notices[0].text, 'Muse (Meta) is stale: last read 3h ago · last refresh: needs a login');
  assert.equal(r.notices[2].text, 'Cursor: evaluate timeout');
});

test('browser errors remain actionable before any meter is stored; local errors have no browser action', () => {
  const r = withPresentation({ providers: [] }, { results: {
    openai: { status: 'error', message: 'no usage found' },
    antigravity: { status: 'error', message: 'local server unavailable' },
  } }, new Set(['openai']), NOW);
  assert.deepEqual(r.notices.map((n) => [n.provider, n.canLogIn, n.actionLabel]), [
    ['openai', true, 'Open browser'], ['antigravity', false, null],
  ]);
});

test('registered browser providers have a card before their first reading', () => {
  const input = { providers: [] };
  const r = withPresentation(input, { results: { openai: { status: 'login' } } }, new Set(['openai']), NOW);
  assert.equal(r.providers[0].name, 'OpenAI');
  assert.deepEqual(r.providers[0].meters, []);
  assert.equal(r.providers[0].lastCapturedAt, null);
  assert.equal(r.providers[0].canOpenBrowser, true);
  assert.match(r.providers[0].emptyText, /sign in/i);
  assert.equal(input.providers.length, 0, 'presentation does not mutate the stored status');
});

test('a browser lock explains skipped refreshes instead of silently appearing successful', () => {
  const r = withPresentation({ providers: [] }, { results: {
    openai: { status: 'skipped', message: 'browser-login window is still open' },
  } }, new Set(['openai']), NOW);
  assert.match(r.refreshMessage, /Quit.*Cmd\+Q/);
  assert.equal(r.providers[0].emptyText, r.refreshMessage);
  assert.deepEqual(r.notices, []);
  const localOnly = withPresentation({ providers: [] }, { results: {
    antigravity: { status: 'skipped', message: 'not running' },
  } }, new Set(), NOW);
  assert.equal(localOnly.refreshMessage, null);
});

test('resetsNext sorted soonest first, only meters with a reset time', () => {
  const r = withPresentation(status, null, new Set(), NOW);
  assert.deepEqual(r.resetsNext.map((x) => `${x.provider}/${x.meterId}`), ['claude/five-hour', 'claude/weekly', 'muse/weekly']);
  assert.equal(r.resetsNext[0].status, 'over-pace');
  assert.equal(r.resetsNext[2].stale, true);
});

test('planLabel', () => {
  assert.equal(planLabel('claude_max'), 'Max');
  assert.equal(planLabel('pro'), 'Pro');
  assert.equal(planLabel(null), null);
  assert.equal(withPresentation(status, null).providers[0].planLabel, 'Max');
});
