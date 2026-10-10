// Opens a normal (visible) Chrome window using TokenTracking's dedicated profile so you can log in
// once to each service. Headless refreshes reuse these logins. Quit that Chrome window (Cmd+Q) when done.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { loadConfig } from '../server/src/config.js';
import { profileInUse } from '../server/src/headless/chrome.js';

const { headless } = loadConfig();
if (profileInUse(headless.profileDir)) {
  console.log('The TokenTracking browser profile is already open. Log in there, then quit it (Cmd+Q).');
  process.exit(0);
}
mkdirSync(headless.profileDir, { recursive: true, mode: 0o700 });
const urls = ['https://claude.ai/login', 'https://cursor.com/dashboard/spending', 'https://gemini.google.com/usage', 'https://muse.ai/'];
const only = process.argv.slice(2);
const child = spawn(headless.chromePath, [
  `--user-data-dir=${headless.profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
  ...(only.length ? urls.filter((u) => only.some((o) => u.includes(o))) : urls),
], { detached: true, stdio: 'ignore' });
child.unref();
console.log(`Opened a TokenTracking Chrome window (profile: ${headless.profileDir}).
1. Log in to each tab (Claude, Cursor, Google/Gemini, Muse).
2. Quit that Chrome window with Cmd+Q. Headless refresh can't run while it's open.
3. Test with: npm run refresh`);
