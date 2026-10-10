# Providers

Status legend: ✅ verified end-to-end · 🟢 page structure verified on the live site, end-to-end pending · 🟡 implemented from public reverse-engineering / best guess, **not yet verified** · ⛔ not implemented.

Page structure for Gemini and Muse was inspected on the live sites on 2026-10-10 (v0.2.0), and the user reported Claude working. End-to-end capture through the extension still needs confirming for each provider after reloading the extension.

| Provider | Usage page | Strategy | Limits it should expose | Status |
|---|---|---|---|---|
| Claude | https://claude.ai/new#settings/usage | directFetch `GET /api/organizations` → `GET /api/organizations/{uuid}/usage`; JSON interception of the same; DOM fallback | 5-hour session, weekly (all models), weekly Opus / Sonnet | ✅ directFetch verified 2026-10-10 |
| Cursor | https://cursor.com/dashboard/spending | directFetch + JSON interception of `GET /api/usage-summary` and `POST /api/dashboard/get-sand-usage-status`; no DOM | Monthly: Included total, Cursor models, Other models, on-demand $ if enabled. **Weekly: Grok Bot** | 🟢 response shapes verified 2026-10-10 |
| Gemini (app) | https://gemini.google.com/usage | DOM text scraping (the app uses `batchexecute` RPC, not plain JSON) | "Current usage" (short rolling window) + "Weekly limit" | 🟢 page structure verified 2026-10-10 |
| Muse (Meta) | https://muse.ai/ → bottom-left menu → Settings → General (dialog, no URL) | ARIA progress bar in the dialog; background refresh clicks it open (`openSteps`) | Weekly limit for the plan (reported: Power 500M tokens/week, Maximum 3B tokens/week) | 🟢 page structure verified 2026-10-10 |
| Antigravity | none on the web | Planned: local language-server probe (see ROADMAP) | Per-model quota | ⛔ |

## Notes per provider

### Claude
- `parseClaudeUsage` reads every top-level key whose value has a numeric `utilization` (treated as **0–100**) and a `resets_at`. Unknown future keys show up automatically, labeled by key.
- The org is picked as the first with the `chat` capability. Users in several orgs (personal + Team) may need an org picker: see ROADMAP.
- `plan` is guessed from org capabilities and may be null.
- Claude Code (the CLI) shares the same limits as claude.ai, so this covers both.

### Cursor
- DOM scraping is off (`noDom`) because the JSON is verified and DOM meters would duplicate it. The same goes for Claude.
- Dashboard labels map to fields as follows:
  - "Cursor Models (includes Cursor Grok and Composer)" = `autoPercentUsed` (meter `auto`)
  - "Other Models" = `apiPercentUsed` (meter `api`)
- `GET https://cursor.com/api/usage-summary` (same session cookie) returns `billingCycleStart/End`, `membershipType`, and `individualUsage.plan`:
  - `used` / `limit` / `remaining`
  - `breakdown`: `included`, `bonus`, `total`
  - `autoPercentUsed`, `apiPercentUsed`, `totalPercentUsed`
  
  It also returns `individualUsage.onDemand` (`enabled`, `used`, `limit`).
- **Gotcha.** `plan.used/limit` covers only the included dollar amount (cents, e.g. 2000/2000 = $20) and reads 100% while bonus usage remains. Use the `*PercentUsed` fields, which match the dashboard's "You've used N% of your included total usage". v0.2.0 briefly stored a wrong "Plan 100%" meter from the generic extractor; those rows were deleted.

### Gemini
- `/usage` shows two rows, each a label, a "NN% used" leaf element and a reset line, for example:
  - "Current usage · 1% used · Resets at 10:19 AM"
  - "Weekly limit · Resets Oct 13 at 1:19 AM · 0% used"
- The visual bar has no ARIA value or %-width, so the scraper keys off the **"NN% used" text**.
- "Current usage" is classified as `session` (5 h). The real window length isn't documented, so the even-pace marker may be off. Revisit once reset times have been watched over a day.
- An "info" icon ligature appears in the text and is filtered as a non-label.

### Grok Bot (part of Cursor)
- Grok Bot's usage is part of the **Cursor** plan, shown on cursor.com/dashboard/spending:
  - "Grok Bot · Included in Pro · Weekly usage NN% used · Resets <date>"
  - "Grok Bot pauses at the limit until it resets"
- Source: `POST https://cursor.com/api/dashboard/get-sand-usage-status`, body `{}` ("sand" is the internal name). It returns `usagePercent`, `nextResetTimestampUtc` and `currentPeriodStart`, plus upgrade recommendations (Pro+ = "$500 of Grok Bot usage each week").
- From the extension's service worker this POST returns **HTTP 403** (Origin check; confirmed 2026-10-10). Since v0.4.0 a session DNR rule sends `Origin`/`Referer: https://cursor.com` for this one endpoint (`FIRST_PARTY_HEADER_RULES`). The hidden-page fallback doesn't work for Cursor: the framed page loads but makes no usage calls. In that case background refresh opens `/dashboard/spending`, and `hook.js` captures the page's own call. Visiting that page yourself also updates the meter.
- Shown as the `grok-bot` meter (weekly) in the Cursor card. The old grok.com/x.ai provider was removed in v0.3.0.
- The spending page URL can carry a `?for=<auth user id>` parameter. It isn't needed, and it's personal, so don't put it in code or docs.

### Muse (Meta)
- Usage sits in **Settings → General → Usage**. The URL stays `https://muse.ai/`.
  - The bar is `role="progressbar"` with `aria-label` = plan name (e.g. "Free plan"), `aria-valuenow`/`aria-valuemax`.
  - Nearby text: "Weekly limit resets on Oct 14" and "95% used".
- No usage JSON was visible in the page's network entries (`/api/session` has no usage fields); it probably arrives over a streaming or RPC channel. So the source is the DOM.
- **Background refresh** opens https://muse.ai/ in the refresh window, and the collector runs `openSteps`:
  1. click `button[data-testid="hatch-dock-more"]` (aria-label "Settings")
  2. click the menu item whose text is "Settings"
  
  Steps only run in tabs the extension opened for refresh (`refreshTabIds`), never in your own tabs.
- When you open Settings yourself, the collector notices the progress bar and captures it.
- The meter label is the plan name, so it gets a new meter id if you change plans. See ROADMAP: meter id reconciliation.

## Verification loop (do this per provider)

1. Make sure the service is running (`npm start`) and the extension is loaded.
2. In Options, enable **Debug capture**.
3. Open the provider's usage page and wait a few seconds.
4. Look in `~/.tokentracking/debug/`:
   - `*-json.json` files mean JSON interception saw something. Check which file holds the real meters, then tighten `jsonPattern` and, if needed, write a dedicated `parseJson`.
   - `*-dom.json` shows what the scraper found. Check labels and percentages against the page.
5. Add a test in `test/parse.test.js` using a **redacted** copy of the captured payload. Remove emails, names, org ids and anything else personal.
6. Set the provider's `usageUrl` if it was unknown, and mark the row ✅ here with the date.
7. Turn debug capture off.
