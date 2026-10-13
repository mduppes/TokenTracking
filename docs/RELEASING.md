# Mac releases

Release downloads are self-contained DMGs for macOS 13+, one per architecture. Google Chrome must already be installed. Node, the service and dashboard ship inside the app; profiles and history remain in `~/.tokentracking` and are never packaged.

## Build a free preview

On a Mac with Node ≥22.13 and Xcode command line tools:

```bash
npm test
npm run build:release -- arm64
npm run build:release -- x64
node scripts/verify-release.js build/release-arm64/TokenTracking.app
```

The scripts download official Node 22.23.3 binaries, verify pinned SHA-256 checksums, cross-compile Swift, include Node's license, verify signatures and generate `build/TokenTracking-<version>-<arch>.dmg` plus `.sha256` files. Downloads are cached under `build/node-cache`; checksums are verified on every build. Node version and hashes live in `scripts/build-release.sh`; review official Node release checksums when updating them.

Run the relocated-service smoke check on an Intel Mac with the x64 app as well. It may run under Rosetta on Apple Silicon, but that does not replace testing on a physical Intel Mac. The smoke check disables headless refresh and uses a temporary data directory: it never accesses real logins or usage.

Preview packages have ad-hoc signatures, **without Developer ID or Apple notarization**. Clearly label this in the README and release notes. Downloaders may need to attempt launch, then approve it using System Settings → Privacy & Security → Open Anyway. Do not suggest disabling Gatekeeper or removing quarantine. Installation requires dragging the app into Applications; it is not a silent one-click installer.

Use a prerelease tag matching `package.json` (initially `v0.6.0-preview.1`). Upload both DMGs and checksum files to a GitHub prerelease, using `gh release create --prerelease --notes-file <file>`. Keep the README download links in sync with the tag and filenames. Quit the installed app before replacing it; the data directory persists.

## Signed releases later

The publisher needs an Apple Developer Program membership and a **Developer ID Application** certificate. Local development certificates are not suitable for distribution. Configure signing and notarization yourself using Apple's tools; never commit credentials or private keys.

```bash
TOKENTRACKING_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
TOKENTRACKING_NOTARY_PROFILE='your-existing-notarytool-profile' \
npm run build:release -- arm64
```

Repeat for x64. The build signs the bundled Node helper with V8 JIT entitlements and the app with hardened runtime and timestamp. If a notarization profile is supplied, it submits the DMG, waits for success, staples and validates the ticket. This path needs validation with a real Developer ID certificate before a stable release; the initial preview only exercises ad-hoc signing. Never publish a signed release if notarization fails.

Before promoting to stable, validate `spctl --assess --type execute --verbose <app>`, test a quarantined download on fresh Macs of both architectures, and confirm first-launch login, Chrome detection, menu bar permission, quit/relaunch and upgrade behavior. Provider verification remains tracked separately in `PROVIDERS.md`.

References: [Apple distribution packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [Developer ID](https://developer.apple.com/developer-id/), [Node 22.23.3 binaries and checksums](https://nodejs.org/dist/v22.23.3/).
