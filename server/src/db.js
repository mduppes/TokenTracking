import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,
  meter_id      TEXT NOT NULL,
  label         TEXT NOT NULL,
  window        TEXT NOT NULL,
  used_percent  REAL,
  used          REAL,
  limit_value   REAL,
  unit          TEXT,
  resets_at     TEXT,
  reset_text    TEXT,
  plan          TEXT,
  source        TEXT,
  captured_at   TEXT NOT NULL,
  received_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_meter ON snapshots (provider, meter_id, captured_at);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
`;

export function openDb(path) {
  const fresh = path !== ':memory:' && !existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  if (fresh) try { chmodSync(path, 0o600); } catch { /* best effort */ }

  const insert = db.prepare(`INSERT INTO snapshots
    (provider, meter_id, label, window, used_percent, used, limit_value, unit, resets_at, reset_text, plan, source, captured_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const lastFor = db.prepare(`SELECT * FROM snapshots WHERE provider = ? AND meter_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`);
  const latestAll = db.prepare(`SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY provider, meter_id ORDER BY captured_at DESC, id DESC) AS rn FROM snapshots
    ) WHERE rn = 1 AND captured_at >= ? ORDER BY provider, meter_id`);
  const historyFor = db.prepare(`SELECT used_percent, resets_at, captured_at FROM snapshots
    WHERE provider = ? AND meter_id = ? AND captured_at >= ? ORDER BY captured_at`);

  return {
    raw: db,
    /** Insert a meter snapshot unless it's an identical repeat of the last one within 2 minutes. */
    addSnapshot(provider, snap, m, receivedAt = new Date().toISOString()) {
      const prev = lastFor.get(provider, m.id);
      if (prev && prev.used_percent === m.usedPercent && prev.resets_at === m.resetsAt
        && Math.abs(Date.parse(snap.capturedAt) - Date.parse(prev.captured_at)) < 120_000) return false;
      insert.run(provider, m.id, m.label, m.window, m.usedPercent, m.used, m.limit, m.unit, m.resetsAt, m.resetText,
        snap.plan, snap.source, snap.capturedAt, receivedAt);
      return true;
    },
    latest(sinceIso) { return latestAll.all(sinceIso); },
    history(provider, meterId, sinceIso) { return historyFor.all(provider, meterId, sinceIso); },
    close() { db.close(); },
  };
}
