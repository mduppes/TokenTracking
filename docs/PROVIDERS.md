# Providers

All providers are read by the headless refresher (`server/src/headless/refresh.js`, `TASKS`), from inside each provider's own site, using the dedicated logged-in Chrome profile.

Release and screenshot check (2026-10-20): preview.4 keeps the provider readers and schema v5 from preview.2 and disables Chrome’s app-clone maintenance during refresh and login. A local-only Chrome comparison verified the permission fix; no live provider sessions were used. Refreshed assets use throwaway demo data only; no live provider reads were rerun for release preparation. Verification dates below remain the dates of actual provider checks.

Menu bar customization (2026-10-13): all seven service slots, including Gemini and Cursor’s separate Grok Bot limit, are selectable. Visibility affects only the menu bar; provider collection and verification dates below are unchanged.

Status legend: ✅ verified end-to-end with headless · ⛔ not implemented.

| Provider | Page loaded | How usage is read | Meters | Status |
|---|---|---|---|---|
| Claude | `https://claude.ai/new` | In-page `GET /api/organizations` → `GET /api/organizations/{uuid}/usage` → `parseClaudeUsage` | Session (5h), weekly (all models), weekly Opus/Sonnet when present | ✅ 2026-10-10 |
| Cursor | `https://cursor.com/dashboard/spending` | In-page `GET /api/usage-summary` → `parseCursorUsage` | Monthly: included total, Cursor models, other models, on-demand $ if enabled | ✅ 2026-10-10 |
| Grok Bot (Cursor) | same page | In-page `POST /api/dashboard/get-sand-usage-status` `{}` → `parseCursorGrokBot` | Weekly | ✅ 2026-10-10 |
| Gemini (app) | `https://gemini.google.com/usage` | DOM: `scrape-dom.js` ("NN% used" text) | "Current usage" (short rolling window) + "Weekly limit" | ✅ 2026-10-10 |
| Muse (Meta) | `https://muse.ai/` → Settings → General | DOM progress bar, with bounded warmup wait and current limit-notice fallback | Weekly | ✅ 2026-10-10; warmup/reset regressions fixture-tested 2026-10-14; live warmup monitoring pending |
| OpenAI (ChatGPT) | `https://chatgpt.com/settings/usage?tab=overview` | DOM: `scrape-dom.js` on the rendered usage overview | 5-hour limit ("5-hour-limit"), weekly limit ("weekly-limit") | ✅ verified (2026-10-17) |
| Antigravity | none on the web; desktop app must be running | Local language server `GetUserStatus` (127.0.0.1, CSRF token from its process args; ADR-011) → `parseAntigravityStatus` | The three groups shown in Antigravity's Settings: "Claude and GPT models", "Gemini models", and "Gemini 4 Argon" (fixed by model name) | ✅ 2026-10-16 |

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
- The overview displays quota meters under **Plan limits**: "5-hour limit" and "Weekly limit", each with a `<progress>` bar and percentage remaining text ("100% left", "17% left").
- Browser warnings offer **Open browser** even when the task reports an error, so the user can inspect the dedicated profile's session. Quit that window with Cmd+Q to trigger another refresh.
- The dashboard and native panel show an empty OpenAI card even before its first reading. If the login browser remains open, refresh reports that it skipped browser usage and asks the user to quit that Chrome window with Cmd+Q.
- **Loading/login check (2026-10-13):** waits up to 60 seconds for usage meters rather than rejecting the initial guest shell after 2.5 seconds. Login is reported only if the final rendered state is an auth/login page or shows a standalone Log in / Sign in action without usage. A loading timeout or unrelated error page reports an error.
- **Verified guest state (2026-10-13):** the dedicated profile redirects to `/` on `chatgpt.com`, displays a Log in button, and exposes no progress bars or meters.
- **Signed-in capture and verification (2026-10-17):**
  - Both progress bars on `chatgpt.com` carry `aria-label="Usage remaining"`. `scrape-dom.js` treats generic labels like "Usage remaining" as non-identifying and reads the card's visible heading ("5-hour limit", "Weekly limit") instead of generating duplicate "Usage remaining" meters.
  - The "Recent plan usage" breakdown section includes tab buttons ("5-hour", "Weekly") and a 100% activity total. `scrape-dom.js` ignores text percentages that lack both a reset indicator and "used/left/remaining" keywords, preventing spurious "Weekly" 100% MAX readings.
  - Database migration v5 deletes legacy `weekly` and `usage-remaining` rows for OpenAI. Redacted fixture test in `test/headless.test.js`.

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
- **Slow agent connection / warmup (2026-10-11, updated 2026-10-14):** after load, the agent shows "Connecting…" or “is warming up” (confirmed by the user’s screenshot), sometimes for minutes. Settings → General may have **no Usage section**, even after the status label disappears. The task:
  1. polls for up to three minutes, waiting for visible warmup/connection labels to clear before opening Settings;
  2. continues polling the Usage bar within that allowance, even when no loading label remains, and records a rendered 0% normally;
  3. only at timeout considers the chat notice "You've reached your usage limit … Your full weekly usage will reset at …" (`parseMuseLimitNotice`: 100%, strictly future reset within seven days);
  4. otherwise reports a loading `error`, preserving the last confirmed reading and retrying next refresh. Fake-clock tests cover multi-minute transitions, missing usage, timeout, stale notices and context reloads; a real-Chrome fixture verifies the visible warming label and eventual zero meter. Live warmup duration remains under observation.
