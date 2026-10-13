#!/bin/sh
# Builds build/TokenTracking.app from menubar/*.swift with the Swift compiler from the Xcode
# command line tools (no Xcode project). Usage: npm run build:menubar
set -eu
cd "$(dirname "$0")/.."
APP=${TOKENTRACKING_APP_OUTPUT:-build/TokenTracking.app}
ARCH=${TOKENTRACKING_BUILD_ARCH:-$(uname -m)}
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")
APP_VERSION=$(printf '%s' "$VERSION" | cut -d- -f1)
# Update the bundle in place (don't delete it) so Login Items and other references keep pointing at it.
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp menubar/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"  # regenerate with: npm run build:icon

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TokenTracking</string>
  <key>CFBundleIdentifier</key><string>io.github.mduppes.tokentracking</string>
  <key>CFBundleExecutable</key><string>TokenTracking</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>$APP_VERSION</string>
  <key>CFBundleVersion</key><string>$APP_VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <!-- Menu bar only: no Dock icon, no app menu -->
  <key>LSUIElement</key><true/>
  <!-- Allow plain http to the local service on 127.0.0.1 -->
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# Distribution builds carry an allow-listed service tree and an official standalone Node binary.
# Never copy a checkout wholesale: it may contain profiles, usage data or local configuration.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
GEN="$TMP/BuildConfig.swift"
if [ -n "${TOKENTRACKING_BUNDLE_NODE:-}" ]; then
  SERVICE="$APP/Contents/Resources/service"
  rm -rf "$SERVICE"
  mkdir -p "$SERVICE/server" "$APP/Contents/Helpers"
  cp -R lib "$SERVICE/lib"
  cp -R server/src server/public "$SERVICE/server/"
  cp package.json LICENSE "$SERVICE/"
  cp "$TOKENTRACKING_BUNDLE_NODE" "$APP/Contents/Helpers/node"
  chmod 755 "$APP/Contents/Helpers/node"
  cat > "$GEN" <<'SWIFT'
import Foundation
enum BuildConfig {
    static var projectDir: String { Bundle.main.resourceURL!.appendingPathComponent("service").path }
    static var nodePath: String { Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/node").path }
}
SWIFT
else
  NODE="$(command -v node)"
  cat > "$GEN" <<SWIFT
enum BuildConfig {
    static let projectDir = "$(pwd)"
    static let nodePath = "$NODE"
}
SWIFT
fi

swiftc -O -parse-as-library -target "$ARCH-apple-macos13.0" \
  -o "$APP/Contents/MacOS/TokenTracking" menubar/*.swift "$GEN"
# Sign with the stable local certificate if present (scripts/create-signing-cert.sh): macOS ties
# per-app settings such as "Allow in the Menu Bar" to the signing identity, so ad-hoc signatures
# (new identity every build) make those settings go stale after each rebuild.
SIGN_ID="${TOKENTRACKING_SIGN_IDENTITY:-TokenTracking Local Signing}"
if [ -n "${TOKENTRACKING_BUNDLE_NODE:-}" ]; then
  # No automatic Keychain inspection for releases. Publisher supplies an identity explicitly.
  if [ -n "${TOKENTRACKING_SIGN_IDENTITY:-}" ]; then
    codesign --force --options runtime --timestamp --entitlements scripts/node-entitlements.plist --sign "$SIGN_ID" "$APP/Contents/Helpers/node"
    codesign --force --options runtime --timestamp --sign "$SIGN_ID" "$APP"
  else
    # Keep the official Node signature and V8 entitlements intact in preview builds.
    codesign --verify --strict "$APP/Contents/Helpers/node"
    codesign --force --sign - "$APP"
    echo "Unsigned preview (ad-hoc signature); requires macOS approval on downloaded copies."
  fi
elif security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  codesign --force --sign "$SIGN_ID" "$APP"
  echo "Signed with \"$SIGN_ID\""
else
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "Ad-hoc signed. For a stable identity (keeps menu bar permission across rebuilds): sh scripts/create-signing-cert.sh"
fi
touch "$APP"  # nudge Finder to pick up the icon
echo "Built $APP"
echo "Run it:  open $APP"
