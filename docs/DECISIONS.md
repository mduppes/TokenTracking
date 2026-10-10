# Architecture decision records

Each entry gives the context, the decision and its consequences. Append new ADRs; don't rewrite old ones. Mark one *Superseded by ADR-NNN* instead.

---

## ADR-001: Local-first, no cloud (2026-10-10)

**Context.** Usage data is personal, and the goal is one person's view across their own subscriptions.
**Decision.** Everything runs on the user's machine: a Chrome extension plus a localhost service with SQLite. No accounts, servers or sync.
**Consequences.** Simple and private. No cross-device view; a menu bar app or optional sync could be added later.

## ADR-002: Use the browser session (extension) instead of API keys or CLI tokens (2026-10-10)

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

## ADR-004: Layered capture: direct fetch → JSON interception → DOM scraping (2026-10-10)

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

## ADR-007: Localhost service security model (2026-10-10)

**Decision.** Bind to 127.0.0.1, check the Host header (DNS rebinding), allow-list Origins (extension or self only), require JSON content-type, validate strictly, and never use permissive CORS. No pairing token for now. See SECURITY.md.
**Consequences.** Web pages can't read or write data. Any installed Chrome extension could post data unless `TOKENTRACKING_EXTENSION_IDS` is set, which is accepted for a personal tool.

## ADR-008: Hidden background refresh via an offscreen document (2026-10-10)

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
