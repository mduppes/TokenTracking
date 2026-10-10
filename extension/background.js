// MV3 service worker: receives captures, normalizes them, keeps a local cache,
// forwards snapshots to the local service, and runs periodic background refreshes.
import { PROVIDERS, providerById, providerForUrl, FIRST_PARTY_HEADER_RULES } from './lib/providers.js';
import { makeMeter, parseResetText, classifyWindow, dedupeById } from './lib/parse.js';

export const DEFAULTS = {
  serverUrl: 'http://127.0.0.1:7878',
  intervalMin: 15,
  backgroundRefresh: true,
  // 'hidden': load usage pages in an invisible offscreen document (no window, no flicker).
  // 'window': open them in a minimized window (more compatible, but visible in the Dock).
  refreshMode: 'hidden',
  debugCapture: false,
  enabled: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.defaultEnabled !== false])),
  usageUrls: {}, // per-provider overrides of provider.usageUrl
};

async function settings() {
  const { settings: s = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...s, enabled: { ...DEFAULTS.enabled, ...s.enabled }, usageUrls: { ...s.usageUrls } };
}

const usageUrlFor = (p, s) => s.usageUrls[p.id] || p.usageUrl;

// ---- lifecycle ---------------------------------------------------------------

async function ensureAlarm() {
  const s = await settings();
  const existing = await chrome.alarms.get('refresh');
  if (!existing || existing.periodInMinutes !== s.intervalMin) {
    await chrome.alarms.create('refresh', { periodInMinutes: s.intervalMin, delayInMinutes: 1 });
  }
}
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); ensureHeaderRules(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); ensureHeaderRules(); });

// Give the extension's own requests to specific provider endpoints a first-party Origin/Referer
// (see FIRST_PARTY_HEADER_RULES). Session rules: re-installed on startup and before each refresh.
// Scope: requests outside any tab (this extension's service worker / offscreen page), never tab traffic.
const HEADER_RULE_BASE = 100;
async function ensureHeaderRules() {
  const ids = FIRST_PARTY_HEADER_RULES.map((_, i) => HEADER_RULE_BASE + i);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: ids,
    addRules: FIRST_PARTY_HEADER_RULES.map((r, i) => ({
      id: ids[i],
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: r.origin },
          { header: 'referer', operation: 'set', value: r.referer },
        ],
      },
      condition: {
        urlFilter: r.urlFilter,
        tabIds: [-1], // chrome.tabs.TAB_ID_NONE: extension requests only, never tab traffic
        resourceTypes: ['xmlhttprequest'],
      },
    })),
  });
}
chrome.storage.onChanged.addListener((c) => { if (c.settings) ensureAlarm(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'refresh') refreshAll('alarm'); });

// ---- messages ----------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.target === 'offscreen') return false; // addressed to the offscreen document
  handle(msg, sender).then(reply, (e) => reply({ error: String(e?.message || e) }));
  return true; // async reply
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'whoami': {
      const p = providerForUrl(msg.href);
      const s = await settings();
      if (!p || !s.enabled[p.id]) return null;
      const custom = s.usageUrls[p.id];
      const onUsagePage = p.usagePage.test(msg.href) || (custom && msg.href.startsWith(custom));
      // openSteps only run in pages we opened for background refresh, never in the user's own tabs:
      // either a minimized-window tab we created, or a frame inside our offscreen document (no tab).
      const fromOffscreen = !sender.tab && hiddenLoads.has(p.id);
      if (fromOffscreen) hiddenLoads.get(p.id).scriptRan = msg.href;
      const autoOpen = refreshTabIds.has(sender.tab?.id) || fromOffscreen;
      return { providerId: p.id, noDom: !!p.noDom, scrapeDom: onUsagePage && !p.noDom, autoOpen, openSteps: autoOpen ? p.openSteps || null : null };
    }
    case 'capture': return onCapture(msg, sender);
    case 'refreshNow': return refreshAll('manual');
    case 'getState': return getState();
    case 'testServer': return testServer();
    default: return null;
  }
}

