<p align="center"><img src="docs/images/icon.png" width="128" alt="TokenTracking app icon: a usage ring with clock hands"></p>

# TokenTracking

One place to see how close you are to the usage limits of your AI subscriptions, and how to pace yourself until they reset. It lives in your macOS menu bar.

Supported: **Claude**, **Cursor** (including **Grok Bot**'s weekly limit), **Gemini (app)**, **Muse (Meta)**, and **Antigravity** (per quota pool, while the app is running). See [docs/PROVIDERS.md](docs/PROVIDERS.md).

It's **local-first**:
- **Refresh:** every 15 minutes a headless Chrome (no window, no Dock icon) uses its own logged-in profile to read each service's usage, then quits. Nothing runs in between.
- **Storage:** a small local service stores the history and works out pacing.
- **Antigravity:** read from the desktop app's own local server while it's running (no browser; see [SECURITY](docs/SECURITY.md)).
- **Display:** a menu bar app shows the result.

No API keys, no accounts, no cloud, no browser extension.

<p align="center">
  <img src="docs/images/menubar.png" width="440" alt="Menu bar: one icon and % used per service, in light and dark menu bars">
</p>

<p align="center">
  <img src="docs/images/panel-dark.png" width="300" alt="Menu bar panel: stale notice, resets-next list and meters with countdown pills">
  &nbsp;
  <img src="docs/images/dashboard-light.png" width="520" alt="Dashboard: resets-next list and per-service cards with usage bars, even-pace markers, countdowns and sparklines">
</p>

<sub>Screenshots use demo data (`npm run screenshots`).</sub>

## Features

- **Every limit in one place.** Session (5h), daily, weekly and monthly meters per service, with time until reset.
- **Pacing.** Each meter shows:
  - the *even pace* marker (where you'd be if you spread usage evenly through the window)
  - your current burn rate and projected % at reset
  - when you'd run out at this rate
  - a budget (%/day, or %/hour when less than a day is left)
- **When it frees up.** Every meter has a countdown pill to its reset, and a "Resets next" list shows what frees up soonest across all services.
- **Status at a glance.** Shown as a colored dot plus a label: On pace, Ahead of pace, Will run out before reset, Limit reached.
- **History.** A sparkline per meter, with hover readouts, from every snapshot stored locally in SQLite.
- **Menu bar app:**
  - **Title:** one icon and % per service, e.g. `✳74 ➚70 ✕86 Ⓜ97 ⇧51`. Each number is that service's worst meter, `––` means at the limit, and hovering shows details.
  - **Click it** for a compact dashboard with Refresh now / Open dashboard / Quit.
  - **Lifecycle:** it starts and stops everything it needs.
- **Also:** the full dashboard at http://127.0.0.1:7878 (card and table views, light and dark) and `npm run status` in the terminal.
- **Stale and login notices.** Services whose data is stale (missed about 2 refreshes) are listed at the top with the reason, and an expired login tells you to run `npm run browser-login`.

## Quick start

Requirements: macOS 13+, Node.js ≥ 22.13 (for the built-in `node:sqlite`), Google Chrome, and the Xcode command line tools (for `swiftc`). There are no npm dependencies, so there's nothing to install.

0. **Get the code:**
   ```bash
   git clone https://github.com/mduppes/TokenTracking.git && cd TokenTracking
   ```
1. **Log in once** in TokenTracking's own Chrome profile. A normal Chrome window opens with tabs for Claude, Cursor, Gemini and Muse. Log in to each, then **quit that window with Cmd+Q**.
   ```bash
   npm run browser-login
   ```
2. **Check it works.** It prints `ok` or `login` per service.
   ```bash
   npm run refresh
   ```
3. **Build the menu bar app:**
   ```bash
   npm run build:menubar
   ```
4. **Open it:**
   ```bash
   open build/TokenTracking.app
   ```

### The menu bar app

- **What it shows:** one icon per service, each with a digit for that service's worst meter:
  - **Icons:** ✳ Claude, ➚ Cursor, ✕ Grok Bot, Ⓜ Muse, ⇧ Antigravity. Gemini is only on the dashboard (its limits rarely matter); change `MenuBarGlyphs.services` to pick your own.
  - **The number** is the % used (0–99), `––` = at the limit, `??` = no reading yet.
  - **Hover** for exact numbers and the most at-risk meter. Click for the compact dashboard.
- **It's the only thing you run.** Opening it starts the local service in the background (and restarts it if it dies). Quitting it stops the service, and the service also exits by itself if the app is force-killed. Service logs go to `~/.tokentracking/service.log`.
- **Start at login (optional):** add `build/TokenTracking.app` under System Settings → General → Login Items. That's a one-time step, because rebuilding updates the app in place.
- **Moving things:** the paths to this project and to `node` are baked in at build time, so re-run `npm run build:menubar` if you move the project or change Node versions.
- **Can't see the icon?** macOS hides menu bar icons in two cases:
  - **The app isn't allowed yet.** Recent macOS starts new menu bar apps switched off. Turn **TokenTracking** on under **System Settings → Menu Bar → Allow in the Menu Bar**.
  - **The menu bar is full**, common on a MacBook with a notch. Turn off other items or Cmd-drag them out.

  While the icon is hidden, TokenTracking shows a **Dock icon** and the same panel in a small window, with a button to that settings page. When the icon appears, it switches back by itself.

### Try the UI with demo data

```bash
npm run demo
```

```bash
TOKENTRACKING_HOME=.tokentracking-demo TOKENTRACKING_HEADLESS=0 npm start
```

## Commands

| Command | What it does |
|---|---|
| `npm run build:menubar` | Build the macOS menu bar app into `build/TokenTracking.app` |
| `npm run browser-login` | Open the headless profile in a normal window to log in (`-- gemini` for one service) |
| `npm run refresh` | Run one headless refresh now and print results (`-- claude muse` for some) |
| `npm start` | Run the local service and dashboard on 127.0.0.1:7878 without the app |
| `npm run status` | Print current usage and pacing (`-- --json` for JSON) |
| `npm run demo` | Write fake data to `.tokentracking-demo/` |
| `npm run build:icon` | Re-render `assets/icon.svg` into `menubar/AppIcon.icns` and `docs/images/icon.png` |
| `npm run screenshots` | Regenerate `docs/images/` from demo data (headless Chrome + swift) |
| `npm test` | Run the test suite (`node:test`, including real headless Chrome) |

Environment variables:
- `TOKENTRACKING_HOME`: data directory (default `~/.tokentracking`)
- `TOKENTRACKING_PORT`: port (default `7878`)
- `TOKENTRACKING_HEADLESS=0`: turn headless refresh off
- `TOKENTRACKING_INTERVAL_MIN`: refresh interval (default 15, minimum 5)
- `TOKENTRACKING_HEADLESS_SKIP`: comma-separated services to skip (e.g. `muse`)
- `TOKENTRACKING_CHROME`: Chrome binary path (default `/Applications/Google Chrome.app/…`)
- `TOKENTRACKING_URL`: service URL for the menu bar app (default `http://127.0.0.1:7878`)

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, data model, pacing math |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Per-service: where usage lives, how it's read, what's verified |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, what data is touched, privacy guarantees |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records (why things are the way they are) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's next: cost-per-token, Antigravity, … |
| [AGENTS.md](AGENTS.md) | Orientation for AI coding agents / new contributors |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

## Caveats

None of the usage pages or endpoints this reads are official APIs, so they can change without notice. When a meter stops updating, run `npm run refresh -- <service>` and follow the verification loop in [docs/PROVIDERS.md](docs/PROVIDERS.md).

This is meant for personal use, reading your own usage with your own logged-in session. Keep the refresh interval reasonable (15 minutes by default).

## License

[MIT](LICENSE)

## Disclaimer

TokenTracking is an independent personal project. It is not affiliated with, endorsed by, or supported by Anthropic, Anysphere (Cursor), xAI, Google, or Meta. Product names are trademarks of their respective owners. It relies on undocumented web pages and endpoints that may change or break at any time, and using it may be subject to each service's terms. Use at your own risk.
