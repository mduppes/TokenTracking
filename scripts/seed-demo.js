// Seeds a throwaway database with fake readings so the dashboard can be previewed.
// Usage: npm run demo   → then: TOKENTRACKING_HOME=.tokentracking-demo npm start
import { rmSync } from 'node:fs';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';

const home = '.tokentracking-demo';
rmSync(home, { recursive: true, force: true });
const config = loadConfig({ TOKENTRACKING_HOME: home });
const db = openDb(config.dbPath);
const now = Date.now();
const H = 36e5;

const meters = [
  { provider: 'claude', id: 'five-hour', label: 'Current session (5h)', window: 'session', resetIn: 2.2 * H, end: 61, plan: 'claude_max' },
  { provider: 'claude', id: 'seven-day', label: 'Weekly · all models', window: 'weekly', resetIn: 52 * H, end: 78 },
  { provider: 'claude', id: 'seven-day-opus', label: 'Weekly · Opus', window: 'weekly', resetIn: 52 * H, end: 92 },
  { provider: 'cursor', id: 'auto', label: 'Cursor models', window: 'monthly', resetIn: 9 * 24 * H, end: 64 },
  { provider: 'gemini', id: 'daily', label: 'Pro model daily limit', window: 'daily', resetIn: 7 * H, end: 35, staleBy: 3 * H }, // shows the stale notice
  { provider: 'cursor', id: 'grok-bot', label: 'Grok Bot', window: 'weekly', resetIn: 100 * H, end: 18 },
  { provider: 'muse', id: 'weekly-tokens', label: 'Weekly tokens', window: 'weekly', resetIn: 30 * H, end: 100 },
];
const WIN_H = { session: 5, daily: 24, weekly: 168, monthly: 730 };

for (const m of meters) {
  const resetsAt = new Date(now + m.resetIn).toISOString();
  const start = now + m.resetIn - WIN_H[m.window] * H;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((now - (m.staleBy || 0) - start) * i) / steps;
    const pct = Math.min(100, m.end * (i / steps) ** 1.2 + (i ? Math.sin(i) * 1.5 : 0));
    db.addSnapshot(m.provider, { capturedAt: new Date(t).toISOString(), source: 'demo', plan: m.plan || null },
      { id: m.id, label: m.label, window: m.window, usedPercent: Math.max(0, Math.round(pct * 10) / 10), used: null, limit: null, unit: null, resetsAt, resetText: null });
  }
}
db.close();
console.log(`Demo data written to ${config.dbPath}\nRun: TOKENTRACKING_HOME=${home} npm start`);
