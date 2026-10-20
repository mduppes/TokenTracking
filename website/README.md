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

The color palette follows `assets/icon.svg` (forest green `#04342C`, teal `#085041`, mint `#5DCAA5` and pale mint `#E1F5EE`) and the dashboard’s warm neutral surfaces. Accent tokens live in `src/style.css`.

## Assets and release updates

```sh
npm run screenshots
npm run sync:assets --prefix website
npm run build --prefix website
```

Screenshots come exclusively from demo data. `npm run screenshots` refreshes web PNGs and builds `build/screenshot-preview/TokenTrackingDemo.app`. Capture that demo app’s panel and Settings with computer-use tools or manually into `docs/images/panel-dark.png` and `docs/images/settings-dark.png`, then sync the assets. Never capture the production app. The native panel and Settings are rendered from the same Swift source as the preview release. Do not upload real captures.

Update `src/release.ts` when a new GitHub release is published. Verify both DMG URLs and checksum assets; update README download links at the same time. Use short, direct headings and bullet lists. Avoid slogans and repeated explanations. Keep feature copy focused on user benefits: selecting and reordering menu items, choosing the limits to see, and knowing when usage resets. Avoid describing individual gestures or implementation mechanics.

## Support and creator links

`src/links.ts` contains the public Stripe Payment Link and personal profile URLs. GitHub and LinkedIn use local inline SVG icons beside their labels; the website link is labelled mduppes.com. Donate buttons in the top navigation and beside the hero downloads, plus a prominent support section and footer link, open Stripe-hosted checkout in a new tab; the site never collects payment details or uses API keys, payment scripts, or Netlify functions. Update the public URLs in this file when changing the destination.

## Deploy

For a static host, set:

- Root directory: `website`
- Install command: `npm ci`
- Build command: `npm run build`
- Publish/output directory: `dist`

The site uses root-relative assets and is intended for a domain root. For GitHub Pages under a repository subpath, configure Vite’s `base` and adjust asset URLs first. No SPA rewrite is required: the page uses anchor links, not client-side routes. The public site is hosted with Sites at https://tokentracking.truedog2.chatgpt.site. Its project identity is tracked in `.openai/hosting.json`; preserve that identity for future deployments. Custom-domain setup remains optional.

All images, SVGs, CSS and JavaScript are served locally by the site. External links open in a new tab with `noopener noreferrer`, including downloads, documentation, Stripe checkout and creator profiles. Section anchors keep visitors on the page. There are no runtime analytics, remote fonts or calls to the local usage service.
