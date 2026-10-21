# Mac releases

Release downloads are self-contained DMGs for macOS 13+, one per architecture. Google Chrome must already be installed. Node, the service and dashboard ship inside the app; profiles and history remain in `~/.tokentracking` and are never packaged.

## Build a local preview

On a Mac with Node ≥22.13 and Xcode command line tools:

```bash
npm test
npm run build:release -- arm64
npm run build:release -- x64
node scripts/verify-release.js build/release-arm64/TokenTracking.app
```

The scripts download official Node 22.23.3 binaries, verify pinned SHA-256 checksums, cross-compile Swift, include Node's license, verify signatures and generate `build/TokenTracking-<version>-<arch>.dmg` plus `.sha256` files. Downloads are cached under `build/node-cache`; checksums are verified on every build. Node version and hashes live in `scripts/build-release.sh`; review official Node release checksums when updating them.

Run the relocated-service smoke check on an Intel Mac with the x64 app as well. It may run under Rosetta on Apple Silicon, but that does not replace testing on a physical Intel Mac. The smoke check disables headless refresh and uses a temporary data directory: it never accesses real logins or usage.

Without the signing environment variables below, these local preview packages have ad-hoc signatures, **without Developer ID or Apple notarization**. Clearly label this in the README and release notes. Downloaders may need to attempt launch, then approve it using System Settings → Privacy & Security → Open Anyway. Do not suggest disabling Gatekeeper or removing quarantine. Installation requires dragging the app into Applications; it is not a silent one-click installer.

Use a prerelease tag matching `package.json` (currently `v0.6.0-preview.5`). Upload both DMGs and checksum files to a GitHub prerelease, using `gh release create --prerelease --notes-file <file>`. Keep the README download links in sync with the tag and filenames. Quit the installed app before replacing it; the data directory persists.

## Reclaim local build space

After packaging and verification, `build/node-cache`, `build/release-arm64`, `build/release-x64` and `build/screenshot-preview` can be deleted. These are generated runtime caches, release staging apps and the demo preview; the next relevant build recreates them (release builds download Node again). Keep `build/TokenTracking.app` if it is your development app, and retain the DMGs and checksum files you still need. Usage history and browser logins live separately in `~/.tokentracking`.

## Signed releases

The publisher needs an Apple Developer Program membership and a **Developer ID Application** certificate. Local development certificates are not suitable for distribution. Configure signing and notarization yourself using Apple's tools; never commit credentials or private keys.

```bash
TOKENTRACKING_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
TOKENTRACKING_NOTARY_PROFILE='your-existing-notarytool-profile' \
npm run build:release -- arm64
```

Repeat for x64. The build signs the bundled Node helper with V8 JIT entitlements and the app with hardened runtime and timestamp. If a notarization profile is supplied, it submits the DMG, waits for success, staples and validates the ticket. This path was verified for preview.3 on 2026-10-20 for both architectures, with Gatekeeper reporting `Notarized Developer ID`. Never publish a signed release if notarization or Gatekeeper assessment fails.

Before promoting to stable, validate `spctl --assess --type execute --verbose <app>`, test a quarantined download on fresh Macs of both architectures, and confirm first-launch login, Chrome detection, menu bar permission, quit/relaunch and upgrade behavior. Provider verification remains tracked separately in `PROVIDERS.md`.

References: [Apple distribution packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [Developer ID](https://developer.apple.com/developer-id/), [Node 22.23.3 binaries and checksums](https://nodejs.org/dist/v22.23.3/).

## Website and screenshot checklist

The static landing page is separate from the release allow-list (ADR-013). Before announcing a new Mac release:

1. Verify both uploaded DMGs and checksum assets exist.
2. Update `website/src/release.ts` and README download URLs/version notes together.
3. Regenerate demo web screenshots with `npm run screenshots`; capture the generated `TokenTrackingDemo.app` panel and Settings separately, never the production app. Copy approved assets with `npm run sync:assets --prefix website`.
4. Keep user-facing feature descriptions focused on outcomes. Do not remove unsigned-preview installation guidance until Developer ID signing and notarization are verified.
5. Run `npm run build --prefix website` and check desktop/mobile layouts before deploying `website/dist`.

The linked `v0.6.0-preview.5` release adds guided service setup and privacy/sign-in guidance while retaining Developer ID signing and Apple notarization. Release notes are checked in at `docs/releases/0.6.0-preview.5.md`; publish them with both DMGs and their checksum files. The public website at https://tokentracking.truedog2.chatgpt.site must be redeployed when download metadata changes.

## First-run regression checks

Use a disposable `TOKENTRACKING_HOME`, never the maintainer’s real profile. Confirm no collection before selection, disabled Continue with no selection, missing-Chrome guidance, pending connections, Cmd+Q guidance and setup completion. Reopen through Settings → Service setup & privacy. Quit/relaunch incomplete setup to resume, and verify a legacy database migrates without forcing the wizard. Check menu visibility separately from collection. Local UI checks on 2026-10-21 used an isolated app identity and synthetic Antigravity data; fresh-Mac and physical Intel validation remain pending.
