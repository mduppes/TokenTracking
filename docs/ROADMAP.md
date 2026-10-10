# Roadmap

Ordered by priority. Move items to CHANGELOG.md when they ship.

## Next
- [ ] **Headless refresh:** log in (`npm run browser-login`), verify all four services end to end, watch for bot blocks over a few days. Then decide whether to remove the extension (or keep it as a fallback) and remove ADR-008's hidden mode.
- [x] **macOS menu bar app** (option C): Swift `MenuBarExtra` + compact dashboard (2026-10-10).
- [ ] **Start the service at login:** a LaunchAgent (`~/Library/LaunchAgents`) running `npm start` with KeepAlive. The app could also offer "Start service" when it's down.
- [ ] Menu bar: optional notifications at 85% / over-pace; choose which meter drives the title.

## Earlier items
- [ ] **Verify every provider against the live site** (see the verification loop in PROVIDERS.md). Confirm end-to-end capture for Claude, Cursor, Gemini and Muse. Add a DOM-fixture test harness for `collector.js` (e.g. a tiny JSDOM-free HTML parser, or run it in the browser).
- [ ] **Meter id reconciliation.** When JSON and DOM both report the same meter under different ids, map them to one id (per-provider alias table, or prefer JSON and drop DOM meters once JSON has been seen in the last 24 h).
- [ ] **Claude multi-org picker.** Choose which org(s) to track in Options.
- [ ] **"X of Y" parsing** in the DOM scraper, for pages that show counts rather than percentages.
- [ ] **Alerts.** Desktop notifications (`chrome.notifications`) at configurable thresholds (70/85/95%) and when status becomes `over-pace`.

## Cost per token / value of each subscription (user's follow-up request)
Goal: "how much am I getting out of each subscription?"
- [ ] Pricing table (`server/pricing.json`) of public API list prices per model, per 1M input, output, cache-read and cache-write tokens. Source and date for every entry; never hard-code from memory.
- [ ] Token sources, ranked by precision:
  - **Claude Code**: local JSONL logs `~/.claude/projects/**/*.jsonl` (`message.usage`: input, output, cache-creation and cache-read tokens, plus `message.model`). Needs the user's explicit OK to read; it isn't a secret, but the agent sandbox flagged it.
  - **Cursor**: the usage-events page or CSV export has per-request tokens and model.
  - **Muse**: the token pool is metered in tokens, so % × pool size gives tokens.
  - **Claude web, Gemini, Grok**: no token counts. Only an estimate is possible (% of pool), so label it as an estimate.
- [ ] Subscription price per provider in Options (user enters it, e.g. $200/mo).
- [ ] Dashboard "Value" panel showing API-equivalent $ for the month vs subscription $, as a multiple, plus implied $ per 1M tokens.

## Antigravity
- [ ] No web usage page. Options:
  - (a) probe the local language server that the Antigravity app runs (CodexBar's approach, experimental)
  - (b) read its stored OAuth token from `~/.gemini/antigravity*` and call Google's quota endpoint
  
  Both mean leaving the extension-only model (ADR-002), so get the user's sign-off first and write an ADR.

## Later
- [ ] If hidden refresh doesn't work for a provider: headless Chrome with a dedicated profile, run by the local service (no header changes; one-time login).
- [ ] macOS menu bar app (Swift or Tauri) reading `/api/status`.
- [ ] Optional direct sources for Claude Code OAuth usage and Gemini CLI quota (more precise and doesn't need Chrome open), behind an explicit opt-in.
- [ ] Pace over "active hours" rather than wall-clock time.
- [ ] Export (CSV) and retention settings.
- [ ] Firefox support (MV3 `world: MAIN` content scripts need Firefox 128+).
- [ ] Pay-as-you-go API billing (Anthropic, xAI, Google). The user doesn't need it right now.
