# Architecture

```
┌──────── Menu bar app (Swift) ────────┐      ┌──────────── Local service (Node, 127.0.0.1:7878) ───────────┐
│ status item: most at-risk %          │ HTTP │  GET  /api/status  ◄── status.js + pacing.js ◄── SQLite      │
│ popover: WKWebView of /?compact ─────┼─────►│  POST /api/refresh ──► headless/refresh.js                   │
│ starts/stops the service (child)     │      │  GET  /  (dashboard: public/)                                │
└──────────────────────────────────────┘      │  timer: every 15 min ──► headless/refresh.js                 │
                                              └───────────────┬──────────────────────────────────────────────┘
                                                              │ spawn, CDP over --remote-debugging-pipe
                                                              ▼
                                   Google Chrome --headless (own profile ~/.tokentracking/browser-profile)
                                   claude.ai · cursor.com · gemini.google.com · muse.ai  → quits after the run
```

## Components

### Shared libraries (`lib/`)

| File | Role |
|---|---|
| `parse.js` | Pure helpers: `makeMeter`, `classifyWindow`, `parseResetText`, `extractMeters` (generic JSON walker), `normalizeDomMeters` |
| `providers.js` | Provider parsers: `parseClaudeUsage`, `parseCursorUsage`, `parseCursorGrokBot`, plus `MUSE_OPEN_STEPS` |
| `scrape-dom.js` | Classic script injected into pages. It defines `TokenTrackingDom.scrape()`, which finds meters from "NN% used" text and valued ARIA progress bars (the meter "card" is the largest ancestor with exactly one percentage; the label is the nearest non-reset, non-icon line; the reset text is the line matching /reset/). It also defines `runOpenSteps()`, which does full pointer presses and matches text on the first line. |

### Local service (`server/`, Node ≥ 22.13, zero dependencies)

| File | Role |
|---|---|
| `src/index.js` | Starts the HTTP server on `127.0.0.1` and the headless refresh timer; exits when the parent menu bar app dies (`TOKENTRACKING_PARENT_PID`) |
| `src/server.js` | Routing, request security gate (Host and Origin checks), `/api/status`, `/api/refresh`, static dashboard |
| `src/db.js` | `node:sqlite` schema and queries; dedupes identical readings within 2 min |
| `src/pacing.js` | Pacing math (below) |
| `src/status.js` | Builds the `/api/status` view: latest reading per meter + pace + history |
| `src/cli.js` | `npm run status` terminal view |
| `public/` | Dashboard (vanilla JS, no CDN, strict CSP) |

### Headless refresher (`server/src/headless/`)

| File | Role |
|---|---|
| `chrome.js` | Launches Google Chrome (`--headless=new`, dedicated `--user-data-dir`) and speaks CDP over `--remote-debugging-pipe` (fd 3/4, NUL-delimited JSON). `browserIdentity()` builds the User-Agent/Client-Hints override, and `openPage()` applies it plus a small pre-page script (webdriver, screen). `profileInUse()` reads Chrome's `SingletonLock`. |
| `refresh.js` | `TASKS` (one per provider: URL, `loggedOut(href, text)`, `read(page)`), `runHeadlessRefresh()` (single-flight), and the last-run status in `~/.tokentracking/headless-status.json` |

Flow per run:
0. Local sources first, no Chrome needed: Antigravity's language server (`server/src/local/antigravity.js`, ADR-011).
1. Skip if there's no profile yet, or if the `browser-login` window is open (the profile is locked).
2. Launch Chrome and build the identity.
3. For each task, open a page, navigate, wait 2.5 s, then check for a logged-out state.
4. Run `read()`. API tasks use `fetch` in the page; DOM tasks inject `scrape-dom.js`, run `openSteps`, and poll `scrape()` for up to 25 s.
5. Store the snapshots and close the page.
6. Quit Chrome (SIGKILL after 5 s if it lingers).

Scheduling lives in `index.js` (first run 10 s after start, then every N minutes). The dashboard's **Refresh now** calls `POST /api/refresh`. `GET /api/status` includes `headless` (the last run), and the dashboard shows a notice for each provider that isn't `ok`.

### Menu bar app (`menubar/TokenTrackingMenu.swift`)

