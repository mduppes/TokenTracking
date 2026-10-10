// Pure parsing helpers: normalized meters, reset-text parsing, window classification. Unit-tested.
// No DOM or chrome.* APIs in this file.

/** Normalized meter shape sent to the local service. */
export function makeMeter({ id, label, window, usedPercent = null, used = null, limit = null, unit = null, resetsAt = null, resetText = null }) {
  const pct = usedPercent ?? (isNum(used) && isNum(limit) && limit > 0 ? (used / limit) * 100 : null);
  return {
    id: slug(id || label),
    label: String(label || id).slice(0, 80),
    window: window || classifyWindow(`${id} ${label}`),
    usedPercent: isNum(pct) ? round(clamp(pct, 0, 1000), 2) : null,
    used: isNum(used) ? used : null,
    limit: isNum(limit) ? limit : null,
    unit: unit || null,
    resetsAt: toIso(resetsAt),
    resetText: resetText ? String(resetText).slice(0, 120) : null,
  };
}

/** Guess the limit window ("session" | "daily" | "weekly" | "monthly" | "other") from a label or key. */
export function classifyWindow(text) {
  const t = String(text || '').toLowerCase().replace(/[_-]/g, ' ');
  if (/week|7 ?day|seven ?day/.test(t)) return 'weekly';
  if (/5 ?h|five ?hour|session|current|rolling/.test(t)) return 'session';
  if (/month|billing|cycle|30 ?day/.test(t)) return 'monthly';
  if (/\bday\b|daily|24 ?h|today/.test(t)) return 'daily';
  return 'other';
}

const UNIT_MS = { d: 864e5, h: 36e5, m: 6e4, s: 1e3 };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Turn human reset text into a Date. Handles e.g.
 *   "Resets in 2 hr 14 min", "resets in 3 days", "Resets Thu 10:00 AM",
 *   "Resets Oct 14", "Resets tomorrow at 9am", "Resets at 5:30 PM", ISO strings.
 * Returns null when nothing recognizable is found.
 */
