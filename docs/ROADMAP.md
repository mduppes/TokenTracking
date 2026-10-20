# Roadmap

Ordered by priority. Move items to CHANGELOG.md when they ship.

## Next
- [ ] **Muse live warmup verification:** the user’s 2026-10-14 screenshot confirms “is warming up”, which the old connection check missed. The reader now waits up to three minutes for warmup and Settings usage, with simulated-time and real-Chrome fixture coverage. Monitor whether live warmups need a longer allowance; expired notices remain rejected.
- [x] **Website rollout:** public Sites deployment at https://tokentracking.truedog2.chatgpt.site (2026-10-20). Preview.4 signed download links and README are synchronized; demo screenshots remain current.
- [ ] **Mac distribution:** preview.3 is Developer ID signed and Apple-notarized. Before promoting to stable, verify first-launch Gatekeeper, browser login and menu bar permissions on fresh Apple Silicon and Intel Macs; Intel package is cross-compiled on Apple Silicon. See `docs/RELEASING.md`.
- [x] **OpenAI:** verified meter layout against live signed-in session (2026-10-17). `scrape-dom.js` now reads visible headings when progress bar accessibility labels are generic ("Usage remaining") and ignores non-quota percentage headings in activity breakdown charts ("Weekly" 100%), with v5 schema migration and redacted fixture test.
- [x] **Icons:** authentic brand vector icons for all providers across the macOS menu bar and dashboard (Claude, Cursor, Antigravity, Grok Bot, OpenAI, Muse, Gemini).
- [ ] **Watch headless for a few days** for bot blocks or session expiry; tune the interval if needed.
- [ ] **Claude multi-org picker** (config or dashboard setting).
- [ ] **"X of Y" parsing** in `scrape-dom.js`, for pages that show counts rather than percentages.
- [ ] **Notifications** from the menu bar app at configurable thresholds (70/85/95%) and on `over-pace`.
- [ ] Optional: port the service to Swift inside the app (no Node at all): SQLite via libsqlite3, CDP over a pipe, the panel rendered natively.

## More AI services (backlog)
Candidates, to be checked for a usage page or local source first. Same rules as the others: read in-page with the headless profile, no API keys.
- [ ] **OpenAI Codex:** investigate any limits not exposed by the usage overview; ChatGPT page verification is tracked under Next.
- [ ] **GitHub Copilot**: premium-request allowance per month (github.com billing/usage pages).
- [ ] **Perplexity**: Pro search / research limits.
- [ ] **Windsurf** and **Kiro**: credit-based plans with dashboards.
- [ ] **Mistral Le Chat**, **DeepSeek**: message limits if exposed.
- [ ] **Midjourney** (fast GPU hours), **ElevenLabs** (characters per month): non-LLM, but the same "pace a monthly quota" problem.

## Done
- [x] Refine website visuals with icon rows, stronger contrast, screenshot framing and compact cards instead of literal bullets (2026-10-20).
- [x] Simplify website copy and layout: direct headings, bullet lists and fewer repeated sections (2026-10-20).
- [x] Stop Chrome’s startup app clone from triggering macOS App Management under TokenTracking’s identity, for refresh and login; local-only A/B launch diagnostics confirmed the request disappears (2026-10-20).
- [x] Developer ID signed and Apple-notarized preview.3 for arm64 and x64, with attached DMG tickets, Gatekeeper checks and relocated signed-runtime smoke tests (2026-10-20).
- [x] Build and publish 0.6.0-preview.2 for Apple Silicon and Intel; refresh demo screenshots, website copy and GitHub documentation together (2026-10-20). Relocated-service checks cover arm64 and x64 under Rosetta; physical Intel/fresh-Mac verification remains pending.
- [x] Clear local release staging apps, Node build caches and the screenshot preview; retain the development app and preview DMGs, and document safe build cleanup (2026-10-15; about 535 MB reclaimed).
- [x] Muse warming-up detection and three-minute meter loading allowance, including missing usage with no visible loading label (2026-10-14; fixture verified).
- [x] Reject expired Muse limit notices after weekly reset; regression tests cover next-year rollover, unknown dates, seven-day bounds and New Year (2026-10-14).
- [x] Hosted Stripe support links and configurable creator links on the landing page (2026-10-13).
- [x] Standalone React/TypeScript/Tailwind landing page with Mac downloads, demo screenshots, current-source Settings walkthrough, installation notes and privacy details (2026-10-13; local preview).
- [x] Menu bar service selection and ordering: top-right gear editor, gesture-based hover reordering of whole rows (up/down mouse drags verified), per-service meter selection, saved local preferences, Gemini option and Restore defaults (2026-10-13).
- [x] Self-contained Mac DMG packaging and README download/install instructions for Apple Silicon and Intel (2026-10-13; preview signing).
- [x] Headless refresh verified for Claude, Cursor + Grok Bot, Gemini, Muse (2026-10-10)
- [x] macOS menu bar app that starts and stops the service; Dock fallback when the menu bar is full (2026-10-10)
- [x] Chrome extension removed (ADR-010, 2026-10-10)
- [x] Antigravity via its local language server (ADR-011, 2026-10-10; updated with 3rd Gemini 4 Argon pool 2026-10-16)

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

## Later
- [ ] Optional direct sources for Claude Code OAuth usage and Gemini CLI quota (more precise and doesn't need Chrome open), behind an explicit opt-in.
- [ ] Pace over "active hours" rather than wall-clock time.
- [ ] Export (CSV) and retention settings.
- [ ] Pay-as-you-go API billing (Anthropic, xAI, Google). The user doesn't need it right now.
