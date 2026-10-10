import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './server.js';
import { runHeadlessRefresh } from './headless/refresh.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const log = (l) => console.log(`[headless ${new Date().toLocaleTimeString()}] ${l}`);
const refresh = () => runHeadlessRefresh({ db, config, log }).catch((e) => log(`failed: ${e.message}`));
const server = createApp({ db, config, refresh });

// Headless refresh: Chrome only runs during a refresh, then quits (ADR-009).
let timer = null;
if (config.headless.enabled) {
  setTimeout(refresh, 10_000);
  timer = setInterval(refresh, config.headless.intervalMin * 6e4);
}

server.listen(config.port, config.host, () => {
  console.log(`TokenTracking service: http://${config.host}:${config.port}`);
  console.log(`Data: ${config.dbPath}`);
  console.log(config.headless.enabled ? `Headless refresh every ${config.headless.intervalMin} min` : 'Headless refresh off (TOKENTRACKING_HEADLESS=0)');
});

const shutdown = () => { clearInterval(timer); server.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
