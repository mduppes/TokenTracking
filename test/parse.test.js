import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResetText, classifyWindow, extractMeters, makeMeter } from '../lib/parse.js';
import { parseClaudeUsage, parseCursorUsage, parseCursorGrokBot, parseAntigravityStatus, parseMuseLimitNotice } from '../lib/providers.js';

// Fixed "now": Saturday 2026-10-10 12:00 local time
const NOW = new Date(2026, 9, 10, 12, 0, 0);

test('relative reset text', () => {
  assert.equal(parseResetText('Resets in 2 hr 14 min', NOW).getTime(), NOW.getTime() + (2 * 60 + 14) * 6e4);
  assert.equal(parseResetText('resets in 3 days', NOW).getTime(), NOW.getTime() + 3 * 864e5);
  assert.equal(parseResetText('Resets in 45m', NOW).getTime(), NOW.getTime() + 45 * 6e4);
});

test('weekday + time reset text', () => {
  const d = parseResetText('Resets Thu 10:00 AM', NOW);
  assert.equal(d.getDay(), 4);
  assert.equal(d.getHours(), 10);
  assert.ok(d > NOW && d - NOW < 7 * 864e5);
  // Same weekday as today but earlier time → next week
  const s = parseResetText('Resets Saturday 9am', NOW);
  assert.equal(s.getDate(), 17);
});

test('month/day and time-only reset text', () => {
  const d = parseResetText('Resets Oct 14', NOW);
  assert.deepEqual([d.getMonth(), d.getDate()], [9, 14]);
  const past = parseResetText('Renews Jan 3', NOW);
  assert.equal(past.getFullYear(), 2027);
  const t = parseResetText('Resets at 5:30 PM', NOW);
  assert.deepEqual([t.getDate(), t.getHours(), t.getMinutes()], [10, 17, 30]);
  const early = parseResetText('Resets at 9:00 AM', NOW);
  assert.equal(early.getDate(), 11);
  assert.equal(parseResetText('Resets tomorrow at 9am', NOW).getDate(), 11);
  assert.equal(parseResetText('nothing here', NOW), null);
  assert.equal(parseResetText('Resets monthly on Nov 1', NOW).getMonth(), 10);
});

test('ISO reset text', () => {
  assert.equal(parseResetText('2026-10-12T09:00:00Z', NOW).toISOString(), '2026-10-12T09:00:00.000Z');
});

test('classifyWindow', () => {
  assert.equal(classifyWindow('seven_day_opus'), 'weekly');
  assert.equal(classifyWindow('five_hour'), 'session');
  assert.equal(classifyWindow('Current session'), 'session');
  assert.equal(classifyWindow('Billing cycle usage'), 'monthly');
  assert.equal(classifyWindow('Daily limit'), 'daily');
  assert.equal(classifyWindow('Credits'), 'other');
});

test('Claude usage JSON', () => {
  const meters = parseClaudeUsage('', {
    five_hour: { utilization: 42, resets_at: '2026-10-10T15:00:00Z' },
    seven_day: { utilization: 71.5, resets_at: '2026-10-14T09:00:00Z' },
    seven_day_opus: null,
    extra_usage: { is_enabled: false },
  });
  assert.equal(meters.length, 2);
  assert.deepEqual(meters.map((m) => [m.id, m.window, m.usedPercent]), [['five-hour', 'session', 42], ['seven-day', 'weekly', 71.5]]);
  assert.equal(meters[0].label, 'Current session (5h)');
  assert.equal(meters[1].resetsAt, '2026-10-14T09:00:00.000Z');
});

test('Cursor usage-summary (redacted real shape, 2026-10-10)', () => {
  const meters = parseCursorUsage('', {
    billingCycleStart: '2026-09-30T15:22:07.000Z', billingCycleEnd: '2026-10-30T15:22:07.000Z',
    membershipType: 'pro', limitType: 'user', isUnlimited: false,
    individualUsage: {
      plan: { enabled: true, used: 2000, limit: 2000, remaining: 0, breakdown: { included: 2000, bonus: 29424, total: 31424 },
        autoPercentUsed: 69.83111111111111, apiPercentUsed: 0, totalPercentUsed: 68.12791327913278 },
      onDemand: { enabled: false, used: 0, limit: null, remaining: null },
    },
    teamUsage: {},
  });
  assert.deepEqual(meters.map((m) => [m.id, m.usedPercent, m.window]), [['total', 68.13, 'monthly'], ['auto', 69.83, 'monthly'], ['api', 0, 'monthly']]);
  assert.equal(meters[0].resetsAt, '2026-10-30T15:22:07.000Z');
});

