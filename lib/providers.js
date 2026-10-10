// Provider-specific parsers and constants used by the headless refresher (server/src/headless/).
// Each parser takes a provider's own JSON and returns normalized meters (see makeMeter in parse.js).
// Response shapes are documented in docs/PROVIDERS.md.
import { extractMeters, makeMeter } from './parse.js';

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
