# Architecture

```
┌──────────────────────── Chrome ────────────────────────┐        ┌──────── Local service (Node) ────────┐
│                                                        │        │  127.0.0.1:7878                       │
│  Provider tab (claude.ai, cursor.com, …)               │        │                                       │
│   ├─ content/hook.js   (MAIN world, document_start)    │        │  POST /api/ingest ──► SQLite          │
│   │    wraps fetch/XHR, copies usage-ish JSON ──┐      │        │                     (~/.tokentracking)│
│   └─ content/collector.js (ISOLATED world)      │      │        │  GET  /api/status ◄── pacing.js       │
│        relays JSON + scrapes progress bars ─────┤      │        │  GET  /  (dashboard: public/)         │
│                                                 ▼      │  HTTP  │  POST /api/debug  ──► debug/*.json    │
│  background.js (MV3 service worker)  ──────────────────┼───────►│                                       │
│   ├─ normalizes → meters (lib/parse.js, lib/providers.js)       │  npm run status (cli.js) reads DB     │
│   ├─ caches last snapshot + offline queue (storage.local)       └───────────────────────────────────────┘
│   ├─ alarm every N min: directFetch() or open usage page in a minimized window
│   └─ badge = highest % used
│  popup.html / options.html                             │
└────────────────────────────────────────────────────────┘
```

## Components

### Chrome extension (`extension/`, Manifest V3, no build step)

| File | Role |
|---|---|
| `manifest.json` | Host permissions for provider sites and `127.0.0.1:7878`; two content scripts; module service worker |
| `content/hook.js` | Runs in the page's **MAIN** world at `document_start`. Wraps `fetch` and `XMLHttpRequest`. Same-origin JSON responses whose path matches `/usage|limit|quota|credit|billing|plan|subscription/` are posted to the isolated script, with query strings removed. |
| `content/collector.js` | Runs in the **ISOLATED** world. It does three things: <br>(1) Relays hook captures to the service worker. <br>(2) Scrapes meters from valued ARIA progress bars and leaf elements reading "NN% used". The meter "card" is the largest ancestor containing exactly one percentage; the label is the nearest non-reset, non-icon line; the reset text is the line matching /reset/. It scrapes eagerly for 90 s on a usage page (decided via `whoami`), and at any other time when a valued progress bar is on screen. <br>(3) In background-refresh tabs, runs the provider's `openSteps` to reveal a usage dialog. |
| `lib/providers.js` | Provider registry: hosts, usage URL, usage-page regex, JSON URL pattern, `parseJson`, optional `directFetch`. **Adding a provider = adding an entry here** (plus manifest hosts). |
| `lib/parse.js` | Pure functions, unit-tested in Node: `makeMeter`, `classifyWindow`, `parseResetText`, `extractMeters` (generic JSON walker). |
| `background.js` | Message hub, normalization, local cache (`storage.local.last`), offline queue (`storage.local.queue`, max 500), POST to `/api/ingest`, badge, periodic refresh via `chrome.alarms`. |
| `offscreen.*` | Invisible page for hidden refresh: loads one usage page at a time in an iframe on command from `background.js` |
| `popup.*` | Shows the cached latest meters per provider, service status, Refresh now / Dashboard / Options. Works even if the local service is down. |
| `options.*` | Service URL, interval, background refresh, per-provider enable and usage URL override, debug capture, last refresh results. |