async function onCapture(msg, sender) {
  const p = providerForUrl(sender.tab?.url || sender.url || msg.url);
  if (!p) return null;
  const s = await settings();
  if (!s.enabled[p.id]) return null;
  if (s.debugCapture) postDebug(s, p.id, msg).catch(() => {});

  let meters = [];
  let source;
  if (msg.kind === 'json') {
    const path = new URL(msg.url).pathname;
    if (!p.jsonPattern || !p.jsonPattern.test(path)) return null;
    meters = p.parseJson(msg.url, msg.data);
    source = `json:${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')}`;
  } else if (msg.kind === 'dom') {
    meters = dedupeById((msg.meters || []).map((m) => makeMeter({
      id: m.label,
      label: m.label,
      window: classifyWindow(`${m.label} ${m.resetText || ''}`),
      usedPercent: m.percent,
      resetsAt: parseResetText(m.resetText),
      resetText: m.resetText,
    })));
    source = 'dom';
  }
  if (!meters.length) return null;
  await report({ provider: p.id, meters, source });
  return { ok: true, count: meters.length };
}

// ---- reporting ---------------------------------------------------------------

const waiters = new Map(); // providerId → resolve fn, used by background refresh

async function report({ provider, meters, source, plan = null }) {
  const snapshot = { provider, source, plan, capturedAt: new Date().toISOString(), meters };
  const { last = {}, queue = [] } = await chrome.storage.local.get(['last', 'queue']);
  // Prefer JSON-derived data over DOM data captured in the same minute.
  const prev = last[provider];
  const prevFresh = prev && Date.now() - Date.parse(prev.capturedAt) < 60_000;
  if (!(source === 'dom' && prevFresh && prev.source !== 'dom')) last[provider] = snapshot;
  queue.push(snapshot);
  await chrome.storage.local.set({ last, queue: queue.slice(-500) });
  await flush();
  await updateBadge();
  waiters.get(provider)?.();
}

