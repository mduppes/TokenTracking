// Opens a normal (visible) Chrome window using TokenTracking's dedicated profile so you can log in
// to each service. Headless refreshes reuse these logins. Quit that Chrome window (Cmd+Q) when done.
// Usage: npm run browser-login [-- muse gemini openai]   (the dashboard's "Log in" buttons do the same)
import { loadConfig } from '../server/src/config.js';
import { openLoginWindow } from '../server/src/headless/login.js';

const r = openLoginWindow(loadConfig(), process.argv.slice(2));
if (!r.ok) { console.log(r.reason); process.exit(1); }
console.log(`Opened a TokenTracking Chrome window.
1. Log in on each tab.
2. Quit that Chrome window with Cmd+Q. Headless refresh can't run while it's open.
3. Test with: npm run refresh`);
