// Headless refresh: start Chrome (dedicated profile), read each provider's usage from inside its own
// site, store snapshots, quit Chrome. Nothing runs between refreshes. See docs/ARCHITECTURE.md.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchChrome, openPage, profileInUse, browserIdentity } from './chrome.js';
import { execFileSync } from 'node:child_process';
import { parseClaudeUsage, parseCursorUsage, parseCursorGrokBot, MUSE_OPEN_STEPS } from '../../../lib/providers.js';
import { normalizeDomMeters } from '../../../lib/parse.js';
import { readAntigravity } from '../local/antigravity.js';

const SCRAPER_PATH = fileURLToPath(new URL('../../../lib/scrape-dom.js', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** macOS version for Client Hints, e.g. "26.6.2" (falls back to a generic value off macOS). */
function osVersion() {
  try { return execFileSync('sw_vers', ['-productVersion']).toString().trim(); } catch { return '15.0.0'; }
}

/**
 * Per-provider tasks. `api` tasks call the site's own JSON endpoints from inside the page, so they're
 * first-party requests (no Origin problems). `dom` tasks read the rendered page with lib/scrape-dom.js.
 * `loggedOut(href, text)` recognizes a login page (by URL, or by page text when the URL doesn't change).
 * Logged-out behavior observed 2026-10-10: Claude → /login, Cursor → authenticator.cursor.sh,
 * Gemini → /app with "Sign in", Muse → same URL with "Log in or create an account".
 */
export const TASKS = [
  {
    id: 'claude',
    url: 'https://claude.ai/new',
    loggedOut: (href) => /\/login|\/logout/.test(new URL(href).pathname) || new URL(href).hostname !== 'claude.ai',
    async read(page) {
      const r = await page.evaluate(`(async () => {
        const res = await fetch('/api/organizations', { headers: { accept: 'application/json' } });
        if (res.status === 401 || res.status === 403) return { login: true };
        const orgs = await res.json();
        const org = orgs.find((o) => (o.capabilities || []).includes('chat')) || orgs[0];
        if (!org) return { error: 'no organization' };
        const u = await fetch('/api/organizations/' + org.uuid + '/usage', { headers: { accept: 'application/json' } });
        return { usage: await u.json(), capabilities: org.capabilities || [], tier: org.rate_limit_tier || null };
      })()`);
      if (r.login || r.error) return r;
      const plan = r.capabilities.find((c) => /max|pro|team|enterprise/i.test(c)) || r.tier;
      return { meters: parseClaudeUsage('', r.usage), plan, source: 'headless:api' };
    },
  },
  {
    id: 'cursor',
    url: 'https://cursor.com/dashboard/spending',
    loggedOut: (href) => !/(^|\.)cursor\.com$/.test(new URL(href).hostname) || /\/login|\/sign/.test(new URL(href).pathname),
    async read(page) {
      const r = await page.evaluate(`(async () => {
        const s = await fetch('/api/usage-summary', { headers: { accept: 'application/json' } });
        if (s.status === 401 || s.status === 403) return { login: true };
        const summary = await s.json();
        let sand = null;
        try {
          const g = await fetch('/api/dashboard/get-sand-usage-status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          if (g.ok) sand = await g.json();
        } catch {}
        return { summary, sand };
      })()`);
      if (r.login) return r;
      const meters = [...parseCursorUsage('', r.summary), ...(r.sand ? parseCursorGrokBot('', r.sand) : [])];
      return { meters, plan: r.summary.membershipType || null, source: 'headless:api' };
    },
  },
  {
    id: 'gemini',
    url: 'https://gemini.google.com/usage',
    loggedOut: (href) => new URL(href).hostname !== 'gemini.google.com' || !new URL(href).pathname.startsWith('/usage'),
    read: (page) => readDom(page),
  },
  {
    id: 'muse',
    url: 'https://muse.ai/',
    loggedOut: (href, text) => !/(^|\.)muse\.ai$/.test(new URL(href).hostname) || /Log in or create an account/i.test(text),
    async read(page) {
      const r = await readDom(page, MUSE_OPEN_STEPS);
      if (!r.error) return r;
      // Seen 2026-10-11: still logged in, but the agent stays "Connecting…" and Settings has no Usage
      // section. A fresh login fixes it, so report it as a login problem (the dashboard offers "Log in").
      const stuck = await page.evaluate('/Connecting…|Connecting\\.\\.\\.|Connect to manage/.test(document.body.innerText)').catch(() => false);
      return stuck ? { login: true, message: 'session expired (stuck on "Connecting…"): log in again' } : r;
    },
  },
];

/** Inject the shared scraper, optionally click through to the usage view, poll until meters appear. */
async function readDom(page, openSteps = null, ms = 25_000) {
  await page.evaluate(await readFile(SCRAPER_PATH, 'utf8'));
  if (openSteps) {
    const opened = await page.evaluate(`TokenTrackingDom.runOpenSteps(${JSON.stringify(openSteps)})`, 30_000);
    if (!opened) return { error: 'could not open the usage view (logged out, or the page changed)' };
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const raw = await page.evaluate('TokenTrackingDom.scrape()');
    if (raw?.length) return { meters: normalizeDomMeters(raw), source: 'headless:dom' };
    await sleep(1000);
  }
  return { error: 'no usage found on the page (logged out, or the page changed)' };
}

let running = null;

/**
 * Run one headless refresh. Returns { at, results: { [providerId]: { status, message?, meters? } } }.
 * status: ok | login (needs `npm run browser-login`) | error | skipped
 */
export const isRefreshing = () => running !== null;

export function runHeadlessRefresh(opts) {
  running ??= doRun(opts).finally(() => { running = null; });
  return running;
}

async function doRun({ db, config, only = null, log = () => {} }) {
  const at = new Date().toISOString();
  const results = {};
  const wanted = (id) => (!only || only.includes(id)) && !config.headless.disabled.includes(id);
  const tasks = TASKS.filter((t) => wanted(t.id));

  // Local sources first: no Chrome needed (ADR-011).
  if (wanted('antigravity')) {
    const started = Date.now();
    try {
      const r = await readAntigravity();
      if (r.status === 'ok') {
        const snap = { capturedAt: new Date().toISOString(), source: 'local:language-server', plan: r.plan };
        for (const m of r.meters) db.addSnapshot('antigravity', snap, m);
        results.antigravity = { status: 'ok', meters: r.meters.length };
      } else results.antigravity = { status: r.status, message: r.message };
    } catch (e) { results.antigravity = { status: 'error', message: e.message }; }
    results.antigravity.ms = Date.now() - started;
    log(`antigravity: ${results.antigravity.status}${results.antigravity.message ? ` (${results.antigravity.message})` : ''}`);
  }
  if (!tasks.length) return save(config, { at, results }, only);

  if (!existsSync(config.headless.profileDir)) {
    for (const t of tasks) results[t.id] = { status: 'login', message: 'no browser profile yet: run `npm run browser-login`' };
    return save(config, { at, results }, only);
  }
  if (profileInUse(config.headless.profileDir)) {
    for (const t of tasks) results[t.id] = { status: 'skipped', message: 'browser-login window is still open' };
    return save(config, { at, results }, only);
  }

  const conn = await launchChrome({ chromePath: config.headless.chromePath, profileDir: config.headless.profileDir });
  try {
    const identity = await browserIdentity(conn, { osVersion: osVersion() });
    for (const t of tasks) {
      const started = Date.now();
      const page = await openPage(conn, { identity });
      try {
        await page.goto(t.url).catch(() => {}); // SPAs may never fire load cleanly; we check the URL next
        await sleep(2500);
        const { href, text } = await page.evaluate(`({ href: location.href, text: document.body?.innerText.slice(0, 2000) || '' })`);
        const r = t.loggedOut(href, text) ? { login: true } : await t.read(page);
        if (r.login) results[t.id] = { status: 'login', message: r.message || 'logged out: log in again' };
        else if (r.error) results[t.id] = { status: 'error', message: r.error };
        else {
          const snap = { capturedAt: new Date().toISOString(), source: r.source, plan: r.plan || null };
          for (const m of r.meters) db.addSnapshot(t.id, snap, m);
          results[t.id] = { status: 'ok', meters: r.meters.length };
        }
      } catch (e) {
        results[t.id] = { status: 'error', message: e.message };
      } finally {
        await page.close();
        results[t.id].ms = Date.now() - started;
        log(`${t.id}: ${results[t.id].status}${results[t.id].message ? ` (${results[t.id].message})` : ''}`);
      }
    }
  } finally {
    await conn.close();
  }
  return save(config, { at, results }, only);
}

/** Persist the run. A partial run (`only`) merges into the previous results so other providers keep their status. */
async function save(config, run, only = null) {
  if (only) {
    const prev = await lastHeadlessRun(config);
    run = { at: run.at, results: { ...(prev?.results || {}), ...run.results } };
  }
  await writeFile(config.headless.statusPath, JSON.stringify(run, null, 2), { mode: 0o600 }).catch(() => {});
  return run;
}

export async function lastHeadlessRun(config) {
  try { return JSON.parse(await readFile(config.headless.statusPath, 'utf8')); } catch { return null; }
}
