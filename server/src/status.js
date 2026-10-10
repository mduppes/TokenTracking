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
