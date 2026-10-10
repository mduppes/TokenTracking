// `npm run status` — print current usage + pacing in the terminal, straight from the database.
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { buildStatus } from './status.js';

const db = openDb(loadConfig().dbPath);
const status = buildStatus(db);
db.close();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}
if (!status.providers.length) {
  console.log('No data yet. Log in once with `npm run browser-login`, then run `npm run refresh` (or open the menu bar app).');
  process.exit(0);
}

const fmtDur = (ms) => {
  if (ms == null) return '—';
  const m = Math.round(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m % 60}m`;
};
const bar = (p) => { const n = Math.round(Math.min(100, p ?? 0) / 5); return '█'.repeat(n) + '░'.repeat(20 - n); };
const PACE = { ok: 'on pace', ahead: 'ahead of pace', 'over-pace': 'will run out before reset', limited: 'LIMIT REACHED', unknown: '' };

for (const p of status.providers) {
  console.log(`\n${p.name}${p.plan ? ` (${p.plan})` : ''}`);
  for (const m of p.meters) {
    const pct = m.usedPercent == null ? '  ?' : `${Math.round(m.usedPercent)}`.padStart(3);
    const pace = m.pace;
    // budgetPerDay is only set when ≥24h remain; otherwise show the hourly budget.
    const budget = pace.budgetPerDay != null ? `${pace.budgetPerDay}%/day left` : pace.budgetPerHour != null && `${pace.budgetPerHour}%/h left`;
    console.log(`  ${m.label.padEnd(26).slice(0, 26)} ${bar(m.usedPercent)} ${pct}%  resets in ${fmtDur(pace.remainingMs).padEnd(7)} ${[PACE[pace.status], budget].filter(Boolean).join(' · ')}${m.stale ? '  (stale)' : ''}`);
  }
}
