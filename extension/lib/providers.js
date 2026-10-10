// Provider registry. Each provider describes where its usage lives and how to read it.
// See docs/PROVIDERS.md for verification status of every URL/endpoint below.
//
// Fields:
//   id, name        — stable id (sent to the local service) and display name
//   hosts           — hostnames the content scripts run on (must also be in manifest.json)
//   usageUrl        — page opened for background refresh (null = unknown; user can set it in Options)
//   usagePage       — regex on location.href; DOM scraping only runs on matching pages
//   jsonPattern     — regex on response URL path; matching JSON responses are parsed (null = DOM only)
//   parseJson(url, json) → meters[]
//   directFetch()   — optional: fetch usage straight from the service worker using the browser session
//   openSteps       — optional: clicks the collector performs in a background-refresh tab to reveal usage
//   defaultEnabled  — optional: false to ship disabled
//   noDom           — optional: never DOM-scrape (use when JSON is verified, to avoid duplicate meters)

import { extractMeters, makeMeter, dedupeById } from './parse.js';

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

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('json')) throw new Error(`${url} → ${res.status} ${type}`);
  return res.json();
}

async function fetchClaude() {
  const orgs = await getJson('https://claude.ai/api/organizations');
  const list = Array.isArray(orgs) ? orgs : [];
  const org = list.find((o) => (o.capabilities || []).includes('chat')) || list[0];
  if (!org?.uuid) throw new Error('no Claude organization found');
  const url = `https://claude.ai/api/organizations/${org.uuid}/usage`;
  const meters = parseClaudeUsage(url, await getJson(url));
  const plan = (org.capabilities || []).find((c) => /max|pro|team|enterprise/i.test(c)) || org.rate_limit_tier || null;
  return { meters, plan, source: 'api:/api/organizations/:org/usage' };
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

function parseCursorAny(url, json) {
  return /get-sand-usage-status$/.test(url) ? parseCursorGrokBot(url, json) : parseCursorUsage(url, json);
}

/**
 * Requests made by the extension itself that need a first-party Origin/Referer to be accepted.
 * Cursor's dashboard POST endpoints answer 403 to Origin chrome-extension://… (seen 2026-10-10).
 * background.js installs one session DNR rule per entry, limited to requests from this extension.
 */
export const FIRST_PARTY_HEADER_RULES = [
  { urlFilter: '|https://cursor.com/api/dashboard/get-sand-usage-status', origin: 'https://cursor.com', referer: 'https://cursor.com/dashboard/spending' },
];

async function fetchCursor() {
  const summary = await getJson('https://cursor.com/api/usage-summary');
  const meters = parseCursorUsage('', summary);
  // Cursor's dashboard POST endpoints may reject requests whose Origin isn't cursor.com (ours is
  // chrome-extension://…). If so, report `incomplete` and the refresh loop falls back to opening the
  // spending page, where hook.js captures the page's own call.
  let incomplete = null;
  try {
    const res = await fetch('https://cursor.com/api/dashboard/get-sand-usage-status', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}',
    });
    const grok = res.ok ? parseCursorGrokBot('', await res.json()) : [];
    if (grok.length) meters.push(...grok);
    else incomplete = `grok-bot: HTTP ${res.status}`;
  } catch (e) { incomplete = `grok-bot: ${e.message}`; }
  return { meters, plan: summary.membershipType || null, source: 'api:/api/usage-summary', incomplete };
}

const generic = (_url, json) => dedupeById(extractMeters(json));

export const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai'],
    usageUrl: 'https://claude.ai/new#settings/usage',
    usagePage: /#settings\/usage|\/settings\/usage/,
    noDom: true, // JSON is verified; DOM meters would duplicate it under different ids
    jsonPattern: /\/api\/organizations\/[^/]+\/usage$/,
    parseJson: parseClaudeUsage,
    directFetch: fetchClaude,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    hosts: ['cursor.com', 'www.cursor.com'],
    usageUrl: 'https://cursor.com/dashboard/spending',
    usagePage: /\/dashboard/,
    noDom: true, // JSON is verified; DOM meters would duplicate it under different ids
    jsonPattern: /\/api\/(usage-summary|dashboard\/get-sand-usage-status)$/,
    parseJson: parseCursorAny,
    directFetch: fetchCursor,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com'],
    usageUrl: 'https://gemini.google.com/usage',
    usagePage: /\/usage/,
    jsonPattern: null, // Gemini uses batchexecute RPC; rely on DOM scraping.
    parseJson: generic,
  },
  {
    id: 'muse',
    name: 'Muse (Meta)',
    hosts: ['muse.ai', 'www.muse.ai'],
    // Usage lives in a Settings dialog (General tab) with no URL of its own; the page
    // fetches it over a channel the hook can't see, so we read the dialog's progress bar.
    usageUrl: 'https://muse.ai/',
    usagePage: /^https:\/\/(www\.)?muse\.ai\//,
    openSteps: [
      { selector: 'button[data-testid="hatch-dock-more"]' }, // bottom-left "Settings" menu button
      { text: 'Settings' },                                   // menu item → dialog opens on General
    ],
    jsonPattern: /(usage|quota|limit)/i,
    parseJson: generic,
  },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

export function providerForUrl(href) {
  let host;
  try { host = new URL(href).hostname; } catch { return null; }
  return PROVIDERS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) || null;
}
