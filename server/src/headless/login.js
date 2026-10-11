// Opens a normal, visible Chrome window on TokenTracking's dedicated profile so the user can (re)log in.
// Used by `npm run browser-login` and the dashboard's "Log in" buttons (POST /api/login).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { profileInUse } from './chrome.js';

/** Where to log in for each provider that uses the browser profile (Antigravity doesn't). */
export const LOGIN_URLS = {
  claude: 'https://claude.ai/login',
  cursor: 'https://cursor.com/dashboard/spending',
  gemini: 'https://gemini.google.com/usage',
  muse: 'https://muse.ai/',
};

/**
 * @param {{headless: {chromePath: string, profileDir: string}}} config
 * @param {string[]} providers  subset of LOGIN_URLS keys (empty = all)
 * @param {() => void} [onClose] called when the window's Chrome process exits (user quit it)
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function openLoginWindow(config, providers = [], onClose = null) {
  const { profileDir, chromePath } = config.headless;
  if (profileInUse(profileDir)) return { ok: false, reason: 'The TokenTracking browser is already open (a login window, or a refresh in progress). Try again in a moment.' };
  const urls = (providers.length ? providers : Object.keys(LOGIN_URLS)).map((p) => LOGIN_URLS[p]).filter(Boolean);
  if (!urls.length) return { ok: false, reason: 'unknown provider' };
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(chromePath, [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', ...urls],
    { detached: true, stdio: 'ignore' });
  child.on('exit', () => onClose?.());
  child.unref();
  return { ok: true };
}
