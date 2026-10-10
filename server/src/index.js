import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './server.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const server = createApp({ db, config });

server.listen(config.port, config.host, () => {
  console.log(`TokenTracking service: http://${config.host}:${config.port}`);
  console.log(`Data: ${config.dbPath}`);
});

const shutdown = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
