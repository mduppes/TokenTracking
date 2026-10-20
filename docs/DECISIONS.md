# Architecture decision records

Each entry gives the context, the decision and its consequences. Append new ADRs; don't rewrite old ones. Mark one *Superseded by ADR-NNN* instead.

---

## ADR-001: Local-first, no cloud (2026-10-10)

**Context.** Usage data is personal, and the goal is one person's view across their own subscriptions.
**Decision.** Everything runs on the user's machine: a Chrome extension plus a localhost service with SQLite. No accounts, servers or sync.
**Consequences.** Simple and private. No cross-device view; a menu bar app or optional sync could be added later.

## ADR-002: Use the browser session (extension) instead of API keys or CLI tokens (2026-10-10) (the "no secrets" principle stands; the extension part is superseded by ADR-009/010)

**Context.** Subscription limits (Claude Pro/Max, Cursor, Gemini, Grok, Muse) aren't available through official APIs or API keys. The only sources are each service's own web UI and internal endpoints, or credentials stored by CLIs and apps (Keychain, `~/.gemini/oauth_creds.json`, and so on). Existing products use the same approach (tokenkarma and QuotaMeter use extensions; CodexBar uses CLI tokens and cookies). The user pointed out that every service shows usage bars on a web page, and preferred not to hand out tokens.
**Decision.** Gather data primarily with a Chrome extension running on the provider sites, using the logged-in session. Our code never reads secrets.
**Consequences.**
- Works for every web-visible service, including Gemini app, Grok and Muse, which have no CLI.
- Needs Chrome running. Background refresh has to open tabs for services without a known JSON endpoint.
- Breaks when page markup or endpoints change, which is why there's a layered strategy (ADR-004) and debug capture.
- Antigravity has no web usage page, so it needs a different approach later.

## ADR-003: Zero dependencies, no build step (2026-10-10)

**Context.** This is a personal tool that should be easy to audit, keep secure and hand over to agents.
**Decision.** Plain modern JavaScript (ES modules) everywhere: Node ≥ 22.13 built-ins on the server (`node:http`, `node:sqlite`, `node:test`), and MV3 with no bundler in the extension. Logic shared with tests lives in `extension/lib/` as pure ES modules that Node imports directly.
**Consequences.** No supply-chain surface and nothing to install. There's no TypeScript; use JSDoc where types help, and revisit if the codebase grows a lot. `node:sqlite` prints an ExperimentalWarning on some Node versions, which the npm scripts suppress.

## ADR-004: Layered capture: direct fetch → JSON interception → DOM scraping (2026-10-10) (superseded by ADR-009: in-page JSON, else DOM)

**Context.** Endpoints are undocumented and differ per provider. Some, like Gemini, use opaque RPC.
**Decision.** Each provider can implement `directFetch` (no tab needed). On provider pages, a MAIN-world hook copies usage-shaped JSON responses, and a DOM scraper reads rendered progress bars on the usage page. A generic JSON extractor handles unknown shapes, and dedicated parsers replace it once a provider is verified.
**Consequences.** Data arrives on day one even for unverified providers. The generic and DOM paths can produce imprecise labels or duplicate meters, which verified parsers fix. Two sources for the same provider can give different meter ids (see ROADMAP).

## ADR-005: Store percentages and reset times, not just absolutes (2026-10-10)

**Context.** Most services only show a percentage. Pool sizes for Grok and Claude aren't published, and Muse has token counts.
**Decision.** The core unit is `usedPercent` plus `resetsAt` plus `window`. `used`, `limit` and `unit` are optional extras.
**Consequences.** Pacing works the same way for every provider. Absolute-token views and cost-per-token need extra data (ROADMAP).

## ADR-006: Pacing against an even-spend baseline (2026-10-10)

**Decision.**
- Expected % is linear in time elapsed through the window.
- Burn rate is the observed slope within the current window, falling back to average-since-start.
- Status thresholds: ahead = 10 points above even; over-pace = projected to run out before reset.

**Consequences.** Simple and easy to explain. It doesn't model daily rhythms (sleeping hours), which could become a later improvement such as "pace over active hours".

## ADR-007: Localhost service security model (2026-10-10) (amended by ADR-010: no extension origins)