export function parseResetText(text, now = new Date()) {
  if (!text) return null;
  const raw = String(text).trim();
  const iso = raw.match(/\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?/);
  if (iso) return validDate(new Date(iso[0]));
  const t = raw.toLowerCase();

  // Relative: "in 2 hr 14 min", "2h 5m", "3 days"
  const rel = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)];
  if (rel.length && (/\bin\b/.test(t) || !/\b(am|pm|\d{1,2}:\d{2})\b/.test(t))) {
    const ms = rel.reduce((sum, [, n, u]) => sum + parseFloat(n) * UNIT_MS[u[0]], 0);
    if (ms > 0) return new Date(now.getTime() + ms);
  }

  const time = parseTime(t);
  const d = new Date(now);
  d.setSeconds(0, 0);

  // "Oct 14", "October 14, 2026", "14 Oct"
  const md = [...t.matchAll(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/g)].find((x) => MONTHS.includes(x[1]));
  const dm = [...t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b/g)].find((x) => MONTHS.includes(x[2]));
  const monthHit = (md && { m: MONTHS.indexOf(md[1]), day: +md[2], y: md[3] && +md[3] })
    || (dm && { m: MONTHS.indexOf(dm[2]), day: +dm[1] });
  if (monthHit) {
    d.setMonth(monthHit.m, monthHit.day);
    if (monthHit.y) d.setFullYear(monthHit.y);
    applyTime(d, time ?? { h: 0, min: 0 });
    if (!monthHit.y && d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}(?:[a-z]*day)?\\b`).test(t));
  if (wd >= 0) {
    let add = (wd - now.getDay() + 7) % 7;
    applyTime(d, time ?? { h: 0, min: 0 });
    d.setDate(d.getDate() + add);
    if (d <= now) d.setDate(d.getDate() + 7);
    return d;
  }

  if (/tomorrow/.test(t)) {
    d.setDate(d.getDate() + 1);
    applyTime(d, time ?? { h: 0, min: 0 });
    return d;
  }

  if (time) {
    applyTime(d, time);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  return null;
}

function parseTime(t) {
  const m = t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/) || t.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
  const ap = (m[3] && !/^\d/.test(m[3]) ? m[3] : m[2] && !/^\d/.test(m[2]) ? m[2] : '') || '';
  if (/^p/.test(ap) && h < 12) h += 12;
  if (/^a/.test(ap) && h === 12) h = 0;
  return h < 24 && min < 60 ? { h, min } : null;
}

function applyTime(d, { h, min }) { d.setHours(h, min, 0, 0); }

const PCT_KEYS = ['utilization', 'usedPercent', 'used_percent', 'percentUsed', 'percent_used', 'percentage', 'percent', 'usage_percent', 'usagePercent'];
const USED_KEYS = ['used', 'usage', 'consumed', 'current', 'count', 'numRequests', 'num_requests', 'spent', 'tokens_used', 'tokensUsed'];
const LIMIT_KEYS = ['limit', 'max', 'quota', 'total', 'allowance', 'maxRequestUsage', 'max_request_usage', 'cap', 'tokens_limit', 'tokensLimit'];
const RESET_KEYS = ['resets_at', 'resetsAt', 'reset_at', 'resetAt', 'reset_time', 'resetTime', 'next_reset', 'nextReset', 'period_end', 'periodEnd', 'billingCycleEnd', 'endOfCycle', 'renews_at'];

/**
 * Walk an arbitrary JSON response and pull out anything that looks like a usage meter:
 * an object with a percent-ish field, or a used+limit pair, optionally a reset timestamp.
 */
export function extractMeters(json, { labels = {}, maxDepth = 6 } = {}) {
  const out = [];
  const walk = (node, path, depth) => {
    if (!node || typeof node !== 'object' || depth > maxDepth) return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, [...path, String(i)], depth + 1)); return; }
    const pctKey = PCT_KEYS.find((k) => isNum(node[k]));
    const usedKey = USED_KEYS.find((k) => isNum(node[k]));
    const limitKey = LIMIT_KEYS.find((k) => isNum(node[k]));
    if (pctKey || (usedKey && limitKey)) {
      const key = path.filter((p) => !/^\d+$/.test(p)).slice(-2).join('.') || 'usage';
      const name = node.name || node.label || node.title || node.model || node.type;
      const id = name ? `${key}.${name}` : key;
      let pct = pctKey ? node[pctKey] : null;
      if (pct != null && /ratio|fraction/.test(pctKey)) pct *= 100;
      out.push(makeMeter({
        id,
        label: labels[path.at(-1)] || (typeof name === 'string' ? name : humanize(path.at(-1) || 'usage')),
        window: classifyWindow(`${path.join(' ')} ${name || ''}`),
        usedPercent: pct,
        used: usedKey ? node[usedKey] : null,
        limit: limitKey ? node[limitKey] : null,
        resetsAt: firstDate(node, RESET_KEYS),
      }));
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, [...path, k], depth + 1);
  };
  walk(json, [], 0);
  return dedupeById(out);
}

/** Turn raw meters from lib/scrape-dom.js ({label, percent, resetText}) into normalized meters. */
export function normalizeDomMeters(raw, now = new Date()) {
  return dedupeById((raw || []).map((m) => makeMeter({
    id: m.label,
    label: m.label,
    window: classifyWindow(`${m.label} ${m.resetText || ''}`),
    usedPercent: m.percent,
    resetsAt: parseResetText(m.resetText, now),
    resetText: m.resetText,
  })));
}

export function dedupeById(meters) {
  const seen = new Map();
  for (const m of meters) if (!seen.has(m.id)) seen.set(m.id, m);
  return [...seen.values()];
}

function firstDate(obj, keys) {
  for (const k of keys) if (obj[k] != null) { const d = toIso(obj[k]); if (d) return d; }
  return null;
}

export function toIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return validDate(v)?.toISOString() ?? null;
  if (isNum(v)) return validDate(new Date(v < 1e12 ? v * 1000 : v))?.toISOString() ?? null;
  if (typeof v === 'string' && /^\d+$/.test(v)) return toIso(+v);
  const d = validDate(new Date(v));
  return d ? d.toISOString() : null;
}

export function humanize(key) {
  return String(key).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase());
}

export function slug(s) {
  return String(s || 'usage').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'usage';
}

function validDate(d) { return d instanceof Date && !isNaN(d) ? d : null; }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v, n) { const f = 10 ** n; return Math.round(v * f) / f; }
