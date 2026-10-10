# Providers

All providers are read by the headless refresher (`server/src/headless/refresh.js`, `TASKS`), from inside each provider's own site, using the dedicated logged-in Chrome profile.

Status legend: ✅ verified end-to-end with headless · ⛔ not implemented.

| Provider | Page loaded | How usage is read | Meters | Status |
|---|---|---|---|---|
| Claude | `https://claude.ai/new` | In-page `GET /api/organizations` → `GET /api/organizations/{uuid}/usage` → `parseClaudeUsage` | Session (5h), weekly (all models), weekly Opus/Sonnet when present | ✅ 2026-10-10 |
| Cursor | `https://cursor.com/dashboard/spending` | In-page `GET /api/usage-summary` → `parseCursorUsage` | Monthly: included total, Cursor models, other models, on-demand $ if enabled | ✅ 2026-10-10 |
| Grok Bot (Cursor) | same page | In-page `POST /api/dashboard/get-sand-usage-status` `{}` → `parseCursorGrokBot` | Weekly | ✅ 2026-10-10 |
| Gemini (app) | `https://gemini.google.com/usage` | DOM: `scrape-dom.js` ("NN% used" text) | "Current usage" (short rolling window) + "Weekly limit" | ✅ 2026-10-10 |
| Muse (Meta) | `https://muse.ai/` | DOM: `MUSE_OPEN_STEPS` (menu → Settings), then the dialog's ARIA progress bar | Weekly limit for the plan | ✅ 2026-10-10 |
| Antigravity | none on the web | (see ROADMAP) | Per-model quota | ⛔ |

**Logged-out detection** (`loggedOut(href, text)`), as observed 2026-10-10:

| Provider | What logged out looks like |
|---|---|
| Claude | redirect to `/login` |
| Cursor | redirect to `authenticator.cursor.sh` |
| Gemini | redirect to `/app` with "Sign in" |
| Muse | same URL, page text "Log in or create an account" |

## Notes per provider

### Claude
- `parseClaudeUsage` reads every top-level key whose value has a numeric `utilization` (treated as **0–100**) and a `resets_at`. Unknown future keys show up automatically, labeled by key.
- The org is the first with the `chat` capability. Several orgs (personal + Team) would need an org picker (ROADMAP).
- Claude Code (the CLI) shares these limits, so this covers both.

### Cursor
- `GET /api/usage-summary` returns `billingCycleStart/End`, `membershipType`, and `individualUsage.plan`:
  - `used` / `limit` / `remaining`
  - `breakdown`: `included`, `bonus`, `total`
  - `autoPercentUsed`, `apiPercentUsed`, `totalPercentUsed`

  It also returns `individualUsage.onDemand` (`enabled`, `used`, `limit`).
- **Gotcha.** `plan.used/limit` covers only the included dollar amount (cents, e.g. 2000/2000 = $20) and reads 100% while bonus usage remains. Use the `*PercentUsed` fields, which match the dashboard's "You've used N% of your included total usage".
- Dashboard labels map to fields as follows:
  - "Cursor Models (includes Cursor Grok and Composer)" = `autoPercentUsed` (meter `auto`)
  - "Other Models" = `apiPercentUsed` (meter `api`)

### Grok Bot (part of Cursor)
- Grok Bot is a Cursor product with its own weekly limit ("Grok Bot pauses at the limit until it resets"). Internally it's called "sand".
- `POST /api/dashboard/get-sand-usage-status` with body `{}` returns `usagePercent`, `nextResetTimestampUtc` and `currentPeriodStart`, plus upgrade hints (Pro+ = "$500 of Grok Bot usage each week").
- It's a first-party request from inside cursor.com, so it works. The same call from a browser extension got **403** (Origin check), which was one reason for dropping the extension.
- The spending page URL can carry `?for=<auth user id>`. It isn't needed, and it's personal, so don't put it in code or docs.

### Gemini
- `/usage` shows two rows, each a label, a "NN% used" leaf element and a reset line:
  - "Current usage · 1% used · Resets at 10:19 AM"
  - "Weekly limit · Resets Oct 13 at 1:19 AM · 0% used"
- The visual bar has no ARIA value or %-width, so the scraper keys off the **text**. An "info" icon ligature in the label row is filtered out.
- "Current usage" is classified as `session` (5 h). The real window length isn't documented, so the even-pace marker may be off.

### Muse (Meta)
- Usage sits in **Settings → General → Usage**, a dialog with no URL of its own:
  - The bar is `role="progressbar"`, `aria-label` = plan name (e.g. "Free plan"), with `aria-valuenow`/`aria-valuemax`.
  - Nearby text: "Weekly limit resets on Oct 14" and "95% used".
- There's no usage JSON visible to the page (probably a streaming or RPC channel), so the source is the DOM.
- `MUSE_OPEN_STEPS`:
  1. press `button[data-testid="hatch-dock-more"]` (aria-label "Settings")
  2. press the menu item whose first line is "Settings"
- **Two gotchas**, both handled in `scrape-dom.js`:
  - The menu opens on **pointerdown**, so a full pointer/mouse press is dispatched (not `el.click()`).
  - The item's text is "Settings\n⌘,", so text matching uses the **first line**.
- The meter label is the plan name, so it gets a new meter id if you change plans.

## Verification loop (when a provider breaks)

1. Run `npm run refresh -- <provider>` and read the message:
   - `login`: run `npm run browser-login -- <provider>` and log in again.
   - `error`: the page or API changed.
2. Debug by adapting the snippet in AGENTS.md ("Debug a provider in headless"). It loads the page with the real profile, dumps a few facts and saves a screenshot via `page.screenshot()`.
3. Fix the task in `refresh.js`, the parser in `lib/providers.js`, or the reader in `lib/scrape-dom.js`.
4. Add a test with a **redacted** payload (`test/parse.test.js`) or an HTML fixture (`test/headless.test.js`).
5. Update this table with the date.
