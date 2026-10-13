import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('menu bar preferences preserve order, visibility and safe defaults', { skip: process.platform !== 'darwin' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokentracking-menu-test-'));
  try {
    const main = join(dir, 'main.swift');
    writeFileSync(main, `import Foundation
let suite = "io.tokentracking.test.\\(UUID().uuidString)"
let store = UserDefaults(suiteName: suite)!
defer { store.removePersistentDomain(forName: suite) }
precondition(MenuBarPreferences.load(from: store) == .defaults)
var prefs = MenuBarPreferences.defaults
prefs.move("muse", to: "claude")
precondition(prefs.visibleIDs.first == "muse")
prefs.move("muse", to: "openai")
precondition(prefs.order[5] == "muse")
let before = prefs
prefs.move("unknown", to: "claude")
prefs.move("claude", to: "claude")
precondition(prefs == before)
prefs.meterIDs["claude"] = "weekly"
prefs.hidden.insert("cursor")
prefs.hidden.remove("gemini")
prefs.save(to: store)
precondition(MenuBarPreferences.load(from: store) == prefs)
precondition(MenuBarPreferences.load(from: store).meterIDs["claude"] == "weekly")
precondition(!prefs.visibleIDs.contains("cursor") && prefs.visibleIDs.contains("gemini"))
prefs.hidden = Set(MenuBarPreferences.serviceIDs)
prefs.save(to: store)
precondition(MenuBarPreferences.load(from: store).visibleIDs.isEmpty)
let legacy = MenuBarPreferences(order: ["muse", "muse", "removed", "claude"], hidden: ["removed", "claude"])
legacy.save(to: store)
let migrated = MenuBarPreferences.load(from: store)
precondition(migrated.order == ["muse", "claude", "cursor", "antigravity", "grok-bot", "openai", "gemini"])
precondition(migrated.visibleIDs == ["muse"])
store.set(Data(#"{"order":["claude","cursor","antigravity","grok-bot","openai","muse","gemini"],"hidden":["gemini"]}"#.utf8), forKey: MenuBarPreferences.storageKey)
precondition(MenuBarPreferences.load(from: store) == .defaults)
store.set(Data("broken".utf8), forKey: MenuBarPreferences.storageKey)
precondition(MenuBarPreferences.load(from: store) == .defaults)
MenuBarPreferences.defaults.save(to: store)
precondition(MenuBarPreferences.load(from: store) == .defaults)
print("Preferences passed")
`);
    const binary = join(dir, 'preferences-test');
    execFileSync('swiftc', ['-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-module-cache-path', join(dir, 'module-cache'), resolve('menubar/MenuBarPreferences.swift'), main, '-o', binary], { timeout: 120_000 });
    assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 10_000 }), /Preferences passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
