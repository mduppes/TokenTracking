# TokenTracking landing page

Standalone React + TypeScript + Tailwind site, built with Vite. The app and local service remain dependency-free. No tracker database, browser profile, logins or real usage belong in this directory.

## Development

Node 22.13+ recommended (same as the project). From the repository root:

```sh
npm ci --prefix website
npm run dev --prefix website
npm run build --prefix website
npm run preview --prefix website
```

The dev server prints its localhost URL. The production build performs TypeScript checks and emits `website/dist`. No server, database or environment variables are needed for hosting.

## Assets and release updates

```sh
npm run screenshots
npm run sync:assets --prefix website
npm run build --prefix website
```

Screenshots come exclusively from demo data. `npm run screenshots` refreshes web PNGs and builds `build/screenshot-preview/TokenTrackingDemo.app`. Capture that demo app’s panel and Settings with computer-use tools or manually into `docs/images/panel-dark.png` and `docs/images/settings-dark.png`, then sync the assets. Never capture the production app. The native panel and Settings are rendered from the current Swift source, so the site explicitly distinguishes them from the older packaged preview. Do not upload real captures.

Update `src/release.ts` when a new GitHub release is published. Verify both DMG URLs and checksum assets; update README download links at the same time. Remove the “Settings will ship in the next preview” copy in `src/App.tsx` only once those features are packaged in the linked release.

## Deploy

For a static host, set:

- Root directory: `website`
- Install command: `npm ci`
- Build command: `npm run build`
- Publish/output directory: `dist`

The site uses root-relative assets and is intended for a domain root. For GitHub Pages under a repository subpath, configure Vite’s `base` and adjust asset URLs first. No SPA rewrite is required: the page uses anchor links, not client-side routes. Hosting/domain selection is pending; no deployment has been created.

All images, SVGs, CSS and JavaScript are served locally by the site. External links go to GitHub download assets, release notes and documentation. There are no runtime analytics, remote fonts or calls to the local usage service.
