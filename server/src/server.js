import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatus } from './status.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 512 * 1024;
const MAX_DEBUG_FILES = 50;
const WINDOWS = new Set(['session', 'daily', 'weekly', 'monthly', 'other']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function createApp({ db, config }) {
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const selfOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  /** Security gate: see docs/SECURITY.md ("Local service"). */
  function checkRequest(req) {
    if (!allowedHosts.has(req.headers.host || '')) return 'bad host'; // DNS-rebinding guard
    const origin = req.headers.origin;
    if (!origin || selfOrigins.has(origin)) return null;
    const m = origin.match(/^chrome-extension:\/\/([a-p]{32})$/);
    if (!m) return 'origin not allowed';
    if (config.allowedExtensionIds.length && !config.allowedExtensionIds.includes(m[1])) return 'extension not allowed';
    return null;
  }

  return createServer(async (req, res) => {
    const send = (code, body, headers = {}) => {
      const isStr = typeof body === 'string' || Buffer.isBuffer(body);
      res.writeHead(code, {
        'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        ...(req.headers.origin?.startsWith('chrome-extension://') ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {}),
        ...headers,
      });
      res.end(isStr ? body : JSON.stringify(body));
    };

    const denied = checkRequest(req);
    if (denied) return send(403, denied);

    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'OPTIONS') {
        return send(204, '', { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, buildStatus(db));
      if (req.method === 'POST' && url.pathname === '/api/ingest') {
        const body = await readJson(req);
        const snaps = Array.isArray(body?.snapshots) ? body.snapshots : body ? [body] : [];
        let inserted = 0, rejected = 0;
        const receivedAt = new Date().toISOString();
        for (const raw of snaps.slice(0, 1000)) {
          const snap = validateSnapshot(raw);
          if (!snap) { rejected++; continue; }
          for (const m of snap.meters) if (db.addSnapshot(snap.provider, snap, m, receivedAt)) inserted++;
        }
        return send(200, { inserted, rejected });
      }
      if (req.method === 'POST' && url.pathname === '/api/debug') {
        const body = await readJson(req);
        const provider = safeId(body?.provider) || 'unknown';
        await mkdir(config.debugDir, { recursive: true, mode: 0o700 });
        const file = join(config.debugDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${provider}-${safeId(body?.kind) || 'x'}.json`);
        await writeFile(file, JSON.stringify(body, null, 2), { mode: 0o600 });
        await pruneDebug(config.debugDir);
        return send(200, { saved: true });
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname, send);
      return send(404, 'not found');
    } catch (e) {
      return send(e.status || 500, e.expose ? e.message : 'internal error');
    }
  });
}

export function validateSnapshot(s) {
  if (!s || typeof s !== 'object') return null;
  const provider = safeId(s.provider);
  if (!provider || !Array.isArray(s.meters)) return null;
  const capturedAt = isoOrNull(s.capturedAt) || new Date().toISOString();
  if (Date.parse(capturedAt) > Date.now() + 5 * 6e4) return null;
  const meters = s.meters.slice(0, 50).map((m) => {
    if (!m || typeof m !== 'object') return null;
    const id = safeId(m.id, 64);
    if (!id) return null;
    return {
      id,
      label: str(m.label, 80) || id,
      window: WINDOWS.has(m.window) ? m.window : 'other',
      usedPercent: num(m.usedPercent, 0, 1000),
      used: num(m.used), limit: num(m.limit), unit: str(m.unit, 20),
      resetsAt: isoOrNull(m.resetsAt), resetText: str(m.resetText, 120),
    };
  }).filter(Boolean);
  if (!meters.length) return null;
  return { provider, capturedAt, source: str(s.source, 120), plan: str(s.plan, 60), meters };
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

async function pruneDebug(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - MAX_DEBUG_FILES))) await unlink(join(dir, f)).catch(() => {});
}

const safeId = (v, max = 32) => (typeof v === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(v) && v.length <= max ? v.toLowerCase() : null);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const isoOrNull = (v) => (typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
