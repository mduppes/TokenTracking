#!/bin/sh
# Build redistributable apps using pinned, checksum-verified official Node binaries (ADR-012).
set -eu
cd "$(dirname "$0")/.."
ARCH=${1:-arm64}
case "$ARCH" in
  arm64) SWIFT_ARCH=arm64; SHA=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53 ;;
  x64) SWIFT_ARCH=x86_64; SHA=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8 ;;
  *) echo 'Usage: npm run build:release -- [arm64|x64]' >&2; exit 1 ;;
esac
NODE_VERSION=22.23.3
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")
CACHE="$(pwd)/build/node-cache"
NAME="node-v$NODE_VERSION-darwin-$ARCH"
mkdir -p "$CACHE"
if [ ! -f "$CACHE/$NAME.tar.gz" ]; then
  curl --fail --location --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz" -o "$CACHE/$NAME.tar.gz.part"
  mv "$CACHE/$NAME.tar.gz.part" "$CACHE/$NAME.tar.gz"
fi
printf '%s  %s\n' "$SHA" "$CACHE/$NAME.tar.gz" | shasum -a 256 -c -
tar -xzf "$CACHE/$NAME.tar.gz" -C "$CACHE" "$NAME/bin/node" "$NAME/LICENSE"
APP="$(pwd)/build/release-$ARCH/TokenTracking.app"
TOKENTRACKING_APP_OUTPUT="$APP" TOKENTRACKING_BUILD_ARCH="$SWIFT_ARCH" TOKENTRACKING_BUNDLE_NODE="$CACHE/$NAME/bin/node" sh scripts/build-menubar.sh
cp "$CACHE/$NAME/LICENSE" "$APP/Contents/Resources/Node-LICENSE.txt"
# Re-sign after adding the runtime's third-party license.
if [ -n "${TOKENTRACKING_SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$TOKENTRACKING_SIGN_IDENTITY" "$APP"
else
  codesign --force --sign - "$APP"
fi
codesign --verify --deep --strict "$APP"
OUT="$(pwd)/build/TokenTracking-$VERSION-$ARCH.dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/TokenTracking.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname TokenTracking -srcfolder "$STAGE" -format UDZO -ov "$OUT"
if [ -n "${TOKENTRACKING_NOTARY_PROFILE:-}" ]; then
  [ -n "${TOKENTRACKING_SIGN_IDENTITY:-}" ] || { echo 'Notarization requires TOKENTRACKING_SIGN_IDENTITY.' >&2; exit 1; }
  xcrun notarytool submit "$OUT" --keychain-profile "$TOKENTRACKING_NOTARY_PROFILE" --wait
  xcrun stapler staple "$OUT"
  xcrun stapler validate "$OUT"
fi
(cd build && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256")
echo "Ready: $OUT"
