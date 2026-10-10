import { homedir } from 'node:os';
import { join } from 'node:path';
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
    // Optional comma-separated list of extension ids allowed to talk to the service.
    // Empty = any chrome-extension:// origin (see docs/SECURITY.md).
    allowedExtensionIds: (env.TOKENTRACKING_EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
