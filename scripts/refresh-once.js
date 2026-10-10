// Run one headless refresh now and print per-provider results. Usage: npm run refresh [-- claude gemini]
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { runHeadlessRefresh } from '../server/src/headless/refresh.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const only = process.argv.slice(2);
const t0 = Date.now();
const run = await runHeadlessRefresh({ db, config, only: only.length ? only : null, log: (l) => console.log(`  ${l}`) });
db.close();
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
if (Object.values(run.results).some((r) => r.status === 'login')) console.log('Some services need a login: npm run browser-login');
