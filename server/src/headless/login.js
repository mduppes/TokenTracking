// Opens a normal, visible Chrome window on TokenTracking's dedicated profile so the user can (re)log in.
// Used by `npm run browser-login` and the dashboard's "Log in" buttons (POST /api/login).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromeProfileArgs, profileInUse } from './chrome.js';

/** Where to log in for each provider that uses the browser profile (Antigravity doesn't). */
export const LOGIN_URLS = {
  claude: 'https://claude.ai/login',
  cursor: 'https://cursor.com/dashboard/spending',
  gemini: 'https://gemini.google.com/usage',
  muse: 'https://muse.ai/',
  openai: 'https://chatgpt.com/settings/usage?tab=overview',
};

/**
 * @param {{headless: {chromePath: string, profileDir: string}}} config
 * @param {string[]} providers  subset of LOGIN_URLS keys (empty = all)
 * @param {() => void} [onClose] called when the window's Chrome process exits (user quit it)
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export async function openLoginWindow(config, providers = [], onClose = null) {
  const { profileDir, chromePath } = config.headless;
  if (profileInUse(profileDir)) return { ok: false, reason: 'The TokenTracking browser is already open (a login window, or a refresh in progress). Try again in a moment.' };
  const urls = (providers.length ? providers : Object.keys(LOGIN_URLS)).map((p) => LOGIN_URLS[p]).filter(Boolean);
  if (!urls.length) return { ok: false, reason: 'unknown provider' };
  if (!existsSync(chromePath)) return { ok: false, reason: 'Google Chrome was not found. Install Chrome, then try again.' };
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(chromePath, [...chromeProfileArgs(profileDir), ...urls],
    { detached: true, stdio: 'ignore' });
  // Spawn can fail even if Chrome exists (permissions, a moved install). Return an error instead of crashing the service.
  const started = await new Promise((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
    child.once('exit', () => onClose?.());
  });
  if (!started) return { ok: false, reason: 'Chrome could not start. Check that Chrome opens normally, then try again.' };
  child.unref();
  return { ok: true };
}
