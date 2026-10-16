# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions: [SemVer](https://semver.org/).

## [Unreleased]
### Maintenance
- Removed local release staging apps, cached Node runtimes/downloads and the generated screenshot preview to reclaim about 535 MB; kept the development app and both preview DMGs. Documented which generated folders can be cleared after release verification.

### Added
- Landing page support links open the creator’s hosted Stripe checkout from the top navigation, hero downloads, footer and a prominent dedicated support section; creator profile links are configured separately, with GitHub/LinkedIn icons and a named mduppes.com link. No payment keys, widgets or backend are required.
- Standalone React + TypeScript + Tailwind/Vite landing page (`website/`, ADR-013), with verified Apple Silicon/Intel download links, responsive product walkthrough, dashboard light/dark screenshots, current-source Settings screenshots, privacy details, installation guidance and preview-release caveats.
- Demo screenshots now include OpenAI, current brand glyphs, and the native SwiftUI panel and Settings; the compact web panel is captured separately. README and roadmap reflect current customization, meter selection and provider status.
- **Settings** via the dropdown’s top-right gear (X to return): show/hide each service, drag whole rows with animated reordering as you hover, or use arrows to reorder, select a specific usage meter or keep Highest usage, and restore defaults. Choices persist locally; changes appear directly in the menu bar. Missing selected meters show `??`; hiding all services leaves the app icon accessible.
- **Antigravity Gemini 4 Argon meter:** tracked as a separate third usage pool (`pool-gemini-argon`, labeled "Gemini 4 Argon") alongside "Gemini models" and "Claude and GPT models", matching Antigravity's own Settings.
- Authentic vector brand icons for all providers across the macOS menu bar and dashboard (Claude sunburst, Cursor isometric cube, Meta Muse cursive 'm', Grok ribbon loop, Antigravity arch curve, Google Gemini diamond sparkle, alongside the OpenAI knot).
- Dashboard card headers, table view, and "Resets next" rows now display brand SVG icons next to provider names.
- Self-contained Apple Silicon and Intel Mac DMG builds with checksum-verified bundled Node, relocatable service paths, download/install instructions, and optional Developer ID signing/notarization tooling (ADR-012). Initial downloads are explicitly labelled unsigned previews.
- Browser providers now have dashboard and panel cards before their first stored reading, with an Open browser action. Skipped refreshes explain when the dedicated Chrome window must be quit with Cmd+Q.
- OpenAI menu bar slot uses a locally drawn six-loop knot instead of the generic sparkle, still positioned after Grok Bot.
- **Open browser** on browser-provider warnings, including scraping errors, in the dashboard and native panel. The button stays available for retries; closing the dedicated browser refreshes that provider automatically.
- **OpenAI (ChatGPT)** usage page support: the dedicated Chrome profile opens the usage overview and reads its rendered percentage meters with the shared DOM scraper. Added OpenAI to the dashboard, login flow and menu bar. Signed-in meter details still need end-to-end verification.
- Menu bar shows OpenAI as `??` until its first reading is stored, so the new slot is visible before the first successful refresh.
### Fixed
- Fixed menu bar fallback window popping up and stealing focus when entering full-screen mode in other apps. The visibility check now ignores intentional menu bar hiding during full-screen spaces (`CGWindowList`) and auto-hide states (`NSMenu.menuBarVisible()`), and never interrupts users once the menu bar icon has already been established.
- Muse refresh recognizes “is warming up” as well as “Connecting…” and waits up to three minutes for the Settings usage meter, including when loading has no visible status label. A timeout keeps the last confirmed reading for the next refresh.
- Muse no longer overwrites post-reset usage with old chat limit notices: fallback readings require a known reset within the next seven days. Missing Settings usage is reported separately from a connection timeout.
- Settings drag reordering works again on macOS: an in-panel drag gesture moves the whole row under the pointer and shifts neighboring rows on hover, replacing native drag/drop callbacks that were not moving rows. Verified upward and downward drags in the running app.
- OpenAI no longer decides login from the initial 2.5-second guest shell: it waits up to 60 seconds for rendered usage, retries across authentication navigation, and distinguishes confirmed logout from loading errors. OpenAI-only signed-in refresh succeeded on 2026-10-13.
- Refresh failures are surfaced in both UIs, and the service returns HTTP 500 for failed refreshes instead of reporting success.
- OpenAI guest pages saying **Log in** now count as logged out, so they offer a login notice rather than a generic scraping error.
- **Antigravity: a fully used pool wasn't shown.** The language server omits `remainingFraction` when it's 0, and the parser skipped those models, so the Claude + GPT-OSS pool just went stale instead of showing 100% / limit reached. A pool with a `resetTime` but no fraction now counts as 0% remaining.
- **Antigravity went stale after a pool reset.** Meters were grouped by identical quota values, so once the Claude pool reset, every pool reported 100% with the same rolling reset time and they merged into a new meter, leaving the old ones stuck at their last reading. Antigravity now shows the same two groups as its own Settings, "Claude and GPT models" (`pool-claude-gpt`) and "Gemini models" (`pool-gemini`), assigned by model name so the ids never change. Schema migrations (v2, v3) fold the old meter ids into these. Re-select the Antigravity meter in Settings if you had chosen the old "Claude + GPT-OSS" one.
### Changed
- Landing page colors now match the app: forest green and mint from its icon, warm neutral surfaces from the dashboard, and amber for the illustrative ahead-of-pace meter.
- All landing-page external links, including Mac downloads and documentation, open in a new tab; section navigation stays on the page.
- Replaced the confusing `––` menu bar limit indicator with an intuitive reset countdown (e.g. `↻2h`, `↻45m`, `↻1d`) showing when the quota frees up, falling back to `MAX` when reset time is unknown. Tooltip also details the remaining reset duration when limited.
- **One source for presentation:** `/api/status` now includes `notices`, `resetsNext` and `providers[].planLabel` (`withPresentation` in `status.js`, unit-tested). The web dashboard and the menu bar panel both render them as-is instead of each re-deriving them, so they can't drift apart.
### Added
- **Log in button** on stale and needs-login notices (dashboard and menu bar panel). It opens the TokenTracking browser on that service (`POST /api/login`), and that service refreshes automatically when you quit the window. Partial refreshes merge into the last results.
### Fixed
- **Blank menu bar panel** after the Mac slept: the panel is now **native SwiftUI** instead of an embedded web view. Neither reloading nor recreating the web view on every open fixed it. It shows the same content: notices with Log in, "Resets next", and every meter with bar, even-pace tick and countdown.
- **Muse** went stale while its agent was slow to connect ("Connecting…", no Usage section yet; worst when out of tokens). The refresh now waits for the page, then up to 2 min for the connection, and otherwise reads the "You've reached your usage limit … reset at …" notice (100% + reset time). The Muse meter is now `weekly` / "Weekly limit", with the plan shown separately.
- Dashboard **favicon** (the app icon; `npm run build:icon` also writes `server/public/favicon.png`).
### Changed
- Consistent service order everywhere: Claude, Cursor, Antigravity, (Grok Bot), Muse, Gemini. The menu bar shows Claude ✳, Cursor ➚, Antigravity ⇧, Grok Bot ✕, Muse Ⓜ; Gemini is dashboard-only.
### Fixed
- **Menu bar icon hidden even though "Allow in the Menu Bar" was on.** The permission was tied to an older ad-hoc-signed build. Builds are now signed with a stable self-signed local certificate (`scripts/create-signing-cert.sh`), and the bundle id changed to `io.github.mduppes.tokentracking` (a fresh entry; old entries can be switched off).
- Menu bar icon never appeared: recent macOS hides new apps' menu bar items until they're allowed in System Settings → Menu Bar. The app now detects a hidden icon continuously, explains it in the fallback window (with an "Open Menu Bar settings" button), and returns to the menu bar once it's allowed.
### Added
- **Antigravity** (ADR-011): quota pools read from the desktop app's local language server (`GetUserStatus` on 127.0.0.1) while Antigravity is running. Models are grouped into pools (e.g. "Claude + GPT-OSS models", weekly; "Gemini models", ~5h). It's the first step of every refresh and needs no Chrome. In the menu bar it shows as ⇧, **replacing Gemini**, which stays on the dashboard.
- **App icon** ("reset ring": a usage ring with clock hands). Source is `assets/icon.svg`; `npm run build:icon` renders every macOS size with headless Chrome and packs `menubar/AppIcon.icns` with `iconutil`, and `build:menubar` bundles it.
- MIT license.
- README screenshots (`docs/images/`), generated from demo data by `npm run screenshots` (dashboard light/dark, menu bar panel, menu bar glyphs).
- README: clone step and a disclaimer (not affiliated with the providers; relies on undocumented endpoints).
### Changed
- Plan names display nicely ("claude_max" → "Max"). The per-meter reset date line is removed (the countdown pill's tooltip and "Resets next" show it).
### Added
- Dashboard: a **countdown pill** on every meter ("↻ 1d 3h", colored by pace) and a **"Resets next"** list across all services, soonest first. The header shows "Updated 3m ago · next refresh in 12m" (`headless.nextAt` / `intervalMin` in `/api/status`).
- Menu bar: **one icon + two digits per service**, in the order Claude ✳, Cursor ➚, Grok Bot ✕, Muse Ⓜ, Gemini ✦. The digits are the % used by that service's worst meter (0–99, padded so the width is stable); `––` means at the limit and `??` means no reading. It's drawn as one template image, so it adapts to light and dark menu bars. The tooltip lists every service and marks stale ones.
- **Stale data is listed:** a notice per stale service at the top of the dashboard and menu bar panel ("Gemini is stale: last read 3h ago · last refresh: needs a login"), plus a "stale" tag in "Resets next". A reading counts as stale after 2.5× the refresh interval (at least 30 min).
### Changed
- The refresh timer reschedules after each run (`setTimeout` chain), so the next-refresh time is exact.

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