**Capture strategies, in order of preference:**
1. `directFetch()` from the service worker using the browser's cookies (Claude and Cursor). No tab needed. It can return `incomplete` (e.g. Cursor's Grok Bot POST is refused). The refresh loop then *also* loads the usage page so strategy 2 can fill the gap.
2. JSON interception: the page's own XHR/fetch to its usage endpoint, parsed by `provider.parseJson`.
3. DOM scraping of the rendered usage page (universal fallback; the only option for Gemini's batchexecute RPC).

When JSON and DOM data for the same provider arrive within 60 s, the cached snapshot keeps the JSON version. Both are still sent to the service, and since meter ids usually differ they show up as separate meters. See ROADMAP: "meter id reconciliation".

**Background refresh.** On every alarm, `doRefresh()` goes through the enabled providers in order:
1. Try `directFetch`.
2. If that gives nothing or is `incomplete`, and a usage URL is known, load the page:
   - **`hidden`** (default): `loadHidden()` makes sure there's a session DNR rule and an offscreen document (`offscreen.html`/`offscreen.js`). The offscreen document puts the URL in a 1280×900 iframe, and the content scripts (`all_frames`) run inside it. Frames with no tab count as background-refresh frames, so Muse's `openSteps` run there too. The `whoami` call records whether the page script ran at all, which feeds the diagnostic message.
   - **`window`**: one minimized, unfocused window; one tab per provider.
3. Wait up to 45 s for a capture, then 4 s more for follow-up calls.
4. Unload, and finally close the offscreen document or window.

Results are saved to `storage.local.lastRefresh` after each provider (`done: true` once the run completes) and shown in Options. During a run, `withKeepAlive` calls a cheap extension API every 20 s; otherwise Chrome stops the MV3 service worker after about 30 s idle, partway through a page wait.

### Local service (`server/`, Node ≥ 22.13, zero dependencies)

| File | Role |
|---|---|
| `src/index.js` | Starts the HTTP server on `127.0.0.1` |
| `src/server.js` | Routing, request security gate (Host and Origin checks), validation, static dashboard, debug capture writer |
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
1. Skip if there's no profile yet, or if the `browser-login` window is open (the profile is locked).
2. Launch Chrome and build the identity.
3. For each task, open a page, navigate, wait 2.5 s, then check for a logged-out state.
4. Run `read()`. API tasks use `fetch` in the page; DOM tasks inject `scrape-dom.js`, run `openSteps`, and poll `scrape()` for up to 25 s.
5. Store the snapshots and close the page.
6. Quit Chrome (SIGKILL after 5 s if it lingers).

Scheduling lives in `index.js` (first run 10 s after start, then every N minutes). The dashboard's **Refresh now** calls `POST /api/refresh`. `GET /api/status` includes `headless` (the last run), and the dashboard shows a notice for each provider that isn't `ok`.

### Menu bar app (`menubar/TokenTrackingMenu.swift`)

An AppKit `NSStatusItem` with an `NSPopover` hosting SwiftUI content, built with plain `swiftc`. It's not SwiftUI `MenuBarExtra`; the status item gives more control and visibility checks. by `scripts/build-menubar.sh`. There's no Xcode project; the app is ad-hoc signed, with `LSUIElement` (no Dock icon) and `NSAllowsLocalNetworking`.
- **Title:** polls `GET /api/status` every 60 s and shows the most at-risk meter (rank limited > over-pace > ahead > ok, then highest %) with a gauge symbol.
- **Panel:** a `WKWebView` of `/?compact` (the dashboard's single-column mode), with Refresh now (`POST /api/refresh`), Open dashboard and Quit.
- **Service down:** if the service is unreachable, the panel says so.
- **Full menu bar fallback:** 2 s after launch, if the status item's window isn't visible, the app switches to a regular activation policy (Dock icon) and shows the panel in a window. Clicking the Dock icon reopens it. On macOS 26, status item windows are owned by "Control Center" in `CGWindowList`.
- **Owns the service:** `ServiceRunner` checks `/api/health` on launch and on every poll. If the service is down, it starts `node server/src/index.js` as a child process, with stdout/stderr going to `~/.tokentracking/service.log`. It terminates the child on quit, and passes `TOKENTRACKING_PARENT_PID` so the service exits by itself within about 3 s if the app dies without cleaning up (force quit, crash). It never stops a service it didn't start, e.g. a manual `npm start`. The project and Node paths come from `BuildConfig.swift`, which the build script generates.
- **Config:** `TOKENTRACKING_URL` overrides the service URL.

## Data model

**Wire format** (`POST /api/ingest`, body `{ snapshots: Snapshot[] }` or a single `Snapshot`):

```jsonc
{
  "provider": "claude",                 // [a-z0-9._-], ≤32 chars
  "source": "json:/api/organizations/:id/usage" ,  // or "dom", "api:…"
  "plan": "claude_max",                 // optional
  "capturedAt": "2026-10-10T12:00:00.000Z",
  "meters": [{
    "id": "five-hour",                  // stable per provider; slug of key/label
    "label": "Current session (5h)",
    "window": "session",                // session | daily | weekly | monthly | other
    "usedPercent": 42,                  // 0–100 (clamped ≤1000)
    "used": null, "limit": null, "unit": null,   // when absolute numbers are known
    "resetsAt": "2026-10-10T15:00:00.000Z",
    "resetText": "Resets in 3 hr"       // raw text, kept for debugging
  }]
}
```

**SQLite** (`~/.tokentracking/tokentracking.db`): a single append-only `snapshots` table, one row per meter reading, indexed on `(provider, meter_id, captured_at)`. Schema version is in `meta.schema_version`. Migrations: bump the version, then add `ALTER`s in `openDb`.

## Pacing math (`server/src/pacing.js`)

Window lengths: session 5 h, daily 24 h, weekly 168 h, monthly 730 h.

**Even pace**

- `windowStart = resetsAt − windowLength`
- `expectedPercent = elapsed / windowLength × 100`. This is the white tick on the dashboard bar.

**Burn rate (%/h)**
- Preferred: the slope between the first and last readings in the *current* window, if they span at least 10 minutes. Readings count as the same window when their `resetsAt` is within 10 minutes.
- Fallback: `usedPercent / hoursElapsed` since window start.

**Projections**

- `projectedAtReset = used + rate × hoursRemaining`
- `exhaustAt = now + (100 − used) / rate`

**Budget**: `(100 − used) / remaining`, given per day when at least 24 h remain, otherwise per hour.

**Status**
- `limited` when used ≥ 100
- `over-pace` when `exhaustAt < resetsAt`
- `ahead` when used > expected + 10
- otherwise `ok`
- `unknown` when there's no percentage

Meters not seen for 7 days are hidden. A meter is marked stale after 60 minutes without a reading.
