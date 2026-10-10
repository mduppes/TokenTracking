import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePace } from '../server/src/pacing.js';

const H = 36e5;
const NOW = new Date('2026-10-10T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('weekly halfway, on pace', () => {
  const resetsAt = iso(NOW.getTime() + 84 * H); // half the week left
  const p = computePace({ usedPercent: 45, resetsAt, window: 'weekly', capturedAt: NOW.toISOString() }, [], NOW);
  assert.equal(p.expectedPercent, 50);
  assert.equal(p.status, 'ok');
  assert.equal(p.budgetPerDay, Math.round((55 / 3.5) * 10) / 10);
});

test('over pace: observed slope runs out before reset', () => {
  const resetsAt = iso(NOW.getTime() + 3 * H);
  const history = [
    { usedPercent: 40, capturedAt: iso(NOW.getTime() - 1 * H), resetsAt },
    { usedPercent: 60, capturedAt: NOW.toISOString(), resetsAt },
  ];
  const p = computePace({ usedPercent: 60, resetsAt, window: 'session', capturedAt: NOW.toISOString() }, history, NOW);
  assert.equal(p.ratePerHour, 20);
  assert.equal(p.status, 'over-pace');
  assert.equal(p.exhaustAt, iso(NOW.getTime() + 2 * H));
  assert.equal(p.projectedAtReset, 120);
});

test('ignores history from a previous window', () => {
  const resetsAt = iso(NOW.getTime() + 4 * H);
  const history = [
    { usedPercent: 95, capturedAt: iso(NOW.getTime() - 2 * H), resetsAt: iso(NOW.getTime() - 1 * H) },
    { usedPercent: 5, capturedAt: NOW.toISOString(), resetsAt },
  ];
  const p = computePace({ usedPercent: 5, resetsAt, window: 'session', capturedAt: NOW.toISOString() }, history, NOW);
  assert.equal(p.ratePerHour, 5); // average since window start (1h elapsed), not the negative slope
  assert.equal(p.status, 'ok');
});

test('no over-pace from a short burst right after a reset', () => {
  const resetsAt = iso(NOW.getTime() + 4.8 * H); // 12 min into a 5h window
  const history = [
    { usedPercent: 0, capturedAt: iso(NOW.getTime() - 0.2 * H), resetsAt },
    { usedPercent: 3, capturedAt: NOW.toISOString(), resetsAt },
  ];
  const p = computePace({ usedPercent: 3, resetsAt, window: 'session', capturedAt: NOW.toISOString() }, history, NOW);
  assert.notEqual(p.status, 'over-pace');
});

test('limited and unknown', () => {
  assert.equal(computePace({ usedPercent: 100, resetsAt: null, window: 'weekly' }, [], NOW).status, 'limited');
  assert.equal(computePace({ usedPercent: null, resetsAt: null, window: 'other' }, [], NOW).status, 'unknown');
});