**Decision.** Bind to 127.0.0.1, check the Host header (DNS rebinding), allow-list Origins (extension or self only), require JSON content-type, validate strictly, and never use permissive CORS. No pairing token for now. See SECURITY.md.
**Consequences.** Web pages can't read or write data. Any installed Chrome extension could post data unless `TOKENTRACKING_EXTENSION_IDS` is set, which is accepted for a personal tool.

## ADR-008: Hidden background refresh via an offscreen document (2026-10-10) (superseded by ADR-009; removed in ADR-010)

**Context.** Gemini and Muse can only be read from their rendered pages. Opening them in a minimized window every 15 minutes made Chrome flicker in the Dock, which the user didn't want. A separate headless Chrome (run by the local service) would need a second browser profile with its own logins.
**Decision.** By default (`refreshMode: 'hidden'`), background refresh loads usage pages in an iframe inside a `chrome.offscreen` document (reason `DOM_SCRAPING`). The content scripts run with `all_frames` inside it. Sites forbid framing, so a **session** declarativeNetRequest rule removes `X-Frame-Options` and `Content-Security-Policy` from responses that match all of these:
- the resource type is `sub_frame`
- they belong to no tab (`tabIds: [TAB_ID_NONE]`), meaning extension pages only
- they're on provider hosts

The minimized-window method stays available as `refreshMode: 'window'`.
**Consequences.**
- No visible windows, and the same logins as your normal Chrome.
- The hidden copy of each provider page runs **without its CSP** for the few seconds it's loaded. That's a reduced defense against injected scripts, but the page is invisible, only on hosts you already use, and gone right after.
- Your normal tabs are unaffected.
- Claude Code's automatic safety check flagged this as weakening security. The user approved it explicitly.
- A site may still refuse to work when framed (frame-busting JavaScript, or cookies treated as third-party). Refresh results then say "page script never ran" or "page loaded but no usage found", and the user can switch that refresh to window mode.
- Fallback if it doesn't hold up: a headless Chrome with a dedicated profile, run by the local service (ROADMAP).

## ADR-009: Headless Chrome refresh, run by the local service only while refreshing (2026-10-10)

**Context.**
- Hidden refresh inside the extension (ADR-008) failed for Cursor: the framed page loads but gets no session, likely because of cookie rules for embedded pages. Gemini and Muse never reported data either.
- Minimized windows flicker.
- A non-headless Chrome can't hide its Dock icon on macOS.
- The user wants everything invisible and no 300 MB process running all the time.

**Decision.** The local service starts the user's installed Google Chrome **headless**, using a dedicated profile (`~/.tokentracking/browser-profile`):
- **When:** every `TOKENTRACKING_INTERVAL_MIN` (default 15) minutes and on demand (`POST /api/refresh`, `npm run refresh`).
- **What it reads:** each provider *from inside its own site*. Claude and Cursor (including Grok Bot) are read through their JSON endpoints called from the page, so they're first-party (no Origin problems). Gemini and Muse are read from the rendered page with the shared `extension/lib/scrape-dom.js`, including Muse's `openSteps`.
- **Afterwards:** it quits Chrome.
- **Logins:** done once in that profile with `npm run browser-login`, which opens a normal, visible Chrome window. Logged-out states are detected and shown on the dashboard.
- **Control channel:** Chrome DevTools Protocol over `--remote-debugging-pipe`. That means no TCP port and no dependencies.

**Identity.** The user asked that the headless browser not identify itself as headless, so it presents as the user's normal Chrome:
- the real User-Agent with "HeadlessChrome" replaced
- matching Client Hints (`Sec-CH-UA*`, `navigator.userAgentData`, platform version)
- `navigator.webdriver === false` (`--disable-blink-features=AutomationControlled`)
- real `Accept-Language`
- a laptop-sized screen

It doesn't attempt deeper fingerprint spoofing.

**Consequences.**
- Fully invisible, and nothing runs between refreshes (roughly 20–30 s of Chrome per run).
- Works with the user's normal Chrome closed.
- Costs a second set of logins that occasionally expire.
- Sites can still detect automation in other ways. If one starts blocking, that provider can be handed back to the extension with `TOKENTRACKING_HEADLESS_SKIP=<id>`.
- The extension becomes optional. Its hidden-refresh mode (ADR-008) is superseded if headless proves itself.

## ADR-010: Remove the Chrome extension (2026-10-10)

