import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatus, withPresentation } from './status.js';
import { isRefreshing, lastHeadlessRun } from './headless/refresh.js';
import { openLoginWindow, LOGIN_URLS } from './headless/login.js';
import { profileInUse } from './headless/chrome.js';
import { providerEnabled, updateSetup } from './setup.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 16 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ db, config, refresh = null, schedule = null }) {
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const selfOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  const setupInfo = () => ({ ...config.setup, needsSetup: !config.setup?.completed,
    chromeAvailable: existsSync(config.headless.chromePath), browserOpen: profileInUse(config.headless.profileDir), refreshing: isRefreshing() });

  /** Security gate: see docs/SECURITY.md ("Local service"). */
  function checkRequest(req) {
    if (!allowedHosts.has(req.headers.host || '')) return 'bad host'; // DNS-rebinding guard
    const origin = req.headers.origin;
    if (origin && !selfOrigins.has(origin)) return 'origin not allowed'; // only the dashboard itself, or non-browser clients
    return null;
  }

  return createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      const isStr = typeof body === 'string' || Buffer.isBuffer(body);
      res.writeHead(code, {
        'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        ...headers,
      });
      res.end(isStr ? body : JSON.stringify(body));
    };

    const denied = checkRequest(req);
    if (denied) return send(403, denied);

    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/setup') return send(200, setupInfo());
      if (req.method === 'POST' && url.pathname === '/api/setup') {
        updateSetup(config, await readJson(req));
        return send(200, setupInfo());
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        // Stale = missed ~2 scheduled refreshes (at least 30 min).
        const staleAfterMs = Math.max(30, (config.headless?.intervalMin || 15) * 2.5) * 6e4;
        const headless = config.headless?.enabled
          ? { ...((await lastHeadlessRun(config)) || {}), nextAt: schedule?.nextAt ?? null, intervalMin: config.headless.intervalMin }
          : null;
        const raw = buildStatus(db, new Date(), { staleAfterMs });
        raw.providers = raw.providers.filter((p) => providerEnabled(config, p.id));
        if (headless?.results) headless.results = Object.fromEntries(Object.entries(headless.results).filter(([id]) => providerEnabled(config, id)));
        const status = withPresentation(raw, headless, new Set(Object.keys(LOGIN_URLS).filter((id) => providerEnabled(config, id))));
        return send(200, { ...status, headless, setup: setupInfo() });
      }
      if (req.method === 'POST' && url.pathname === '/api/refresh') {
        if (!refresh) return send(404, 'headless refresh disabled');
        await readJson(req); // enforces JSON content-type (forces a CORS preflight for cross-site callers)
        const run = await refresh();
        return send(run ? 200 : 500, run || { error: 'refresh failed' });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        // Opens a visible login window for one provider; refreshes that provider once it's closed.
        const body = await readJson(req);
        const provider = typeof body?.provider === 'string' && Object.hasOwn(LOGIN_URLS, body.provider) ? body.provider : null;
        if (!provider) return send(400, 'unknown provider');
        if (!providerEnabled(config, provider)) return send(409, { ok: false, reason: 'Choose this service in Service setup before signing in.' });
        const r = await openLoginWindow(config, [provider], () => refresh?.([provider])?.catch(() => {})); // refresh logs failures; keep the login-exit callback from rejecting unhandled
        return send(r.ok ? 200 : 409, r);
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname, send);
      return send(404, 'not found');
    } catch (e) {
      return send(e.status || 500, e.expose ? e.message : 'internal error');
    }
  });
}

async function serveStatic(pathname, send) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(404, 'not found');
  try {
    const body = await readFile(file);
    return send(200, body, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    });
  } catch { return send(404, 'not found'); }
}

function readJson(req) {
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    return Promise.reject(Object.assign(new Error('content-type must be application/json'), { status: 415, expose: true }));
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413, expose: true })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400, expose: true })); }
    });
    req.on('error', reject);
  });
}