An AppKit `NSStatusItem` with an `NSPopover` hosting SwiftUI content, built with plain `swiftc`. It's not SwiftUI `MenuBarExtra`; the status item gives more control and visibility checks. by `scripts/build-menubar.sh`. There's no Xcode project; the app is ad-hoc signed, with `LSUIElement` (no Dock icon) and `NSAllowsLocalNetworking`.
- **Title:** polls `GET /api/status` every 60 s. `MenuBarGlyphs` draws one SF Symbol plus two characters per service (the % used by its worst meter, 0–99; `––` at the limit) into a single template image. Grok Bot is split out of Cursor by meter id. The tooltip lists per-service values plus the most at-risk meter (rank limited > over-pace > ahead > ok, then highest %). With no data, it shows a gauge symbol.
- **Panel:** a `WKWebView` of `/?compact` (the dashboard's single-column mode), with Refresh now (`POST /api/refresh`), Open dashboard and Quit.
- **Service down:** if the service is unreachable, the panel says so.
- **Full menu bar fallback:** 2 s after launch, if the status item's window isn't visible, the app switches to a regular activation policy (Dock icon) and shows the panel in a window. Clicking the Dock icon reopens it. On macOS 26, status item windows are owned by "Control Center" in `CGWindowList`.
- **Owns the service:** `ServiceRunner` checks `/api/health` on launch and on every poll. If the service is down, it starts `node server/src/index.js` as a child process, with stdout/stderr going to `~/.tokentracking/service.log`. It terminates the child on quit, and passes `TOKENTRACKING_PARENT_PID` so the service exits by itself within about 3 s if the app dies without cleaning up (force quit, crash). It never stops a service it didn't start, e.g. a manual `npm start`. The project and Node paths come from `BuildConfig.swift`, which the build script generates.
- **Icon:** `assets/icon.svg` → `npm run build:icon` (headless Chrome rasterizes every size, then `iconutil`) → `menubar/AppIcon.icns`, copied into `Contents/Resources` with `CFBundleIconFile`.
- **Config:** `TOKENTRACKING_URL` overrides the service URL.

## Data model

**Meter** (what parsers produce, stored one row per reading):

```jsonc
{
  "id": "five-hour",                  // stable per provider; slug of key/label
  "label": "Current session (5h)",
  "window": "session",                // session | daily | weekly | monthly | other
  "usedPercent": 42,                  // 0–100 (clamped ≤1000)
  "used": null, "limit": null, "unit": null,   // when absolute numbers are known
  "resetsAt": "2026-10-10T15:00:00.000Z",
  "resetText": "Resets in 3 hr"       // raw text from the page, if any
}
```

**SQLite** (`~/.tokentracking/tokentracking.db`): a single append-only `snapshots` table, one row per meter reading, indexed on `(provider, meter_id, captured_at)`. Schema version is in `meta.schema_version`. Migrations: bump the version, then add `ALTER`s in `openDb`.

## Pacing math (`server/src/pacing.js`)

Window lengths: session 5 h, daily 24 h, weekly 168 h, monthly 730 h.

**Even pace**

- `windowStart = resetsAt − windowLength`
- `expectedPercent = elapsed / windowLength × 100`. This is the white tick on the dashboard bar.

**Burn rate (%/h)**
- Preferred: the slope between the first and last readings in the *current* window, if they span at least 10 minutes and 5% of the window. Readings count as the same window when their `resetsAt` is within 10 minutes.
- Fallback: `usedPercent / hoursElapsed` since window start.

**Projections**

- `projectedAtReset = used + rate × hoursRemaining`
- `exhaustAt = now + (100 − used) / rate`

**Budget**: `(100 − used) / remaining`, given per day when at least 24 h remain, otherwise per hour.

**Status**
- `limited` when used ≥ 100
- `over-pace` when `exhaustAt < resetsAt` (and at least 5% used)
- `ahead` when used > expected + 10
- otherwise `ok`
- `unknown` when there's no percentage

Meters not seen for 7 days are hidden. A meter is marked stale when its last reading is older than 2.5× the refresh interval (at least 30 min; `staleAfterMs` in `buildStatus`).
