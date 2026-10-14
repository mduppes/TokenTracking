// Provider-specific parsers and constants used by the headless refresher (server/src/headless/).
// Each parser takes a provider's own JSON and returns normalized meters (see makeMeter in parse.js).
// Response shapes are documented in docs/PROVIDERS.md.
import { extractMeters, makeMeter, parseResetText } from './parse.js';

const CLAUDE_LABELS = {
  five_hour: 'Current session (5h)',
  seven_day: 'Weekly · all models',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_oauth_apps: 'Weekly · OAuth apps',
};

/** Claude's usage JSON: { five_hour: {utilization, resets_at}, seven_day: {...}, ... } */
export function parseClaudeUsage(_url, json) {
  if (!json || typeof json !== 'object') return [];
  const meters = [];
  for (const [key, v] of Object.entries(json)) {
    if (v && typeof v === 'object' && typeof v.utilization === 'number') {
      meters.push(makeMeter({
        id: key,
        label: CLAUDE_LABELS[key] || key,
        usedPercent: v.utilization,
        resetsAt: v.resets_at,
      }));
    }
  }
  return meters.length ? meters : extractMeters(json, { labels: CLAUDE_LABELS });
}

/**
 * Cursor `GET /api/usage-summary` (verified 2026-10-10):
 * { billingCycleEnd, membershipType, individualUsage: { plan: { used, limit, breakdown: {included, bonus, total},
 *   autoPercentUsed, apiPercentUsed, totalPercentUsed }, onDemand: { enabled, used, limit } } }
 * `plan.used/limit` only covers the included dollar amount (cents) and hits 100% while bonus usage remains,
 * so the percentages are the source of truth (they match the dashboard's "You've used N%" message).
 */
export function parseCursorUsage(url, json) {
  const plan = json?.individualUsage?.plan;
  if (!plan || typeof plan.totalPercentUsed !== 'number') return extractMeters(json);
  const resetsAt = json.billingCycleEnd || null;
  const meters = [
    makeMeter({ id: 'total', label: 'Included total', window: 'monthly', usedPercent: plan.totalPercentUsed, resetsAt }),
  ];
  if (typeof plan.autoPercentUsed === 'number') {
    // Dashboard: "Cursor Models — includes Cursor Grok and Composer"
    meters.push(makeMeter({ id: 'auto', label: 'Cursor models', window: 'monthly', usedPercent: plan.autoPercentUsed, resetsAt }));
  }
  if (typeof plan.apiPercentUsed === 'number') {
    meters.push(makeMeter({ id: 'api', label: 'Other models', window: 'monthly', usedPercent: plan.apiPercentUsed, resetsAt }));
  }
  const od = json.individualUsage.onDemand;
  if (od?.enabled && typeof od.used === 'number') {
    meters.push(makeMeter({ id: 'on-demand', label: 'On-demand spend', window: 'monthly', used: od.used / 100, limit: od.limit != null ? od.limit / 100 : null, unit: 'USD', resetsAt }));
  }
  return meters;
}

/**
 * Grok Bot is a Cursor product ("sand" internally) with its own weekly limit, shown on
 * cursor.com/dashboard/spending. `POST /api/dashboard/get-sand-usage-status` with body {} (verified 2026-10-10):
 * { currentPeriodStart, nextResetTimestampUtc, usagePercent, hasAvailableUsage, ... }
 */
export function parseCursorGrokBot(_url, json) {
  if (typeof json?.usagePercent !== 'number') return [];
  return [makeMeter({ id: 'grok-bot', label: 'Grok Bot', window: 'weekly', usedPercent: json.usagePercent, resetsAt: json.nextResetTimestampUtc })];
}

/** Muse: Settings lives in a dialog behind the bottom-left menu (verified 2026-10-10). */
export const MUSE_OPEN_STEPS = [
  { selector: 'button[data-testid="hatch-dock-more"]' }, // bottom-left "Settings" menu button
  { text: 'Settings' },                                   // menu item → dialog opens on General
];

/**
 * Antigravity: the app's local language server answers GetUserStatus (verified 2026-10-10) with
 * userStatus.cascadeModelConfigData.clientModelConfigs[] = { label, quotaInfo: { remainingFraction, resetTime } }
 * and userStatus.planStatus.planInfo.planName. Models share quota pools: every model in a pool reports
 * the same remainingFraction and resetTime, so we group by that and emit one meter per pool.
 * An exhausted pool has no remainingFraction at all (only resetTime): that means 0 remaining = 100% used.
 */
export function parseAntigravityStatus(json, now = new Date()) {
  const configs = json?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
  const pools = new Map();
  for (const m of configs) {
    const q = m?.quotaInfo;
    if (!q || (typeof q.remainingFraction !== 'number' && !q.resetTime)) continue;
    // A fully used pool omits remainingFraction (zero values are left out of the JSON), leaving only
    // resetTime (seen 2026-10-12). Treat that as 0% remaining, not as "no quota info".
    const remaining = typeof q.remainingFraction === 'number' ? q.remainingFraction : 0;
    const key = `${q.resetTime}|${remaining}`;
    const family = String(m.label || 'Models').split(/\s+\d/)[0].trim(); // "Claude Opus 5.5 (High)" → "Claude Opus"
    const brand = family.split(/\s+/)[0];                                // → "Claude"
    if (!pools.has(key)) pools.set(key, { q, remaining, brands: new Set() });
    pools.get(key).brands.add(brand);
  }
  const seen = new Set();
  const meters = [...pools.values()].map(({ q, remaining, brands }) => {
    const names = [...brands].sort();
    let id = `pool-${names.join('-')}`;
    for (let i = 2; seen.has(slugId(id)); i++) id = `pool-${names.join('-')}-${i}`;
    seen.add(slugId(id));
    const hours = (Date.parse(q.resetTime) - now.getTime()) / 36e5;
    const window = !Number.isFinite(hours) ? 'other' : hours <= 6 ? 'session' : hours <= 26 ? 'daily' : 'weekly';
    return makeMeter({ id, label: `${names.join(' + ')} models`, window, usedPercent: (1 - remaining) * 100, resetsAt: q.resetTime });
  });
  return { meters, plan: json?.userStatus?.planStatus?.planInfo?.planName || null };
}

const slugId = (s) => s.toLowerCase();

/**
 * Muse shows a notice when you're out of tokens, before its agent has even connected (seen 2026-10-11):
 * "You've reached your usage limit. … Your full weekly usage will reset at 1:36 AM on Wednesday, October 14."
 * Returns a 100% weekly meter only while its reset is still within the current weekly window.
 */
export function parseMuseLimitNotice(text, now = new Date()) {
  const m = String(text || '').match(/reached your usage limit[\s\S]{0,300}?reset (?:at|on) ([^.\n]+)/i);
  if (!m) return null;
  const resetsAt = parseResetText(m[1], now);
  // Old notices can survive a reset. The generic date parser rolls an expired month/day into
  // next year; neither that nor an unknown reset can establish a current exhausted weekly pool.
  const remaining = resetsAt ? resetsAt.getTime() - now.getTime() : NaN;
  if (!(remaining > 0 && remaining <= 7 * 864e5)) return null;
  return makeMeter({ id: 'weekly', label: 'Weekly limit', window: 'weekly', usedPercent: 100, resetsAt, resetText: `Resets ${m[1].trim()}` });
}
