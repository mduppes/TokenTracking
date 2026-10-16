import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/src/db.js';

test('schema migrations fold old Antigravity meter ids into the fixed groups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-db-'));
  const path = join(dir, 'tokentracking.db');
  try {
    openDb(path).close(); // current database...
    const raw = new DatabaseSync(path);
    raw.exec(`UPDATE meta SET value = '1' WHERE key = 'schema_version'`); // ...rolled back to look like v1
    const add = raw.prepare(`INSERT INTO snapshots (provider, meter_id, label, window, used_percent, resets_at, captured_at, received_at)
      VALUES ('antigravity', ?, ?, 'session', ?, ?, ?, ?)`);
    add.run('pool-claude-gpt-oss', 'Claude + GPT-OSS models', 100, null, '2026-10-15T17:33:02Z', '2026-10-15T17:33:02Z');
    add.run('pool-claude-gpt-oss-gemini', 'Claude + GPT-OSS + Gemini models', 0, null, '2026-10-15T17:48:27Z', '2026-10-15T17:48:27Z');
    add.run('pool-gemini', 'Gemini models', 0, '2026-10-16T17:33:02Z', '2026-10-15T17:33:02Z', '2026-10-15T17:33:02Z');
    add.run('pool-gemini', 'Gemini models', 80, '2026-10-23T12:35:35Z', '2026-10-16T14:00:00Z', '2026-10-16T14:00:00Z'); // v3-era misattributed Argon row
    add.run('pool-gpt-oss', 'GPT-OSS models', 0, null, '2026-10-15T17:48:27Z', '2026-10-15T17:48:27Z'); // a v2-era row
    raw.close();

    const db = openDb(path);
    assert.deepEqual(db.latest('2026-01-01').map((r) => [r.meter_id, r.label, r.used_percent]), [
      ['pool-claude-gpt', 'Claude and GPT models', 0],
      ['pool-gemini', 'Gemini models', 0],
      ['pool-gemini-argon', 'Gemini 4 Argon', 80],
    ]);
    assert.equal(db.history('antigravity', 'pool-claude-gpt', '2026-01-01').length, 2);
    assert.equal(db.history('antigravity', 'pool-gemini-argon', '2026-01-01').length, 1);
    assert.equal(db.raw.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get().value, '4');
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
