# Providers

All providers are read by the headless refresher (`server/src/headless/refresh.js`, `TASKS`), from inside each provider's own site, using the dedicated logged-in Chrome profile.

Mac packaging check (2026-10-13): the release bundles the same provider readers; no live provider reads were rerun for distribution. Verification dates below remain the dates of actual provider checks.

Status legend: ✅ verified end-to-end with headless · ⛔ not implemented.

| Provider | Page loaded | How usage is read | Meters | Status |
|---|---|---|---|---|
| Claude | `https://claude.ai/new` | In-page `GET /api/organizations` → `GET /api/organizations/{uuid}/usage` → `parseClaudeUsage` | Session (5h), weekly (all models), weekly Opus/Sonnet when present | ✅ 2026-10-10 |
| Cursor | `https://cursor.com/dashboard/spending` | In-page `GET /api/usage-summary` → `parseCursorUsage` | Monthly: included total, Cursor models, other models, on-demand $ if enabled | ✅ 2026-10-10 |
| Grok Bot (Cursor) | same page | In-page `POST /api/dashboard/get-sand-usage-status` `{}` → `parseCursorGrokBot` | Weekly | ✅ 2026-10-10 |
| Gemini (app) | `https://gemini.google.com/usage` | DOM: `scrape-dom.js` ("NN% used" text) | "Current usage" (short rolling window) + "Weekly limit" | ✅ 2026-10-10 |
| OpenAI (ChatGPT) | `https://chatgpt.com/settings/usage?tab=overview` | DOM: `scrape-dom.js` on the rendered usage overview | 5-hour, weekly, plus a generic "Usage remaining" row under review | ⏳ signed-in capture observed 2026-10-13; meter layout verification pending |
| Muse (Meta) | `https://muse.ai/` | DOM: `MUSE_OPEN_STEPS` (menu → Settings), then the dialog's ARIA progress bar | Weekly limit for the plan | ✅ 2026-10-10 |
| Antigravity | none on the web; desktop app must be running | Local language server `GetUserStatus` (127.0.0.1, CSRF token from its process args; ADR-011) → `parseAntigravityStatus` | One meter per quota pool, e.g. "Claude + GPT-OSS models" (weekly), "Gemini models" (~5h) | ✅ 2026-10-10 |

**Logged-out detection** (`loggedOut(href, text)`), as observed 2026-10-10:

| Provider | What logged out looks like |
|---|---|
| Claude | redirect to `/login` |
| Cursor | redirect to `authenticator.cursor.sh` |
| Gemini | redirect to `/app` with "Sign in" |
| Muse | same URL, page text "Log in or create an account" |
| OpenAI | auth redirect, or guest page on `chatgpt.com` with **Log in** / **Sign in** and no usage section |

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

### OpenAI (ChatGPT)
- The user-provided usage overview is `https://chatgpt.com/settings/usage?tab=overview`.
- The task reads the rendered page through the shared DOM scraper in the dedicated Chrome profile. It does not call private endpoints or inspect browser credentials.
- The page's current meter labels, reset wording, and signed-in behavior still need end-to-end verification with the user's ChatGPT subscription. Meters are only recorded when the page exposes a percentage or valued progress bar recognized by `scrape-dom.js`.
- Browser warnings offer **Open browser** even when the task reports an error, so the user can inspect the dedicated profile's session. Quit that window with Cmd+Q to trigger another refresh.
- The dashboard and native panel show an empty OpenAI card even before its first reading. If the login browser remains open, refresh reports that it skipped browser usage and asks the user to quit that Chrome window with Cmd+Q.
- **Verified guest state (2026-10-13):** the dedicated profile redirects to `/` on `chatgpt.com`, displays a Log in button, and exposes no progress bars or meters.
- **Signed-in capture (2026-10-13):** stored 5-hour and weekly limits with reset times, plus a generic "Usage remaining" row. That generic row may duplicate the 5-hour meter; verify the rendered layout and add a redacted fixture before calling the meter mapping fully verified.

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
- **Slow agent connection (2026-10-11):** after load, the agent shows "Connecting…", sometimes for minutes, and possibly never while you're out of tokens. Until it connects, Settings → General has **no Usage section**. The task:
  1. waits for the app shell (`hatch-dock-more`), then 3 s, then up to 2 min for "Connecting…" to clear;
  2. if it connected, reads the Usage bar;
  3. otherwise, falls back to the chat notice "You've reached your usage limit … Your full weekly usage will reset at 1:36 AM on Wednesday, October 14." (`parseMuseLimitNotice`: 100%, with the reset time);
  4. otherwise reports an `error` ("still connecting") that retries next refresh.
- **Meter id:** `weekly` ("Weekly limit"). The bar's label is the plan name, which is reported as `plan` instead, so changing plans doesn't create a new meter. Older `free-plan` rows were migrated.

### Antigravity
- **Process.** `…/Antigravity.app/Contents/Resources/bin/language_server --standalone --override_ide_name antigravity --subclient_type hub --https_server_port 0 --csrf_token <token> …` (app 2.22.0). The port is random, so it's found with `lsof`. It listens on two ports; the first answers HTTPS.
- **Request.** `POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`
  - headers: `content-type: application/json`, `connect-protocol-version: 1`, `x-codeium-csrf-token: <token>`
  - body: `{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}`
- **Response.** `userStatus.cascadeModelConfigData.clientModelConfigs[]` = `{ label, modelOrAlias.model, quotaInfo: { remainingFraction (0–1), resetTime } }`, plus `userStatus.planStatus.planInfo.planName`. Models in the same pool report identical values.
  - Observed pools: Claude Opus/Sonnet + GPT-OSS share a weekly pool; all Gemini models share a ~5h pool.
- **Exhausted pool (2026-10-12):** when a pool is fully used, `quotaInfo` has only `resetTime`; `remainingFraction` is omitted (zero values are left out of the JSON). The parser treats that as 0% remaining, i.e. 100% used. Models with no `quotaInfo` fields at all are ignored.
- **Window guess:** `session` if the reset is ≤6h away, `daily` if ≤26h, else `weekly`.
- **"Antigravity IDE".** A separate app with no language server of its own was also running; only the "Antigravity" app's server is used.

## Verification loop (when a provider breaks)

1. Run `npm run refresh -- <provider>` and read the message:
   - `login`: run `npm run browser-login -- <provider>` and log in again.
   - `error`: the page or API changed.
2. Debug by adapting the snippet in AGENTS.md ("Debug a provider in headless"). It loads the page with the real profile, dumps a few facts and saves a screenshot via `page.screenshot()`.
3. Fix the task in `refresh.js`, the parser in `lib/providers.js`, or the reader in `lib/scrape-dom.js`.
4. Add a test with a **redacted** payload (`test/parse.test.js`) or an HTML fixture (`test/headless.test.js`).
5. Update this table with the date.
