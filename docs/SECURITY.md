# Security & privacy

## Principles

1. **Nothing leaves your machine.** The only network traffic is the headless browser visiting the provider sites you select, plus local traffic on `127.0.0.1`. There is no telemetry, analytics or cloud sync.
2. **No secrets handled by our code** (one scoped exception, below). There are no API keys and no stored passwords. Your logins live inside a dedicated Chrome profile, and Chrome uses them. Our code never reads cookies or login tokens.
3. **Read-only.** We only read usage. Nothing changes settings, sends messages or touches billing.
4. **Minimal storage.** Usage history contains meters (label, %, reset time, plan name); local settings contain service choices and completion state.

## What data is touched

| Data | Where | Retention |
|---|---|---|
| Setup choices (no credentials) | `~/.tokentracking/setup.json` | Until changed or deleted |
| Usage meters | `~/.tokentracking/tokentracking.db` | Forever (append-only; delete the file to wipe) |
| Last refresh result per provider (ok / login / error message) | `~/.tokentracking/headless-status.json` | Overwritten each run |
| Provider logins (cookies) | `~/.tokentracking/browser-profile/` (a Chrome profile) | Until you log out or delete the folder |
| Service log | `~/.tokentracking/service.log` | Grows; delete any time |

File permissions: the data dir and profile are created `0700`; the DB, status and setup files are `0600`.

## Headless refresher

- **Separate profile.** A dedicated Chrome profile at `~/.tokentracking/browser-profile` holds logins made through setup’s Open browser action (or `npm run browser-login` for source users). It's a normal Chrome profile on disk, so protect it like your browser profile. To wipe it, delete the folder.
- **No network port.** Chrome is controlled over a **pipe** (`--remote-debugging-pipe`), not a debugging port, so no other process or website can attach to it.
- **Short-lived.** Chrome runs only during a refresh (a few seconds per provider). It's then told to quit, and killed if it lingers.
- **Read-only.** Pages are only read. The one click sequence (Muse) opens Settings.
- **Identity.** At the user's request, the browser presents as their normal Chrome (User-Agent, Client Hints, `navigator.webdriver`, languages, screen). It's a personal, low-frequency read of the user's own accounts. Keep the interval at 15 minutes or more.

## Antigravity (local language server, ADR-011)

- **The exception.** Antigravity's quota is only available from the desktop app's local language server, which requires a per-session CSRF token taken from the server's own command-line arguments. TokenTracking reads it with `ps` at refresh time and uses it for **one read-only request to 127.0.0.1** (`GetUserStatus`).
- **Handling.** The token is never logged, stored, written to disk or sent anywhere else. It's a local session token for that process, not your Google login, and it changes whenever Antigravity restarts.
- **TLS.** The server uses a self-signed certificate, so certificate verification is disabled for that localhost request only.
- **Opting out.** Set `TOKENTRACKING_HEADLESS_SKIP=antigravity`.

## Service choices

Fresh installs collect nothing until services are selected in setup. Deselecting a service stops future checks; it does not erase existing history or Chrome logins. A check already underway may finish. Existing installations keep their enabled readers when upgrading; use Settings → Service setup & privacy to change them. Hiding a menu item only changes display. Invalid setup files enable no readers.

## Local service

- Binds to **127.0.0.1 only**.
- **DNS-rebinding guard.** Requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` are rejected (403).
- **Origin check.** Requests carrying an `Origin` header must come from the dashboard itself (`http://127.0.0.1:<port>`). Any other website or browser extension gets 403, so web pages can't read your usage or trigger refreshes. Non-browser clients (the menu bar app, `curl`) send no Origin and are allowed, since they already run as you.
- **Setup preferences.** `POST /api/setup` requires JSON, supported service ids and at least one selected service when completing setup. It uses the same local request gates.
- **Login trigger.** `POST /api/login` only accepts a known, selected provider id and only opens that provider's fixed login URL in the TokenTracking browser. It sits behind the same Host/Origin gate as everything else.
- **Refresh trigger.** `POST /api/refresh` requires `application/json` (≤ 16 KB), which forces a CORS preflight for any cross-site attempt.
- **Static files** are served only from `server/public/`, with path traversal blocked. The dashboard has a CSP of `default-src 'self'` and loads nothing from CDNs.
- SQL uses prepared statements only.
- **Residual risk.** Other software running as your user can read `~/.tokentracking` (including the browser profile) or call the service. That's the same trust boundary as the rest of your home directory.

## Menu bar app

- Source builds are signed with a **self-signed local certificate** ("TokenTracking Local Signing", created by `scripts/create-signing-cert.sh` in your login keychain and trusted for code signing on this Mac only). Without it, builds are ad-hoc signed. It isn't notarized. Remove the certificate in Keychain Access any time.
- Public downloads from preview.3 are signed with Developer ID and notarized by Apple. Signing and notarization use publisher tooling; the app never reads signing keys or notarization credentials.
- Talks only to the local service.
- Starts the service as a child process. The service exits when the app does, including on force quit (`TOKENTRACKING_PARENT_PID`).
- `NSAllowsLocalNetworking` permits plain HTTP to 127.0.0.1 only.

## Chrome and macOS App Management

TokenTracking does not need **App Management** (permission to update or delete other apps). Leave it off. Both the background refresher and login window disable Chrome’s `MacAppCodeSignClone` feature for their own Chrome process. This does not change the normal browser’s settings, grant permissions, or disable Chrome’s sandbox or signature verification.

Chrome 155’s [clone manager](https://chromium.googlesource.com/chromium/src/+/refs/tags/155.0.8059.85/chrome/browser/mac/code_sign_clone_manager.mm) creates a temporary copy of its bundle and hard-links its installed executable to keep its running code available across Chrome updates. macOS attributes that bundle operation to the parent app, TokenTracking. A controlled headless comparison on 2026-10-20, using disposable profiles and a local-only page, recorded an App Management request with the default launch and none with cloning disabled; both could read the page. Since these browser instances are short-lived, skipping this update-maintenance copy is appropriate. If Chrome is updated during a run and exits, retry the refresh.

## History

- **v0.1–0.4** used a Chrome extension. Its hidden-refresh mode removed `X-Frame-Options`/CSP headers in an invisible frame (ADR-008), and it set a first-party `Origin` on one Cursor request.
- **v0.5** removed the extension entirely (ADR-010). No header modification of any kind remains.

## Terms of service

These are unofficial, undocumented endpoints and pages. Reading your own usage with your own session for personal use is low risk. Polling aggressively, or redistributing this as a product, is a different matter. Keep the refresh interval at 15 minutes or more (the minimum allowed is 5).

## Out of scope (deliberately)

- Reading CLI credential files or the macOS Keychain (Claude Code OAuth, Gemini CLI, Antigravity tokens): that would mean handling secrets (ADR-002).
- Pay-as-you-go API billing (would require admin API keys).
