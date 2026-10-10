# TokenTracking

One place to see how close you are to the usage limits of your AI subscriptions, and how to pace yourself until they reset.

Supported: **Claude**, **Cursor** (including **Grok Bot**'s weekly limit), **Gemini (app)**, **Muse (Meta)**. Antigravity is planned (see [docs/PROVIDERS.md](docs/PROVIDERS.md) and [docs/ROADMAP.md](docs/ROADMAP.md)).

It's **local-first**. A Chrome extension reads the usage pages you can already see, using the logins already in your browser. A small local service stores the history and works out pacing. No API keys, no accounts, no cloud.

## Features

- **Every limit in one place.** Session (5h), daily, weekly and monthly meters per service, with time until reset.
- **Pacing.** Each meter shows:
  - the *even pace* marker (where you'd be if you spread usage evenly through the window)
  - your current burn rate and projected % at reset
  - when you'd run out at this rate
  - a budget (%/day, or %/hour when less than a day is left)
- **Status at a glance.** Shown as a colored dot plus a label: On pace, Ahead of pace, Will run out before reset, Limit reached.
- **History.** A sparkline per meter, with hover readouts, from every snapshot stored locally in SQLite.
- **Three views.**
  - Web dashboard at http://127.0.0.1:7878 (card and table views, light and dark)
  - Extension popup with a badge showing your highest usage %
  - `npm run status` in the terminal
- **Background refresh** every 15 minutes (configurable), with no visible tabs or windows:
  - Claude and Cursor are fetched directly.
  - Gemini, Muse and the Grok Bot fallback load in an invisible offscreen page (see [docs/SECURITY.md](docs/SECURITY.md) for the trade-off).
  - A minimized-window mode is available in Options.
- **Debug capture** to save raw responses when a provider changes its page, so parsers are easy to fix.

## How data is collected

| Service | Headless refresh (default) | Extension (optional) |
|---|---|---|
| Claude | ✅ JSON from claude.ai | ✅ direct |
| Cursor + Grok Bot | ✅ JSON from cursor.com | ✅ direct |
| Gemini | ✅ reads /usage | while you visit the page |
| Muse | ✅ opens Settings, reads the bar | while you visit Settings |

**Headless refresh** runs inside the local service. Every 15 minutes it starts Chrome invisibly (no window or Dock icon) using its own profile, reads everything, and quits. Nothing runs in between. It needs a one-time login (`npm run browser-login`). The **extension** is optional: it captures while you browse and can cover a service if headless stops working for it.

## Quick start

Requirements: Node.js ≥ 22.13 (uses the built-in `node:sqlite`) and Chrome or another Chromium browser.

```bash
npm start
```

1. Run `npm start` to start the local service. It has no dependencies, so there's nothing to install.
2. Run `npm run browser-login` once. A normal Chrome window opens with tabs for Claude, Cursor, Gemini and Muse. Log in to each, then quit that window with Cmd+Q.
3. Run `npm run refresh` to test. It prints `ok` or `login` per service. After that, the service refreshes by itself every 15 minutes.

Optional: load the Chrome extension.
2. Load the extension:
   1. Open `chrome://extensions` and turn on **Developer mode**.
   2. Click **Load unpacked** and pick the `extension/` folder.
   3. Pin the TokenTracking icon.
3. Make sure you're logged in to the services you use. Then click **Refresh now** in the popup, or just visit each usage page once:
   - Claude: https://claude.ai/new#settings/usage
   - Cursor + Grok Bot: https://cursor.com/dashboard/spending
   - Gemini: https://gemini.google.com/usage
   - Muse: https://muse.ai/ → bottom-left menu → Settings (General tab)
4. Open the dashboard at http://127.0.0.1:7878, or run:

```bash
npm run status
```

After changing extension code, click reload on `chrome://extensions`, then reload any open provider tabs.

### Menu bar app (macOS 13+)

```bash
npm run build:menubar
```

```bash
open build/TokenTracking.app
```

This adds an icon at the top right showing your **most at-risk meter**: the worst pace status first, then the highest %. The gauge icon fills as usage rises. Clicking it opens a compact dashboard with **Refresh now**, **Open dashboard** and **Quit**. It has no Dock icon and reads from the local service, so `npm start` must be running. To launch it at login, add `build/TokenTracking.app` under System Settings → General → Login Items.

### Try it with demo data

```bash
npm run demo
```

```bash
TOKENTRACKING_HOME=.tokentracking-demo npm start
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Run the local service and dashboard on 127.0.0.1:7878 |
| `npm run status` | Print current usage and pacing (`-- --json` for JSON) |
| `npm run browser-login` | Open the headless profile in a normal window to log in (`-- gemini` for one service) |
| `npm run build:menubar` | Build the macOS menu bar app into `build/TokenTracking.app` |
| `npm run refresh` | Run one headless refresh now and print results (`-- claude muse` for some) |
| `npm run demo` | Write fake data to `.tokentracking-demo/` |
| `npm test` | Run the test suite (`node:test`) |

Environment variables:
- `TOKENTRACKING_HOME`: data directory (default `~/.tokentracking`)
- `TOKENTRACKING_PORT`: port (default `7878`; if you change it, update `manifest.json` host permissions and the Options service URL)
- `TOKENTRACKING_HEADLESS=0`: turn headless refresh off
- `TOKENTRACKING_INTERVAL_MIN`: headless refresh interval (default 15, minimum 5)
- `TOKENTRACKING_HEADLESS_SKIP`: comma-separated services to leave to the extension (e.g. `claude`)
- `TOKENTRACKING_CHROME`: Chrome binary path (default `/Applications/Google Chrome.app/…`)
- `TOKENTRACKING_EXTENSION_IDS`: comma-separated extension ids allowed to call the service (default: any `chrome-extension://` origin)

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, data model, pacing math |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Per-service: where usage lives, how it's read, what's verified |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, what data is touched, privacy guarantees |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records (why things are the way they are) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's next: cost-per-token, Antigravity, menu bar app, … |
| [AGENTS.md](AGENTS.md) | Orientation for AI coding agents / new contributors |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Caveats

None of the usage pages or endpoints this reads are official APIs, so they can change without notice. When a meter stops updating:
1. Turn on debug capture in Options.
2. Revisit the usage page.
3. Fix the parser, following [AGENTS.md](AGENTS.md).

This is meant for personal use, reading your own usage with your own logged-in session.
