# Security & privacy

## Principles

1. **Nothing leaves your machine.** The extension talks only to the provider sites you're already using and to `127.0.0.1`. There is no telemetry, analytics or cloud sync.
2. **No secrets handled by our code.** There are no API keys, and no stored passwords, cookies or tokens. Requests to provider sites run with the browser's existing session; the extension never reads cookie values.
3. **Read-only.** We only read usage. Nothing changes settings, sends messages or touches billing.
4. **Minimal capture.** Only usage-shaped data is forwarded and stored.

## What data is touched

| Data | Where it goes | Retention |
|---|---|---|
| Usage meters (label, %, reset time, plan name) | `chrome.storage.local` (latest + offline queue), then `~/.tokentracking/tokentracking.db` | Forever (append-only; delete the file to wipe) |
| Raw usage JSON / scraped meter text | **Only when Debug capture is on**: `~/.tokentracking/debug/*.json` | Last 50 files |
| Everything else the page loads | Not forwarded. `hook.js` only passes same-origin JSON whose **path** matches usage keywords, with query strings dropped. | n/a |

Raw debug captures can include account details such as email, org name or org id. Debug capture is **off by default** and meant to be switched on briefly. Redact captures before committing them as test fixtures.

File permissions: the data dir is created `0700` and the DB and debug files `0600`.

## Extension

- **Host permissions** are limited to the provider domains and the local service. There's no `<all_urls>`, `cookies`, `tabs`, `webRequest` or `scripting` permission. `declarativeNetRequestWithHostAccess` is used only for the hidden-refresh rule below.
- **MAIN-world hook** (`content/hook.js`) wraps `fetch`/XHR on provider sites only. It never changes requests or responses: it clones the response and reads the copy. Every failure is swallowed so the site keeps working.
- **Spoofing.** Page scripts could post fake capture messages (`window.postMessage`). The worst outcome is a wrong number on your own dashboard, so this is accepted.
- **Hidden refresh (default, ADR-008).** Usage pages load in an iframe inside the extension's invisible offscreen document. To allow that, a *session* declarativeNetRequest rule removes the `X-Frame-Options` and `Content-Security-Policy` response headers, but only for:
  - sub-frames
  - that belong to no tab (extension pages only, never your tabs)
  - on the provider hosts

  **Trade-off:** that hidden copy runs without its CSP, which normally guards against injected scripts, for the few seconds it's loaded. The user approved this on 2026-10-10. Set **Options → Load pages → in a minimized window** to avoid it entirely; that mode modifies no headers. Permissions added: `offscreen`, `declarativeNetRequestWithHostAccess` (it only acts on hosts the extension already has access to).
- **First-party headers on our own requests.** Some provider endpoints reject the extension's `Origin`, e.g. Cursor's `get-sand-usage-status` (Grok Bot) answers 403. A session DNR rule sets `Origin`/`Referer` to the provider's own site, but only on the endpoints listed in `FIRST_PARTY_HEADER_RULES` and only for requests outside any tab (`tabIds: [TAB_ID_NONE]`: the extension's own background requests). It's the same read the provider's dashboard makes with your session; page and tab traffic is untouched. The user approved this on 2026-10-10.
- **Window refresh** (`refreshMode: 'window'`) opens the provider's own usage page in a minimized window. For providers whose usage is inside a dialog (Muse), it clicks the menu and Settings items to open it. These clicks happen only in pages the extension opened for refresh (its own hidden frame or minimized tab), and only open views. It's the same request you'd make by visiting the page. Turn it off in Options to only capture when you visit pages yourself.

## Local service

- Binds to **127.0.0.1 only**.
- **DNS-rebinding guard.** Requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` are rejected (403).
- **Origin allow-list.** Requests with an `Origin` header must come from a `chrome-extension://` origin or the dashboard itself. Any other website gets 403, so web pages can't post fake data or read your usage. Set `TOKENTRACKING_EXTENSION_IDS` to pin the exact extension id.
- `POST` bodies must be `application/json` (≤ 512 KB). This also forces a CORS preflight for cross-site attempts.
- **Strict validation.** Provider and meter ids are restricted to `[a-z0-9._-]`, strings are length-limited, numbers clamped, and timestamps more than 5 minutes in the future are rejected. SQL uses prepared statements only.
- **Static files** are served only from `server/public/`, with path traversal blocked. The dashboard has a CSP of `default-src 'self'` and loads nothing from CDNs.
- **Residual risk.** Other software running as your user can read `~/.tokentracking` or call the service. That's the same trust boundary as the rest of your home directory.

## Headless refresher

- **Separate profile:** a dedicated Chrome profile at `~/.tokentracking/browser-profile` (dir `0700`) holds the logins you make with `npm run browser-login`. It's a normal Chrome profile on disk: protect it like your browser profile. To wipe it, delete the folder.
- **No network port:** Chrome is controlled over a **pipe** (`--remote-debugging-pipe`), not a debugging port, so no other process or website can attach to it.
- **Short-lived:** Chrome runs only during a refresh (about 20–30 s) and is then told to quit (and killed if it lingers).
- **Read-only:** pages are only read. The one click sequence (Muse) opens Settings.
- **Identity:** the browser presents as your normal Chrome (User-Agent, Client Hints, `navigator.webdriver`), at your request, to avoid bot checks on a personal, low-frequency read of your own accounts. Keep the interval at 15 minutes or more.
- **Dashboard trigger:** `POST /api/refresh` sits behind the same Host/Origin gate as everything else, so web pages can't trigger it.

## Terms of service

These are unofficial, undocumented endpoints and pages. Reading your own usage with your own session for personal use is low risk. Polling aggressively, or redistributing this as a product, is a different matter. Keep the refresh interval at 15 minutes or more (the minimum allowed is 5).

## Out of scope (deliberately)

- Reading CLI credential files or the macOS Keychain (Claude Code OAuth, Gemini CLI, Antigravity tokens). That would give more precise data, but it means handling secrets, and the user chose the extension-only route. See DECISIONS ADR-002 and ROADMAP.
- Pay-as-you-go API billing (would require admin API keys).
