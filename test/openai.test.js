import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../server/src/headless/refresh.js';

const task = TASKS.find((t) => t.id === 'openai');

test('ChatGPT guest homepage offers Log in rather than Sign in', () => {
  assert.equal(task.loggedOut('https://chatgpt.com/?tab=overview', 'Get responses tailored to you\nLog in to get answers based on saved chats.\nLog in\nSign up for free'), true);
  assert.equal(task.loggedOut('https://auth.openai.com/log-in', ''), true);
  assert.equal(task.loggedOut('https://chatgpt.com/auth/login', ''), true);
  assert.equal(task.loggedOut(task.url, 'Usage\nWeekly limit\n15% used'), false);
});
