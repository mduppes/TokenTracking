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

const SCHEMA_VERSION = 4;

function migrate(db) {
  const version = Number(db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get()?.value || 1);
  if (version >= SCHEMA_VERSION) return;
  db.exec('BEGIN');
  try {
    if (version < 2) {
      // v2: Antigravity meters became one per model brand (lib/providers.js). The old grouped pool ids
      // would otherwise linger as stale meters for a week; fold them into the stable Claude id so its
      // history stays continuous ("pool-gemini" kept its id).
      db.exec(`UPDATE snapshots SET meter_id = 'pool-claude', label = 'Claude models'
        WHERE provider = 'antigravity' AND meter_id IN ('pool-claude-gpt-oss', 'pool-claude-gpt-oss-gemini')`);
    }
    if (version < 3) {
      // v3: Antigravity now mirrors its own Settings: "Claude and GPT models" + "Gemini models". Claude's
      // history carries over; the GPT-OSS rows only ever duplicated Claude's numbers, so they go.
      db.exec(`UPDATE snapshots SET meter_id = 'pool-claude-gpt', label = 'Claude and GPT models'
        WHERE provider = 'antigravity' AND meter_id = 'pool-claude'`);
      db.exec(`DELETE FROM snapshots WHERE provider = 'antigravity' AND meter_id = 'pool-gpt-oss'`);
    }
    if (version < 4) {
      // v4: Before Gemini 4 Argon got its own meter (pool-gemini-argon), its snapshots were grouped
      // into pool-gemini whenever Argon had lower remaining tokens than Flash. Reassign those weekly
      // Argon snapshots to pool-gemini-argon.
      db.exec(`UPDATE snapshots SET meter_id = 'pool-gemini-argon', label = 'Gemini 4 Argon', window = 'weekly'
        WHERE provider = 'antigravity' AND meter_id = 'pool-gemini' AND resets_at LIKE '2026-10-23T12:%'`);
    }
    db.prepare(`UPDATE meta SET value = ? WHERE key = 'schema_version'`).run(String(SCHEMA_VERSION));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function openDb(path) {
  const fresh = path !== ':memory:' && !existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  if (fresh) try { chmodSync(path, 0o600); } catch { /* best effort */ }
  migrate(db);

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
