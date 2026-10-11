import { computePace, WINDOW_HOURS } from './pacing.js';

export const PROVIDER_NAMES = { claude: 'Claude', cursor: 'Cursor', gemini: 'Gemini', muse: 'Muse (Meta)', antigravity: 'Antigravity' };
// Display order for providers everywhere (dashboard cards, table, CLI); unknown ids go last, A–Z.
const PROVIDER_ORDER = ['claude', 'cursor', 'antigravity', 'muse', 'gemini'];
const WINDOW_ORDER = { session: 0, daily: 1, weekly: 2, monthly: 3, other: 4 };
const DEFAULT_STALE_AFTER_MS = 60 * 6e4;
const HIDE_AFTER_DAYS = 7;

/** Build the dashboard/CLI view: latest reading per meter + pacing + short history. */
/** @param {{staleAfterMs?: number}} opts  a meter is stale when its last reading is older than this */
export function buildStatus(db, now = new Date(), { staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  const since = new Date(now.getTime() - HIDE_AFTER_DAYS * 864e5).toISOString();
  const providers = new Map();
  for (const row of db.latest(since)) {
    const latest = {
      usedPercent: row.used_percent, resetsAt: row.resets_at, window: row.window, capturedAt: row.captured_at,
    };
    const histSince = new Date(now.getTime() - (WINDOW_HOURS[row.window] || 168) * 36e5).toISOString();
    const history = db.history(row.provider, row.meter_id, histSince)
      .map((h) => ({ usedPercent: h.used_percent, resetsAt: h.resets_at, capturedAt: h.captured_at }));
    const meter = {
      id: row.meter_id, label: row.label, window: row.window,
      usedPercent: row.used_percent, used: row.used, limit: row.limit_value, unit: row.unit,
      resetsAt: row.resets_at, resetText: row.reset_text, source: row.source, capturedAt: row.captured_at,
      stale: now - Date.parse(row.captured_at) > staleAfterMs,
      pace: computePace(latest, history, now),
      history: history.slice(-200).map((h) => [h.capturedAt, h.usedPercent]),
    };
    if (!providers.has(row.provider)) {
      providers.set(row.provider, { id: row.provider, name: PROVIDER_NAMES[row.provider] || row.provider, plan: null, lastCapturedAt: null, meters: [] });
    }
    const p = providers.get(row.provider);
    p.meters.push(meter);
    if (row.plan) p.plan = row.plan;
    if (!p.lastCapturedAt || row.captured_at > p.lastCapturedAt) p.lastCapturedAt = row.captured_at;
  }
  for (const p of providers.values()) p.meters.sort((a, b) => (WINDOW_ORDER[a.window] ?? 9) - (WINDOW_ORDER[b.window] ?? 9) || a.label.localeCompare(b.label));
  const rank = (id) => (PROVIDER_ORDER.includes(id) ? PROVIDER_ORDER.indexOf(id) : PROVIDER_ORDER.length);
  const ordered = [...providers.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  return { generatedAt: now.toISOString(), providers: ordered };
}

// ---- Presentation shared by every UI (web dashboard, menu bar panel) --------------------------------
// Both UIs render these fields as-is, so wording and rules live in one tested place.

/** "claude_max" → "Max", "pro" → "Pro" */
export function planLabel(plan) {
  if (!plan) return null;
  return String(plan).replace(/^claude_/i, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function ago(iso, now = new Date()) {
  const m = Math.round((now - Date.parse(iso)) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

/**
 * Adds `planLabel` to providers plus top-level `notices` and `resetsNext`.
 * @param status    buildStatus() output
 * @param headless  last headless run ({ results: { [id]: { status, message } } }) or null
 * @param canLogIn  provider ids that have a login page (headless/login.js LOGIN_URLS)
 */
export function withPresentation(status, headless, canLogIn = new Set(), now = new Date()) {
  const results = headless?.results || {};
  const name = (id) => status.providers.find((p) => p.id === id)?.name || PROVIDER_NAMES[id] || id;
  const reason = (r) => (r.status === 'login' ? 'needs a login' : r.message || r.status);
  const notices = [];

  // 1. Stale services (missed ~2 refreshes), with the last refresh's reason when it failed.
  const staleIds = new Set();
  for (const p of status.providers) {
    const stale = p.meters.filter((m) => m.stale);
    if (!stale.length) continue;
    staleIds.add(p.id);
    const oldest = stale.map((m) => m.capturedAt).sort()[0];
    const r = results[p.id];
    const why = r && r.status !== 'ok' ? ` · last refresh: ${reason(r)}` : '';
    notices.push({ provider: p.id, kind: 'stale', text: `${p.name} is stale: last read ${ago(oldest, now)}${why}`, canLogIn: canLogIn.has(p.id) });
  }
  // 2. Refresh problems for services not already listed (skipped = e.g. app not running: no notice).
  for (const [id, r] of Object.entries(results)) {
    if (staleIds.has(id) || r.status === 'ok' || r.status === 'skipped') continue;
    notices.push(r.status === 'login'
      ? { provider: id, kind: 'login', text: `${name(id)} needs a login`, canLogIn: canLogIn.has(id) }
      : { provider: id, kind: 'error', text: `${name(id)}: ${reason(r)}`, canLogIn: false }); // logging in won't fix a page error
  }

  // 3. Every meter with a reset time, soonest first (UIs show the first N).
  const resetsNext = status.providers
    .flatMap((p) => p.meters.filter((m) => m.resetsAt).map((m) => ({
      provider: p.id, providerName: p.name, meterId: m.id, label: m.label,
      usedPercent: m.usedPercent, resetsAt: m.resetsAt, status: m.pace.status, stale: m.stale, capturedAt: m.capturedAt,
    })))
    .sort((a, b) => Date.parse(a.resetsAt) - Date.parse(b.resetsAt));

  return { ...status, providers: status.providers.map((p) => ({ ...p, planLabel: planLabel(p.plan) })), notices, resetsNext };
}
