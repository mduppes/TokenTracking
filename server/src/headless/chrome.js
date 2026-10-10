// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe (no WebSocket, no open port,
// no dependencies). Launches the user's installed Google Chrome headless with a dedicated profile.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Chrome leaves a SingletonLock symlink ("host-pid") while a profile is open. */
export function profileInUse(profileDir) {
  const lock = join(profileDir, 'SingletonLock');
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false;
    const pid = Number(readlinkSync(lock).split('-').pop());
    if (!pid) return false;
    process.kill(pid, 0); // throws if the process is gone
    return true;
  } catch { return false; }
}

/**
 * Launch Chrome and return a CDP connection.
 * @param {{chromePath:string, profileDir:string, headless?:boolean, extraArgs?:string[]}} opts
 */
export async function launchChrome({ chromePath, profileDir, headless = true, extraArgs = [] }) {
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath} (set TOKENTRACKING_CHROME)`);
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-blink-features=AutomationControlled',
    '--mute-audio',
    '--window-size=1512,945',
    '--lang=en-US',
    ...(headless ? ['--headless=new', '--hide-scrollbars'] : []),
    ...extraArgs,
    'about:blank',
  ];
  // fd 3: we write commands to Chrome; fd 4: Chrome writes responses/events to us.
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const conn = new CdpConnection(child.stdio[3], child.stdio[4]);
  child.on('exit', (code) => conn.closeAll(new Error(`Chrome exited (${code}) ${stderr.split('\n').slice(-3).join(' ')}`)));
  conn.process = child;
  await conn.send('Browser.getVersion'); // waits until Chrome is ready
  return conn;
}

class CdpConnection {
  constructor(writable, readable) {
    this.out = writable;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    let buf = '';
    readable.setEncoding('utf8');
    readable.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(raw); } catch { continue; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
        } else if (msg.method) {
          for (const l of this.listeners) l(msg);
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.out.write(payload + '\0');
    });
  }

  /** Resolve with the first event matching method (+ sessionId), or reject after ms. */
  waitFor(method, sessionId, ms = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(l); reject(new Error(`timeout waiting for ${method}`)); }, ms);
      const l = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(timer); this.listeners.delete(l); resolve(msg.params);
        }
      };
      this.listeners.add(l);
    });
  }

  closeAll(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  /** Ask Chrome to quit; kill it if it lingers. */
  async close() {
    const proc = this.process;
    if (!proc || proc.exitCode !== null) return;
    const exited = new Promise((r) => proc.once('exit', r));
    this.send('Browser.close').catch(() => {});
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
}

/**
 * Present as the user's normal desktop Chrome rather than headless Chrome: same version, no
 * "HeadlessChrome" in the User-Agent or Client Hints (Sec-CH-UA*, navigator.userAgentData),
 * navigator.webdriver false, real languages and a laptop-sized screen. This keeps a personal,
 * low-frequency read of the user's own usage pages from tripping bot checks (see ADR-009).
 */
export async function browserIdentity(conn, { languages = ['en-US', 'en'], osVersion = '15.0.0' } = {}) {
  const { product, userAgent } = await conn.send('Browser.getVersion'); // "HeadlessChrome/154.0.8037.98"
  const full = product.split('/')[1];
  const major = full.split('.')[0];
  const brands = [{ brand: 'Google Chrome', version: major }, { brand: 'Chromium', version: major }, { brand: 'Not.A/Brand', version: '99' }];
  return {
    userAgent: userAgent.replace('HeadlessChrome', 'Chrome'),
    acceptLanguage: languages.join(','), // Chrome adds the q-weights itself
    platform: 'MacIntel',
    userAgentMetadata: {
      brands,
      fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.version === '99' ? '99.0.0.0' : full })),
      fullVersion: full,
      platform: 'macOS',
      platformVersion: osVersion,
      architecture: process.arch === 'arm64' ? 'arm' : 'x86',
      bitness: '64',
      model: '',
      mobile: false,
      wow64: false,
    },
  };
}

// Runs before any page script. Only patches what headless actually exposes differently.
const STEALTH_SCRIPT = `(() => {
  try { if (navigator.webdriver) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); } catch {}
  try { if (screen.width < 1000) { Object.defineProperty(screen, 'width', { get: () => 1512 }); Object.defineProperty(screen, 'height', { get: () => 982 });
    Object.defineProperty(screen, 'availWidth', { get: () => 1512 }); Object.defineProperty(screen, 'availHeight', { get: () => 945 }); } } catch {}
})();`;

/** Open a new page target and return helpers bound to its session. */
export async function openPage(conn, { identity = null } = {}) {
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => conn.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  if (identity) {
    await send('Emulation.setUserAgentOverride', identity);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STEALTH_SCRIPT });
  }

  return {
    async goto(url, ms = 30_000) {
      const loaded = conn.waitFor('Page.loadEventFired', sessionId, ms);
      await send('Page.navigate', { url });
      await loaded;
    },
    /** Evaluate an expression (may return a promise); returns the JSON value. */
    async evaluate(expression, ms = 30_000) {
      const r = await Promise.race([
        send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), ms)),
      ]);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    /** PNG screenshot as a Buffer (debugging). */
    async screenshot() { return Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'); },
    close: () => conn.send('Target.closeTarget', { targetId }).catch(() => {}),
  };
}