async function flush() {
  const s = await settings();
  const { queue = [] } = await chrome.storage.local.get('queue');
  if (!queue.length) return;
  try {
    const res = await fetch(`${s.serverUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshots: queue }),
    });
    if (!res.ok) throw new Error(`ingest ${res.status}`);
    await chrome.storage.local.set({ queue: [], server: { ok: true, at: new Date().toISOString() } });
  } catch (e) {
    await chrome.storage.local.set({ server: { ok: false, at: new Date().toISOString(), error: String(e.message || e) } });
  }
}

async function postDebug(s, provider, msg) {
  await fetch(`${s.serverUrl}/api/debug`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, kind: msg.kind, url: msg.url, data: msg.kind === 'json' ? msg.data : msg.meters }),
  });
}

async function testServer() {
  const s = await settings();
  try {
    const r = await fetch(`${s.serverUrl}/api/health`);
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

async function updateBadge() {
  const { last = {} } = await chrome.storage.local.get('last');
  const pcts = Object.values(last).flatMap((s) => s.meters.map((m) => m.usedPercent)).filter((v) => typeof v === 'number');
  if (!pcts.length) return chrome.action.setBadgeText({ text: '' });
  const max = Math.max(...pcts);
  await chrome.action.setBadgeText({ text: String(Math.round(max)) });
  await chrome.action.setBadgeBackgroundColor({ color: max >= 90 ? '#c0392b' : max >= 70 ? '#d68910' : '#2e7d32' });
}

async function getState() {
  const { last = {}, server = null, queue = [], lastRefresh = null } = await chrome.storage.local.get(['last', 'server', 'queue', 'lastRefresh']);
  const s = await settings();
  return {
    settings: s,
    server,
    queued: queue.length,
    lastRefresh,
    providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, enabled: s.enabled[p.id], usageUrl: usageUrlFor(p, s), last: last[p.id] || null })),
  };
}

// ---- background refresh ------------------------------------------------------

let refreshing = null;
const refreshTabIds = new Set();

function refreshAll(reason) {
  refreshing ??= withKeepAlive(() => doRefresh(reason)).finally(() => { refreshing = null; });
  return refreshing;
}

// Chrome stops an MV3 service worker after ~30 s without extension API activity, even mid-await.
// A refresh can wait up to 45 s per page, so ping a cheap API every 20 s while it runs.
async function withKeepAlive(fn) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try { return await fn(); } finally { clearInterval(timer); }
}

async function doRefresh(reason) {
  const s = await settings();
  await ensureHeaderRules().catch(() => {});
  const results = {};
  const at = new Date().toISOString();
  // Saved after every provider so partial progress is visible even if the run is cut short.
  const save = (done = false) => chrome.storage.local.set({ lastRefresh: { at, reason, done, results } });
  await save();
  let win = null;
  let usedOffscreen = false;
  try {
    for (const p of PROVIDERS) {
      if (!s.enabled[p.id]) continue;
      if (p.directFetch) {
        try {
          const { incomplete, ...r } = await p.directFetch();
          if (r.meters.length) {
            await report({ provider: p.id, ...r });
            results[p.id] = incomplete ? `api (partial: ${incomplete})` : 'api';
            if (!incomplete) { await save(); continue; } // otherwise also load the usage page for the missing meters
          }
        } catch (e) { results[p.id] = `api failed: ${e.message}`; }
      }
      const url = usageUrlFor(p, s);
      if (!s.backgroundRefresh || !url) { results[p.id] ??= url ? 'skipped (background refresh off)' : 'no usage URL set'; continue; }

      let outcome;
      if (s.refreshMode === 'window') {
        win ??= await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
        outcome = await loadInWindow(p, url, win);
      } else {
        usedOffscreen = true;
        outcome = await loadHidden(p, url);
      }
      results[p.id] = [results[p.id], outcome].filter(Boolean).join(' + ');
      await save();
    }
  } finally {
    if (win) chrome.windows.remove(win.id).catch(() => {});
    if (usedOffscreen) chrome.offscreen.closeDocument().catch(() => {});
    await save(true);
  }
  return results;
}

/** Resolve true when `p` reports data, false after `ms`. On success, linger so follow-up calls land too. */
async function waitForCapture(p, ms = 45_000) {
  const got = new Promise((resolve) => waiters.set(p.id, () => resolve(true)));
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), ms));
  const ok = await Promise.race([got, timeout]);
  if (ok) await new Promise((r) => setTimeout(r, 4000)); // pages often make several usage calls
  waiters.delete(p.id);
  return ok;
}

async function loadInWindow(p, url, win) {
  // Reuse the window's first tab, then add tabs. Start blank so the id is registered before "whoami".
  const first = win.tabs[0].id;
  const tabId = win.usedFirst ? (await chrome.tabs.create({ windowId: win.id, url: 'about:blank', active: true })).id : first;
  win.usedFirst = true;
  refreshTabIds.add(tabId);
  await chrome.tabs.update(tabId, { url });
  const ok = await waitForCapture(p);
  refreshTabIds.delete(tabId);
  if (tabId !== first) chrome.tabs.remove(tabId).catch(() => {});
  return ok ? 'window' : 'window: no data (logged out or page changed?)';
}

// ---- hidden refresh (offscreen document) ---------------------------------------
// The offscreen document is an invisible extension page that embeds the usage page in an iframe;
// content scripts (all_frames) run inside it as usual. Sites forbid framing via X-Frame-Options /
// CSP frame-ancestors, so a session DNR rule removes those headers, only for sub-frames that belong
// to no tab (extension pages such as ours) on provider hosts. Approved by the user 2026-10-10; the
// trade-off (the hidden copy runs without its CSP) is documented in docs/SECURITY.md and ADR-008.

const hiddenLoads = new Map(); // providerId → { scriptRan: href|null }
const HIDDEN_RULE_ID = 1;

async function ensureHiddenSetup() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [HIDDEN_RULE_ID],
    addRules: [{
      id: HIDDEN_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
        ],
      },
      condition: {
        requestDomains: [...new Set(PROVIDERS.flatMap((p) => p.hosts))],
        resourceTypes: ['sub_frame'],
        tabIds: [chrome.tabs.TAB_ID_NONE], // not in any tab: only our offscreen document
      },
    }],
  });
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Read AI subscription usage pages without opening visible tabs',
    });
  }
}

async function loadHidden(p, url) {
  try {
    await ensureHiddenSetup();
  } catch (e) {
    return `hidden: setup failed (${e.message})`;
  }
  const state = { scriptRan: null };
  hiddenLoads.set(p.id, state);
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'load', url });
  const ok = await waitForCapture(p);
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'unload' }).catch(() => {});
  hiddenLoads.delete(p.id);
  if (ok) return 'hidden';
  // Distinguish "page never ran our script" (blocked, redirected to login) from "ran but found nothing".
  return state.scriptRan
    ? `hidden: page loaded (${new URL(state.scriptRan).pathname}) but no usage found (logged out, page changed, or the site refuses to run framed)`
    : 'hidden: page script never ran (site blocked framing or redirected, e.g. to a login page)';
}
