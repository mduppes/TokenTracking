import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './server.js';
import { runHeadlessRefresh } from './headless/refresh.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const log = (l) => console.log(`[headless ${new Date().toLocaleTimeString()}] ${l}`);
const refresh = (only = null) => runHeadlessRefresh({ db, config, log, only }).catch((e) => log(`failed: ${e.message}`));
// Headless refresh: Chrome only runs during a refresh, then quits (ADR-009).
// `schedule.nextAt` is shown on the dashboard ("next refresh in …").
const schedule = { nextAt: null };
let timer = null;
const tick = async () => {
  schedule.nextAt = null;
  await refresh(null);
  schedule.nextAt = new Date(Date.now() + config.headless.intervalMin * 6e4).toISOString();
  timer = setTimeout(tick, config.headless.intervalMin * 6e4);
};
if (config.headless.enabled) {
  schedule.nextAt = new Date(Date.now() + 10_000).toISOString();
  timer = setTimeout(tick, 10_000);
}
const server = createApp({ db, config, refresh, schedule });

server.listen(config.port, config.host, () => {
  console.log(`TokenTracking service: http://${config.host}:${config.port}`);
  console.log(`Data: ${config.dbPath}`);
  console.log(config.headless.enabled ? `Headless refresh every ${config.headless.intervalMin} min` : 'Headless refresh off (TOKENTRACKING_HEADLESS=0)');
});

const shutdown = () => { clearTimeout(timer); server.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Started by the menu bar app: exit when the app goes away, even if it was force-killed and
// couldn't stop us (TOKENTRACKING_PARENT_PID is set by the app).
const parentPid = Number(process.env.TOKENTRACKING_PARENT_PID);
if (parentPid) {
  setInterval(() => {
    try { process.kill(parentPid, 0); } catch { console.log('Menu bar app is gone; stopping.'); shutdown(); }
  }, 3000).unref();
}
