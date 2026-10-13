import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../server/src/headless/refresh.js';
import { readOpenAIUsage } from '../server/src/headless/openai.js';

const task = TASKS.find((t) => t.id === 'openai');

test('ChatGPT guest homepage offers Log in rather than Sign in', () => {
  assert.equal(task.loggedOut('https://chatgpt.com/?tab=overview', 'Get responses tailored to you\nLog in to get answers based on saved chats.\nLog in\nSign up for free'), true);
  assert.equal(task.loggedOut('https://auth.openai.com/log-in', ''), true);
  assert.equal(task.loggedOut('https://chatgpt.com/auth/login', ''), true);
  assert.equal(task.loggedOut(task.url, 'Usage\nWeekly limit\n15% used'), false);
  assert.equal(task.loggedOut(task.url, 'How to log in to another app'), false);
  assert.equal(task.loggedOut('https://example.com/error', ''), false);
});

const guest = { href: 'https://chatgpt.com/', text: 'Log in\nSign up', raw: [] };
const loading = { href: task.url, text: 'Loading…', raw: [] };
const ready = { href: task.url, text: 'Usage\nWeekly limit\n15% used', raw: [{ label: 'Weekly limit', percent: 15, resetText: 'Resets in 2 days' }] };

async function readSequence(states) {
  let time = 0, calls = 0;
  const page = { evaluate: async () => {
    const state = states[Math.min(calls++, states.length - 1)];
    if (state instanceof Error) throw state;
    return state;
  } };
  const result = await readOpenAIUsage(page, { timeoutMs: 60_000, now: () => time, sleep: async (ms) => { time += ms; } });
  return { result, time, calls };
}

test('OpenAI waits past a transient guest shell and stops as soon as usage loads', async () => {
  const { result, time } = await readSequence([...Array(35).fill(guest), loading, ready]);
  assert.equal(result.source, 'headless:dom');
  assert.equal(result.meters[0].usedPercent, 15);
  assert.equal(time, 36_000);
});

test('OpenAI confirms persistent logout only after the full loading allowance', async () => {
  const { result, time } = await readSequence([guest]);
  assert.equal(result.login, true);
  assert.equal(time, 60_000);
});

test('OpenAI slow, failed and unrelated pages report errors rather than asking for login', async () => {
  for (const state of [loading, new Error('Execution context destroyed'), { href: 'https://example.com/error', text: '', raw: [] }]) {
    const { result } = await readSequence([state]);
    assert.ok(result.error);
    assert.equal(result.login, undefined);
  }
});

test('OpenAI retries through authentication navigation and reads meters at the deadline', async () => {
  const { result, time } = await readSequence([...Array(60).fill(new Error('Execution context destroyed')), ready]);
  assert.equal(result.meters[0].usedPercent, 15);
  assert.equal(time, 60_000);
});

test('OpenAI does not record percentage text from a guest page as subscription usage', async () => {
  const { result } = await readSequence([{ ...guest, raw: ready.raw }]);
  assert.equal(result.login, true);
});