test('Cursor Grok Bot (get-sand-usage-status, redacted real shape)', () => {
  const [m] = parseCursorGrokBot('', { currentPeriodStart: '2026-10-04T15:29:32.582Z', nextResetTimestampUtc: '2026-10-11T15:29:32.582Z', usagePercent: 85.54734, hasAvailableUsage: true });
  assert.deepEqual([m.id, m.label, m.window, m.usedPercent, m.resetsAt], ['grok-bot', 'Grok Bot', 'weekly', 85.55, '2026-10-11T15:29:32.582Z']);
  assert.deepEqual(parseCursorGrokBot('', {}), []);
});

test('generic extractor: used/limit pairs and epoch resets', () => {
  const meters = extractMeters({ plan: 'pro', monthly: { used: 250, limit: 500, resetAt: 1792000000 } });
  assert.equal(meters.length, 1);
  assert.equal(meters[0].usedPercent, 50);
  assert.equal(meters[0].window, 'monthly');
  assert.equal(meters[0].resetsAt, new Date(1792000000 * 1000).toISOString());
});

test('generic extractor: arrays of named models', () => {
  const meters = extractMeters({ models: [{ name: 'gpt-x', percentUsed: 10 }, { name: 'claude-y', percentUsed: 20 }] });
  assert.deepEqual(meters.map((m) => m.label), ['gpt-x', 'claude-y']);
});

test('makeMeter clamps and slugs', () => {
  const m = makeMeter({ label: 'Weekly · Opus', usedPercent: 1234 });
  assert.equal(m.id, 'weekly-opus');
  assert.equal(m.usedPercent, 1000);
  assert.equal(m.window, 'weekly');
});

test('Antigravity GetUserStatus: models grouped into quota pools (redacted real shape)', () => {
  const now = new Date('2026-10-10T19:55:00Z');
  const cfg = (label, remainingFraction, resetTime) => ({ label, modelOrAlias: { model: 'MODEL_X' }, quotaInfo: { remainingFraction, resetTime } });
  const { meters, plan } = parseAntigravityStatus({ userStatus: {
    planStatus: { planInfo: { planName: 'Pro' } },
    cascadeModelConfigData: { clientModelConfigs: [
      cfg('Claude Opus 5.5 (High)', 0.4895844, '2026-10-15T17:42:53Z'),
      cfg('Gemini 3.8 Flash (High)', 1, '2026-10-10T23:55:21Z'),
      cfg('Claude Sonnet 5.5 (Low)', 0.4895844, '2026-10-15T17:42:53Z'),
      cfg('GPT-OSS 120B (Medium)', 0.4895844, '2026-10-15T17:42:53Z'),
      cfg('Gemini 3.1 Pro (Low)', 1, '2026-10-10T23:55:21Z'),
      { label: 'No quota model' },
    ] },
  } }, now);
  assert.equal(plan, 'Pro');
  assert.deepEqual(meters.map((m) => [m.id, m.label, m.window, m.usedPercent]), [
    ['pool-claude-gpt-oss', 'Claude + GPT-OSS models', 'weekly', 51.04],
    ['pool-gemini', 'Gemini models', 'session', 0],
  ]);
});

test('Muse limit notice → 100% weekly meter with reset time', () => {
  const now = new Date(2026, 9, 11, 8, 0);
  const m = parseMuseLimitNotice('…\nYou\'ve reached your usage limit. Upgrade now or invite friends to get more Muse tokens. Your full weekly usage will reset at 1:36 AM on Wednesday, October 14.\nMessage', now);
  assert.equal(m.usedPercent, 100);
  assert.equal(m.window, 'weekly');
  const d = new Date(m.resetsAt);
  assert.deepEqual([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [9, 14, 1, 36]);
  assert.equal(parseMuseLimitNotice('nothing here'), null);
});

test('Antigravity: an exhausted pool omits remainingFraction (real shape, 2026-10-12) and counts as 100% used', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const { meters } = parseAntigravityStatus({ userStatus: { cascadeModelConfigData: { clientModelConfigs: [
    { label: 'Claude Opus 5.5 (High)', quotaInfo: { resetTime: '2026-10-15T17:42:53Z' } },
    { label: 'GPT-OSS 120B (Medium)', quotaInfo: { resetTime: '2026-10-15T17:42:53Z' } },
    { label: 'Gemini 3.1 Pro (Low)', quotaInfo: { remainingFraction: 1, resetTime: '2026-10-13T01:58:30Z' } },
    { label: 'No quota at all', quotaInfo: {} },
  ] } } }, now);
  assert.deepEqual(meters.map((m) => [m.id, m.usedPercent, m.resetsAt]), [
    ['pool-claude-gpt-oss', 100, '2026-10-15T17:42:53.000Z'],
    ['pool-gemini', 0, '2026-10-13T01:58:30.000Z'],
  ]);
});
