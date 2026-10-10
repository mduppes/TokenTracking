// Antigravity has no web usage page; its quota lives in the desktop app. While the app runs, its local
// language server (127.0.0.1, self-signed HTTPS) answers GetUserStatus. Requests need the server's CSRF
// token, which we read from the process arguments at call time. It's used for that one localhost request
// only: never logged, stored or sent anywhere else. Documented exception to the no-secrets rule: ADR-011.
import { execFile } from 'node:child_process';
import { request } from 'node:https';
import { promisify } from 'node:util';
import { parseAntigravityStatus } from '../../../lib/providers.js';

const run = promisify(execFile);
const METHOD = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

/** Find the running Antigravity language server: pid + CSRF token. Null if Antigravity isn't running. */
async function findServer() {
  const { stdout } = await run('ps', ['-axo', 'pid=,args=']);
  for (const line of stdout.split('\n')) {
    if (!/Antigravity[^/]*\.app\/.*\/language_server\b/.test(line)) continue;
    const token = line.match(/--csrf_token\s+(\S+)/)?.[1];
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (token && pid) return { pid, token };
  }
  return null;
}

async function listenPorts(pid) {
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)]);
    return [...stdout.matchAll(/127\.0\.0\.1:(\d+) \(LISTEN\)/g)].map((m) => Number(m[1]));
  } catch { return []; }
}

function getUserStatus(port, token) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, method: 'POST', path: METHOD, timeout: 4000,
      rejectUnauthorized: false, // the app's own self-signed localhost certificate
      headers: { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': token },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`HTTP ${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } }));
  });
}

/** @returns {Promise<{status:'ok', meters, plan} | {status:'skipped'|'error', message}>} */
export async function readAntigravity() {
  const server = await findServer();
  if (!server) return { status: 'skipped', message: "Antigravity isn't running" };
  let lastError = 'no listening port';
  for (const port of await listenPorts(server.pid)) {
    try {
      const { meters, plan } = parseAntigravityStatus(await getUserStatus(port, server.token));
      if (meters.length) return { status: 'ok', meters, plan };
      lastError = 'no quota info in the response';
    } catch (e) { lastError = e.message; }
  }
  return { status: 'error', message: lastError };
}
