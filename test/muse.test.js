import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMuseUsage, museIsWarmingUp } from '../server/src/headless/muse.js';

const loading = { shell: true, busy: true, dialog: false, text: 'Muse\nis warming up', raw: [] };
const settings = { ...loading, busy: false, dialog: true, text: 'General', raw: [] };
const ready = { ...settings, raw: [{ label: 'Free plan', percent: 0, resetText: 'Weekly limit resets on Oct 21' }] };
const epoch = new Date(2026, 9, 14, 6, 0).getTime();

async function readSequence(states) {
  let elapsed = 0, calls = 0, opens = 0;
  const page = { evaluate: async (js) => {
    if (js.startsWith('TokenTrackingDom.runOpenSteps')) { opens++; return true; }
    const state = states[Math.min(calls++, states.length - 1)];
    if (state instanceof Error) throw state;
    return state;
  } };
  const result = await readMuseUsage(page, { now: () => epoch + elapsed, sleep: async (ms) => { elapsed += ms; } });
  return { result, elapsed, opens };
}

test('Muse recognizes warming up and connecting labels without matching historical chat prose', () => {
  for (const text of ['is warming up', 'Muse is warming up', '☀ is warming up', 'Warming up…', 'Connecting…', 'Connecting...']) {
    assert.equal(museIsWarmingUp(text), true, text);
  }
  assert.equal(museIsWarmingUp('Assistant message: Muse is warming up'), false);
  assert.equal(museIsWarmingUp('Muse\nChat about warming up'), false);
});

test('Muse waits through minutes of warmup and missing Settings usage, then records zero', async () => {
  const { result, elapsed, opens } = await readSequence([
    ...Array(65).fill(loading),
    { ...loading, busy: false },
    ...Array(10).fill(settings), ready,
  ]);
  assert.equal(elapsed, 152_000);
  assert.equal(opens, 1);
  assert.equal(result.meters[0].usedPercent, 0);
  assert.equal(result.meters[0].id, 'weekly');
  assert.equal(result.plan, 'Free plan');
});

test('Muse keeps waiting for Settings usage even when no warming label is visible', async () => {
  const { result, elapsed } = await readSequence([...Array(50).fill(settings), ready]);
  assert.equal(elapsed, 100_000);
  assert.equal(result.meters[0].usedPercent, 0);
});

test('Muse warmup timeout rejects expired chat notice and emits no replacement reading', async () => {
  const { result, elapsed } = await readSequence([{ ...loading,
    text: "You've reached your usage limit. Your full weekly usage will reset at 1:36 AM on Wednesday, October 14.",
  }]);
  assert.equal(elapsed, 180_000);
  assert.match(result.error, /still warming up/);
  assert.equal(result.meters, undefined);
});

test('Muse waits the full allowance before accepting a still-current exhausted notice', async () => {
  const { result, elapsed } = await readSequence([{ ...loading,
    text: "You've reached your usage limit. Your full weekly usage will reset on October 20.",
  }]);
  assert.equal(elapsed, 180_000);
  assert.equal(result.source, 'headless:limit-notice');
  assert.equal(result.meters[0].usedPercent, 100);
});

test('Muse retries destroyed contexts and accepts a meter at the deadline', async () => {
  const { result, elapsed } = await readSequence([...Array(90).fill(new Error('Execution context destroyed')), ready]);
  assert.equal(elapsed, 180_000);
  assert.equal(result.meters[0].usedPercent, 0);
});

test('Muse missing usage or failed page times out without manufacturing a reading', async () => {
  for (const state of [settings, new Error('Execution context destroyed')]) {
    const { result, elapsed } = await readSequence([state]);
    assert.equal(elapsed, 180_000);
    assert.match(result.error, /did not finish loading/);
    assert.equal(result.meters, undefined);
  }
});