- **Meter id:** `weekly` ("Weekly limit"). The bar's label is the plan name, which is reported as `plan` instead, so changing plans doesn't create a new meter. Older `free-plan` rows were migrated.
- **Reset regression (2026-10-14):** post-reset DOM snapshots correctly recorded 0%, then historical chat notices replaced them with 100%. The generic date parser rolled the expired October 14 notice into next year. `parseMuseLimitNotice` now requires a known reset strictly in the future and no more than seven days away; invalid notices produce no snapshot, preserving the last confirmed usage. Regression tests include expired and unknown dates, the weekly bound and New Year. Live Settings → General currently sometimes omits Usage even without “Connecting…”; that reports usage unavailable and retries, rather than declaring the old chat notice current or inventing a zero reading.

### Antigravity
- **Process.** `…/Antigravity.app/Contents/Resources/bin/language_server --standalone --override_ide_name antigravity --subclient_type hub --https_server_port 0 --csrf_token <token> …` (app 2.22.0). The port is random, so it's found with `lsof`. It listens on two ports; the first answers HTTPS.
- **Request.** `POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus`
  - headers: `content-type: application/json`, `connect-protocol-version: 1`, `x-codeium-csrf-token: <token>`
  - body: `{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}`
- **Response.** `userStatus.cascadeModelConfigData.clientModelConfigs[]` = `{ label, modelOrAlias.model, quotaInfo: { remainingFraction (0–1), resetTime } }`, plus `userStatus.planStatus.planInfo.planName`. Models in the same pool report identical values.
  - Observed pools: Claude Opus/Sonnet + GPT-OSS share a weekly pool; Gemini Flash/Pro share a session/daily pool; Gemini 4 Argon has its own dedicated weekly pool.
- **Exhausted pool (2026-10-12):** when a pool is fully used, `quotaInfo` has only `resetTime`; `remainingFraction` is omitted (zero values are left out of the JSON). The parser treats that as 0% remaining, i.e. 100% used. Models with no `quotaInfo` fields at all are ignored.
- **Full pools look identical (2026-10-15, updated 2026-10-16):** after the Claude pool reset, every model reported `remainingFraction: 1` with the same rolling `resetTime` (now + 5h). The response has no pool id, so pools can't be told apart by value. The parser uses the same fixed groups as Antigravity's Settings instead: models with "Argon" in their label (`pool-gemini-argon`, "Gemini 4 Argon"), models whose label starts with "Gemini" (`pool-gemini`, "Gemini models"), and everything else (`pool-claude-gpt`, "Claude and GPT models").
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
