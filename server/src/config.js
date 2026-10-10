import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CHROME } from './headless/chrome.js';
import { mkdirSync, chmodSync } from 'node:fs';

export function loadConfig(env = process.env) {
  const home = env.TOKENTRACKING_HOME || join(homedir(), '.tokentracking');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  try { chmodSync(home, 0o700); } catch { /* best effort */ }
  return {
    home,
    dbPath: join(home, 'tokentracking.db'),
    debugDir: join(home, 'debug'),
    host: '127.0.0.1',
    port: Number(env.TOKENTRACKING_PORT || 7878),
    // Headless refresh (ADR-009): starts Chrome only while refreshing, with its own profile.
    headless: {
      enabled: env.TOKENTRACKING_HEADLESS !== '0',
      intervalMin: Math.max(5, Number(env.TOKENTRACKING_INTERVAL_MIN || 15)),
      chromePath: env.TOKENTRACKING_CHROME || DEFAULT_CHROME,
      profileDir: join(home, 'browser-profile'),
      statusPath: join(home, 'headless-status.json'),
      // Comma-separated provider ids to leave to the extension instead (e.g. "claude,cursor").
      disabled: (env.TOKENTRACKING_HEADLESS_SKIP || '').split(',').map((s) => s.trim()).filter(Boolean),
    },
    // Optional comma-separated list of extension ids allowed to talk to the service.
    // Empty = any chrome-extension:// origin (see docs/SECURITY.md).
    allowedExtensionIds: (env.TOKENTRACKING_EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
