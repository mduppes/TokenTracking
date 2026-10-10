# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions: [SemVer](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-10-10
### Removed
- **The Chrome extension** (ADR-010), along with its hidden-refresh header stripping (ADR-008), the Cursor Origin rule, `/api/ingest`, `/api/debug`, the `chrome-extension://` Origin allowance and `TOKENTRACKING_EXTENSION_IDS`.
### Fixed
- Pacing no longer says "will run out" from a short burst right after a reset: the observed slope needs a span of ≥5% of the window, and over-pace needs ≥5% used.
### Changed
- Shared code moved to `lib/` (`parse.js`, `providers.js` = parsers + `MUSE_OPEN_STEPS`, `scrape-dom.js`).
- The local service accepts browser requests only from its own dashboard origin.
- Menu bar: hovering the icon shows which meter the % refers to ("Most at risk: Muse · Free plan: 97% used (will run out before reset)").
### Added
- **macOS menu bar app** (`menubar/`, `npm run build:menubar`): the most at-risk meter in the menu bar, plus a compact dashboard panel with Refresh now / Open dashboard / Quit. No Dock icon.
- The service exits when the menu bar app that started it dies (`TOKENTRACKING_PARENT_PID`), including on force quit.
- Headless refresh verified end to end for all four services (Claude, Cursor + Grok Bot, Gemini, Muse).
- Menu bar app uses `NSStatusItem` + popover. If the menu bar is full (the icon can't be shown), it falls back to a Dock icon and a panel window.
- The menu bar app starts the local service itself (and restarts or stops it), so it's the only thing to run. Logs: `~/.tokentracking/service.log`.
- Dashboard compact mode (`/?compact`). Login notices are merged into one line.
### Fixed
- Muse headless: the Settings menu needs a real pointer press (`press()` in `scrape-dom.js`), and its item text includes a shortcut (match on the first line).
- `build:menubar` updates the app bundle in place, so Login Items keep working across rebuilds.
- Sparklines didn't span the full width when the chart was shorter than 36 px.
- The demo server (`.claude/launch.json`) no longer runs headless refresh.
- **Headless refresh** (ADR-009): the local service starts Chrome headless with a dedicated profile only while refreshing (every 15 min, or via **Refresh now** / `npm run refresh`), reads Claude, Cursor + Grok Bot, Gemini and Muse from inside their own sites, then quits Chrome.
  - Zero-dependency CDP client over `--remote-debugging-pipe`.
  - Presents as normal Chrome: User-Agent, Client Hints, `navigator.webdriver`, languages, screen.
  - Logged-out detection per service.
- `npm run browser-login`, `npm run refresh`; dashboard **Refresh now** button and "needs a login" notices; `POST /api/refresh`; `headless` field in `/api/status`.
- `extension/lib/scrape-dom.js`: the page reader shared by the extension and headless refresh; `normalizeDomMeters()` in `parse.js`.
- Real-Chrome tests (`test/headless.test.js`) with Gemini- and Muse-shaped fixtures.
### Fixed
- Grok Bot direct fetch returned HTTP 403: Cursor rejects `Origin: chrome-extension://…`. A session DNR rule now sets `Origin`/`Referer` to cursor.com on the extension's own request to `get-sand-usage-status` only (`FIRST_PARTY_HEADER_RULES`, scoped to requests outside any tab).
- Hidden refresh doesn't work for Cursor: the framed spending page loads but makes no usage calls (likely no session cookie in an embedded page).
- Background refresh never finished ("Last refresh: never"): Chrome stopped the service worker after ~30 s idle while it waited for a page. It's now kept alive during a refresh, and results are saved after each provider (`lastRefresh.done` marks a complete run).

## [0.4.0] - 2026-10-10
### Added
- **Hidden background refresh** (default): usage pages load in an invisible offscreen document instead of a minimized window, so Chrome doesn't flicker. A session DNR rule removes X-Frame-Options and CSP only for no-tab sub-frames on provider hosts (ADR-008, SECURITY.md).
- Options → "Load pages": hidden or in a minimized window.
- Refresh results tell "page script never ran" apart from "page loaded but no usage found".
### Changed
- Content scripts run in all frames (needed inside the offscreen iframe).
- Permissions: `offscreen`, `declarativeNetRequestWithHostAccess`.
### Fixed
- Grok Bot meter missing: the extension's direct `POST get-sand-usage-status` gets no data (most likely Cursor rejects the extension's Origin). `directFetch` can now return `incomplete`. Background refresh then also opens the usage page (Cursor: `/dashboard/spending`) and captures the page's own call. The reason is shown in Options → last refresh results.

## [0.3.0] - 2026-10-10
### Added
- **Grok Bot** weekly meter, read from Cursor's `POST /api/dashboard/get-sand-usage-status`. Grok Bot turned out to be a Cursor product with its own weekly limit.
- Provider flag `noDom`; Claude and Cursor use it to avoid duplicate DOM meters.
### Changed
- Cursor meters renamed to match the dashboard: Included total, Cursor models, Other models. Default usage URL is now `/dashboard/spending`.
### Removed
- The standalone `grok` provider and its grok.com / x.ai host permissions.
- Cursor: dedicated `parseCursorUsage` for `/api/usage-summary` (total / Auto / named-model %, on-demand $, billing-cycle reset) and `directFetch`, so no tab is needed.
### Fixed
- Cursor showed a bogus "Plan 100%" meter: the generic extractor read `plan.used/limit`, which covers only the included-dollar slice.

## [0.2.0] - 2026-10-10
### Changed
- DOM scraper rewritten around **"NN% used" text** and **valued ARIA progress bars**, with the label taken from the nearest line and icon ligatures filtered out. Fixes Gemini, whose bars carry no ARIA value or %-width. The old %-width bar heuristic was removed.
- The collector keeps observing for the life of the page and scrapes whenever a valued progress bar appears (e.g. a settings dialog), not just for 90 s after load.
- Muse: default usage URL `https://muse.ai/`; background refresh opens Settings via `openSteps`; dropped the meta.ai hosts.
- Grok: disabled by default (`defaultEnabled: false`) because there's no web usage view.
### Added
- Provider fields `openSteps` and `defaultEnabled`.
- Background-refresh tabs are tracked so `openSteps` never run in your own tabs.

## [0.1.0] - 2026-10-10
### Added
- Chrome MV3 extension:
  - Provider registry for Claude, Cursor, Gemini, Grok and Muse.
  - MAIN-world fetch/XHR hook for usage JSON.
  - DOM progress-bar scraper.
  - Direct fetch of Claude usage.
  - Background refresh in a minimized window.
  - Offline queue, badge, popup and options page (including debug capture).
- Local Node service (zero dependencies):
  - SQLite storage.
  - `/api/ingest`, `/api/status`, `/api/debug`, `/api/health`.
  - Host/Origin security gate and strict validation.
- Pacing engine: even-pace baseline, burn rate, projection, run-out time, per-day/per-hour budget, status.
- Dashboard: card and table views, even-pace marker, status dot + label, sparkline with hover, light/dark.
- `npm run status` terminal view; `npm run demo` sample data.
- Tests for parsing, pacing and server security.
- Documentation: README, ARCHITECTURE, PROVIDERS, SECURITY, DECISIONS, ROADMAP, AGENTS.

### Known limitations
- No provider has been verified against its live site yet (see docs/PROVIDERS.md).
- Grok and Muse usage page URLs are unknown and have to be set in Options.
- Antigravity is not supported yet.
