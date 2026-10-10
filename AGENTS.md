# AGENTS.md: orientation for AI agents and new contributors

Read this first, then `docs/ARCHITECTURE.md`. The current state and next steps live in `docs/ROADMAP.md` and `CHANGELOG.md` → `[Unreleased]`.

## What this is
This is a personal, local-first tracker for AI **subscription** usage limits: Claude, Cursor (including Grok Bot), Gemini app and Muse, with Antigravity planned. A zero-dependency Node service on 127.0.0.1:7878 refreshes usage with a short-lived headless Chrome (dedicated, logged-in profile), stores snapshots in SQLite, computes pacing and serves a dashboard. An optional Chrome extension can also capture usage from your normal browser.

## Current direction (2026-10-10)
Headless refresh in the local service (ADR-009) is the primary data path, on the `headless-refresh` branch until it has proven itself. The extension is optional and may be removed. Next up: a macOS menu bar app (ROADMAP).

## Hard constraints (don't violate without a new ADR and the user's sign-off)
- **No secrets.** Don't read cookies, the Keychain or CLI token files, and don't ask for API keys (ADR-002, SECURITY.md). The headless profile's logins stay inside Chrome; our code never reads them.
- **Nothing leaves the machine.** No telemetry, no third-party requests and no CDNs in the dashboard.
- **Zero dependencies and no build step** (ADR-003). Use Node built-ins only, and keep the extension loadable unpacked.
- **Read-only** against provider sites.
- Never commit real captured payloads without redacting personal data (emails, names, org ids).

## Layout
```
extension/            Chrome MV3 extension (load unpacked)
  lib/providers.js    ← provider registry: start here to add or fix a provider
  lib/parse.js        ← pure parsing helpers (unit-tested)
  content/hook.js     MAIN-world fetch/XHR tap
  content/collector.js DOM scraper + relay
  background.js       service worker: normalize, cache, POST, refresh
server/src/           Node service (index, server, db, pacing, status, cli)
server/src/headless/  headless Chrome refresher (chrome.js = CDP over pipe, refresh.js = per-provider TASKS)
server/public/        dashboard (vanilla JS)
test/                 node:test suites
scripts/seed-demo.js  fake data for UI work
docs/                 ARCHITECTURE, PROVIDERS, SECURITY, DECISIONS, ROADMAP
```

## Commands
```bash
npm test                                     # must pass before you finish
npm start                                    # service on :7878 (~/.tokentracking)
npm run status                               # terminal view
npm run browser-login                        # log in once in the headless profile (visible window)
npm run refresh                              # one headless refresh now, prints per-service results
npm run demo && TOKENTRACKING_HOME=.tokentracking-demo TOKENTRACKING_PORT=7879 npm start   # UI work with fake data
```
`.claude/launch.json` has a `demo-dashboard` config (port 7879) for preview tools.

## Common tasks

**Fix or verify a provider.** Follow the "Verification loop" in `docs/PROVIDERS.md`:
1. Turn on debug capture.
2. Read `~/.tokentracking/debug/*.json`.
3. Write or adjust `parseJson`, `jsonPattern` or `usageUrl` in `providers.js`.
4. Add a redacted fixture test.
5. Update the status table in PROVIDERS.md.

**Add a provider.**
1. Add an entry to `PROVIDERS` in `extension/lib/providers.js`.
2. Add its hosts to **both** `host_permissions` and both `content_scripts[].matches` in `manifest.json`.
3. Add a display name to `PROVIDER_NAMES` in `server/src/status.js`.
4. Add a row to `docs/PROVIDERS.md` and tests.

**Change the wire format or DB.**
1. Update `validateSnapshot` (server), `makeMeter` (extension) and the "Data model" section of ARCHITECTURE.md.
2. For the DB, bump `meta.schema_version` and migrate in `openDb`.

**After loading changes in Chrome**, click reload on `chrome://extensions`. Content scripts only update on tabs opened after the reload.

## Conventions
- Plain ES modules, 2-space indent, single quotes, semicolons, small pure functions.
- Comments explain *why* and point to docs. Match the existing density.
- Pure logic goes in `extension/lib/` or `server/src/pacing.js` so it's testable in Node.
- Every behavior change gets a test where practical, a CHANGELOG `[Unreleased]` entry, and a docs update in the same change.
- Significant design choices get a new ADR in `docs/DECISIONS.md`.

## Handoff checklist (end of every session)
- [ ] `npm test` passes.
- [ ] CHANGELOG `[Unreleased]` describes what changed.
- [ ] ROADMAP checkboxes updated; new findings added.
- [ ] PROVIDERS.md status table reflects what was verified, and when.
- [ ] Anything half-done is written down in ROADMAP under "Next" with enough context to resume.