**Context.** Headless refresh (ADR-009) was verified end to end for all four providers. The extension's remaining value was capturing while browsing. It cost a separate install and reload cycle, header-modification permissions (ADR-008, plus a first-party Origin rule for Cursor), an ingest API on the local service, and two code paths to maintain.
**Decision.** Delete `extension/`. Move the shared code to `lib/`: `parse.js`, `providers.js` (parsers only) and `scrape-dom.js`. Remove `/api/ingest` and `/api/debug`, the `chrome-extension://` Origin allowance, and `TOKENTRACKING_EXTENSION_IDS`.
**Consequences.**
- One data path, and no header modification anywhere.
- A smaller attack surface: the service accepts browser requests only from its own dashboard.
- Updates come only from scheduled or manual refreshes, not instantly while browsing.
- The extension remains in git history (tag before this change: `main` at 3f504fa) if it's ever needed again.

## ADR-011: Antigravity via its local language server (a scoped exception to "no secrets") (2026-10-10)

**Context.** Antigravity has no web usage page; quota is only shown inside the desktop app. While the app runs, its bundled `language_server` listens on 127.0.0.1 (self-signed HTTPS) and answers `LanguageServerService/GetUserStatus` with per-model `quotaInfo` (`remainingFraction`, `resetTime`). Calls require the server's CSRF token, which is passed on its command line (`--csrf_token`). The same approach is used by CodexBar. The user chose this option explicitly.
**Decision.** `server/src/local/antigravity.js` finds the process with `ps`, reads the token from its arguments **at call time**, finds its listening ports with `lsof`, and makes one localhost request. Models are grouped into quota pools by identical (`remainingFraction`, `resetTime`), giving one meter per pool. This runs first in every refresh and needs no Chrome. If the app isn't running, the result is `skipped`, and the meters go stale after about 2 missed refreshes.
**Rules for the exception.**
- The token is never logged, stored, written to disk or sent anywhere except that 127.0.0.1 request.
- Only `GetUserStatus` (read-only) is called.
- It can be disabled with `TOKENTRACKING_HEADLESS_SKIP=antigravity`.
- No other credential reading is allowed without a new ADR.
**Consequences.** Antigravity quotas are tracked whenever the app is open, with no logins and no Chrome. The endpoint is internal and undocumented, so it can change with app updates (the version seen here was 2.22.0).

## ADR-012: Self-contained Mac downloads (2026-10-13)

**Context.** The user requested prebuilt Mac downloads. Source builds embed the builder's project and Node paths, which do not work on another Mac.
**Decision.** Release builds bundle the unchanged zero-dependency service and an official standalone Node runtime, pinned by version and SHA-256 for arm64 and x64. Swift resolves resources relative to its bundle. Package each architecture as a DMG with an Applications shortcut, distributed through GitHub Releases. Source builds keep their existing workflow.
**Consequences.** Download users need macOS 13+ and Chrome, but no Node, Git or compiler. Node's license ships with the app. Only allow-listed application files ship; profiles, databases and captured payloads never do. Downloading build tools and publishing software are explicit maintainer actions; the runtime still sends no telemetry or usage data off the machine. The first two previews were clearly labelled ad-hoc signed; public downloads from preview.3 use Developer ID signing and Apple notarization. Runtime updates require a new build and checksum review. Signing/notarization credentials are supplied by the publisher's tooling, never read by application code.

## ADR-013: Standalone React landing page (2026-10-13)

**Context.** The user requested a public landing page with install links and screenshots, explicitly choosing React, TypeScript and Tailwind. ADR-003 keeps the tracker runtime dependency-free.
**Decision.** Put the website in `website/`, with its own package manifest and lockfile, using React, TypeScript, Tailwind and Vite to produce static hosting assets. This is a scoped exception for the separately deployed marketing site’s build tools and browser bundle, approved by the user’s request; it does not introduce dependencies into the app/service. Keep release links centralized and label the published preview separately from features shown in current-source screenshots.
**Consequences.** The website can be deployed independently. Release packaging continues to allow-list only the service, dashboard and native app resources. Website images contain demo data only; no telemetry, third-party font/CDN dependencies, credentials, usage API calls or account integrations are added. Updating a Mac release requires updating website release metadata and README links together. Hosting/domain selection and deployment follow local preview review.
