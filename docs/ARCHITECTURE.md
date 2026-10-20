# Architecture

```
┌──────── Menu bar app (Swift) ────────┐      ┌──────────── Local service (Node, 127.0.0.1:7878) ───────────┐
│ status item: chosen usage slots          │ HTTP │  GET  /api/status  ◄── status.js + pacing.js ◄── SQLite      │
│ popover: native SwiftUI panel ───────┼─────►│  POST /api/refresh ──► headless/refresh.js                   │
│ starts/stops the service (child)     │      │  GET  /  (dashboard: public/)                                │
└──────────────────────────────────────┘      │  timer: every 15 min ──► headless/refresh.js                 │
                                              └───────────────┬──────────────────────────────────────────────┘
                                                              │ spawn, CDP over --remote-debugging-pipe
                                                              ▼
                                   Google Chrome --headless (own profile ~/.tokentracking/browser-profile)
                                   claude.ai · cursor.com · chatgpt.com · gemini.google.com · muse.ai  → quits after the run
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

`chromeProfileArgs()` supplies shared launch settings for refresh and login. On macOS it disables Chrome’s update-time app clone (`MacAppCodeSignClone`) to avoid App Management requests; Chrome’s sandbox and code-signature checks remain enabled. See SECURITY.md.

Flow per run:
0. Local sources first, no Chrome needed: Antigravity's language server (`server/src/local/antigravity.js`, ADR-011).
1. Skip if there's no profile yet, or if the `browser-login` window is open (the profile is locked).
2. Launch Chrome and build the identity.
3. For each task, open a page, navigate, wait 2.5 s, then check for a logged-out state.
4. OpenAI bypasses the initial 2.5 s login check and polls its rendered usage for up to 60 s, reinjecting the scraper after authentication navigation. Only a confirmed login page at timeout produces a login notice; loading failures produce an error. Other providers use the initial login check. Run `read()`. API tasks use `fetch` in the page; generic DOM tasks inject `scrape-dom.js`, run `openSteps`, and poll `scrape()` for up to 25 s. Muse's reader (`headless/muse.js`) polls for up to three minutes, waiting through visible “Connecting…” / “is warming up” states and missing Settings usage. Only after this wait does it consider an unexpired weekly limit notice; otherwise it reports a loading error and preserves the last snapshot.
5. Store the snapshots and close the page.
6. Quit Chrome (SIGKILL after 5 s if it lingers).

`POST /api/login {provider}` (dashboard **Log in** buttons) opens a visible Chrome window on the profile with that provider's login URL (`headless/login.js`, shared with `npm run browser-login`). When that Chrome process exits, it runs a refresh for just that provider. Partial runs merge into `headless-status.json`, so other providers keep their status.

Scheduling lives in `index.js` (first run 10 s after start, then every N minutes). The dashboard's **Refresh now** calls `POST /api/refresh`. `GET /api/status` includes `headless` (the last run), and the dashboard shows a notice for each provider that isn't `ok`.

### Menu bar app (`menubar/TokenTrackingMenu.swift`)

An AppKit `NSStatusItem` with an `NSPopover` hosting SwiftUI content, built with plain `swiftc`. It's not SwiftUI `MenuBarExtra`; the status item gives more control and visibility checks. by `scripts/build-menubar.sh`. There's no Xcode project; source builds use local signing (or ad-hoc signing), with `LSUIElement` (no Dock icon) and `NSAllowsLocalNetworking`.
- **Title:** polls `GET /api/status` every 60 s. `MenuBarGlyphs` draws one local brand icon plus usage characters per service (the highest % used by default, or the selected meter, 0–99; a reset countdown like `↻2h`/`↻45m` or `MAX` at the limit) into a single template image. Grok Bot is split out of Cursor by meter id. The tooltip lists per-service values plus the most at-risk meter (rank limited > over-pace > ahead > ok, then highest %). Selected slots without data show `??`; when every slot is hidden, a gauge icon keeps the app accessible.
- **Customization:** The top-right gear in the native dropdown toggles the **Settings** editor and becomes an X to return. The editor has checkboxes, whole-row dragging with a floating row and animated insertion space on hover (an in-panel SwiftUI gesture, avoiding unreliable native pasteboard drag callbacks), accessible up/down buttons, a per-service **Show** meter selector and Restore defaults. Changes appear directly in the menu bar. Swift `MenuBarPreferences` stores the ordered service IDs, hidden IDs and selected meter IDs in local `UserDefaults` (`menuBarPreferences.v1`); no service/API/DB change. Defaults preserve the current six slots, with Gemini available but hidden. Changes redraw immediately using cached status, even offline. Selected slots without readings show `??`; a missing chosen meter stays `??` rather than switching to a different limit; hiding every slot leaves a clickable gauge icon. Unknown/duplicate saved IDs are cleaned up, and future services are appended hidden. Hiding a slot does not stop refreshing it or remove its dashboard card.
- **Service down:** if the service is unreachable, the panel says so.
- **Panel:** native SwiftUI (`PanelView`, `ProviderCard`, `MeterRow`) drawn from the decoded `/api/status`: header (updated / next refresh), stale and problem notices with **Log in** (`POST /api/login`), the 5 soonest resets, and every meter with its bar, even-pace tick, pace label and countdown pill. It **used to be a `WKWebView` of `/?compact`**, but after the Mac slept the web view often drew nothing, even when recreated on every open (2026-10-11). The native panel uses the same data path as the menu bar numbers, which kept working. The full dashboard stays one click away (Open dashboard).
- **Hidden-icon fallback:** on launch, the app checks whether the status item's window is visible. It's hidden if the app isn't allowed in System Settings → Menu Bar (new bundles start disallowed on macOS 26; seen 2026-10-10) or the bar is full. If not visible after launch (and not in a full-screen app), the app switches to a regular activation policy (Dock icon) and shows the panel in a window, with a banner and a button to the Menu Bar settings. When the item becomes visible, it closes the window and goes back to menu-bar-only. To avoid pulling users out of full-screen apps or triggering on auto-hidden menu bars, the check is skipped when full-screen is active (`CGWindowList`), when the system menu bar is hidden (`NSMenu.menuBarVisible()`), or after the icon has already been established in the menu bar. Clicking the Dock icon reopens the window. On macOS 26, status item windows are owned by "Control Center" in `CGWindowList`.
- **Owns the service:** `ServiceRunner` checks `/api/health` on launch and on every poll. If the service is down, it starts `node server/src/index.js` as a child process, with stdout/stderr going to `~/.tokentracking/service.log`. It terminates the child on quit, and passes `TOKENTRACKING_PARENT_PID` so the service exits by itself within about 3 s if the app dies without cleaning up (force quit, crash). It never stops a service it didn't start, e.g. a manual `npm start`. The project and Node paths come from generated `BuildConfig.swift`: source builds use local absolute paths; release builds resolve the bundled service and Node relative to `Bundle.main`, so the app can move between machines and directories.
- **Signing:** `build-menubar.sh` signs with the "TokenTracking Local Signing" identity when it exists, else ad-hoc. Bundle id `io.github.mduppes.tokentracking`. macOS ties "Allow in the Menu Bar" to the signing identity: with ad-hoc signing every rebuild is a new identity, and the menu bar entry goes stale (icon hidden even though the toggle is on). Seen on macOS 26, 2026-10-10.
- **Icon:** `assets/icon.svg` → `npm run build:icon` (headless Chrome rasterizes every size, then `iconutil`) → `menubar/AppIcon.icns`, copied into `Contents/Resources` with `CFBundleIconFile`.
- **Config:** `TOKENTRACKING_URL` overrides the service URL.

## One source of truth, two renderers

`GET /api/status` is the single source for every UI. Besides the raw providers and meters (with pace and `stale`), the service adds **presentation fields** in `withPresentation()` (`server/src/status.js`):
- `notices[]`: `{ provider, kind: stale | login | error, text, canLogIn, actionLabel }`. Stale services come first, with the last refresh's reason. Services that are `skipped` (e.g. Antigravity not running) get no notice. Browser providers offer **Open browser** on all warnings, including page errors, so the user can inspect their session and log in if needed. Local-only providers have no browser action. The button stays available after an attempt so failures can be retried.
- `resetsNext[]`: every meter with a reset time, soonest first. UIs show the first N.
- Registered browser providers have an empty card before their first reading (`emptyText`, `canOpenBrowser`, `actionLabel`), with no invented meter or snapshot. `refreshMessage` explains when browser reads were skipped because the login window is still open. Both UIs show HTTP/network refresh failures.
- `providers[].planLabel`: "claude_max" becomes "Max".

The web dashboard (`server/public/app.js`) and the menu bar panel (Swift `PanelView`) render these as-is. Only live countdowns are computed client-side, from `resetsAt`, because they tick. **To change wording or rules, edit `withPresentation` (tested in `test/presentation.test.js`), not the UIs.**

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

**SQLite** (`~/.tokentracking/tokentracking.db`): a single `snapshots` history table, one row per meter reading, indexed on `(provider, meter_id, captured_at)`. Schema version is in `meta.schema_version`. Migrations run transactionally in `openDb`. Schema v5 removes invalid OpenAI `weekly` and `usage-remaining` readings from older scrapers; valid `weekly-limit` and `5-hour-limit` history remains. Bump the version when adding a migration.

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

## Distribution

`npm run build:release -- arm64` (or `-- x64`) downloads a pinned, SHA-256-verified official Node runtime and compiles the corresponding Swift architecture. The app includes `Contents/Helpers/node`, the Node license, and an allow-listed `Contents/Resources/service` tree (`lib`, `server/src`, `server/public`, package metadata and license). It never bundles user data or the browser profile. Releases are DMGs with an Applications shortcut. Runtime storage remains in `~/.tokentracking`. See ADR-012 and [RELEASING.md](RELEASING.md) for signing, notarization and validation.

## Public website (build-time dependencies only)

`website/` is a separate React + TypeScript + Tailwind/Vite project with its own package manifest and lockfile (ADR-013). It builds to `website/dist` for static hosting. Neither the local service nor release DMGs include it. There are no analytics, remote fonts, account integrations or calls to the local usage service. Images come from demo-only product captures, copied with `npm run sync:assets --prefix website`; release metadata lives in `website/src/release.ts`.

`npm run screenshots` captures web dashboards through a throwaway Chrome profile and builds an isolated native preview app fed demo JSON. Native panel/Settings PNGs are captured from that preview with computer-use tools or manually. AppKit bitmap caching was not reliable for SwiftUI controls, so native screenshot capture stays a separate step. No provider reads, real usage, browser logins or production preferences are captured. `compact-dark.png` shows the web compact view; `panel-dark.png` and `settings-dark.png` show native views.
