# Roadmap

Ordered by priority. Move items to CHANGELOG.md when they ship.

## Next
- [ ] **Watch headless for a few days** for bot blocks or session expiry; tune the interval if needed.
- [ ] **Claude multi-org picker** (config or dashboard setting).
- [ ] **"X of Y" parsing** in `scrape-dom.js`, for pages that show counts rather than percentages.
- [ ] **Notifications** from the menu bar app at configurable thresholds (70/85/95%) and on `over-pace`.
- [ ] Menu bar: choose which meter drives the title, or pin one.
- [ ] Optional: port the service to Swift inside the app (no Node at all): SQLite via libsqlite3, CDP over a pipe, the panel rendered natively.

## Done
- [x] Headless refresh verified for Claude, Cursor + Grok Bot, Gemini, Muse (2026-10-10)
- [x] macOS menu bar app that starts and stops the service; Dock fallback when the menu bar is full (2026-10-10)
- [x] Chrome extension removed (ADR-010, 2026-10-10)
- [x] Antigravity via its local language server (ADR-011, 2026-10-10)

## Cost per token / value of each subscription (user's follow-up request)
Goal: "how much am I getting out of each subscription?"
- [ ] Pricing table (`server/pricing.json`) of public API list prices per model, per 1M input, output, cache-read and cache-write tokens. Source and date for every entry; never hard-code from memory.
- [ ] Token sources, ranked by precision:
  - **Claude Code**: local JSONL logs `~/.claude/projects/**/*.jsonl` (`message.usage`: input, output, cache-creation and cache-read tokens, plus `message.model`). Needs the user's explicit OK to read; it isn't a secret, but the agent sandbox flagged it.
  - **Cursor**: the usage-events page or CSV export has per-request tokens and model (readable headlessly like the rest).
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
