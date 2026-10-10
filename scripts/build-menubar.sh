#!/bin/sh
# Builds build/TokenTracking.app from menubar/*.swift with the Swift compiler from the Xcode
# command line tools (no Xcode project). Usage: npm run build:menubar
set -eu
cd "$(dirname "$0")/.."
APP=build/TokenTracking.app
# Update the bundle in place (don't delete it) so Login Items and other references keep pointing at it.
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp menubar/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"  # regenerate with: npm run build:icon

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TokenTracking</string>
  <key>CFBundleIdentifier</key><string>io.github.mduppes.tokentracking</string>
  <key>CFBundleExecutable</key><string>TokenTracking</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>0.5.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <!-- Menu bar only: no Dock icon, no app menu -->
  <key>LSUIElement</key><true/>
  <!-- Allow plain http to the local service on 127.0.0.1 -->
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

# Bake in where the project and Node live, so the app can start the local service itself.
NODE="$(command -v node)"
GEN="$(mktemp -d)/BuildConfig.swift"
cat > "$GEN" <<SWIFT
enum BuildConfig {
    static let projectDir = "$(pwd)"
    static let nodePath = "$NODE"
}
SWIFT

swiftc -O -parse-as-library -target "$(uname -m)-apple-macos13.0" \
  -o "$APP/Contents/MacOS/TokenTracking" menubar/*.swift "$GEN"
# Sign with the stable local certificate if present (scripts/create-signing-cert.sh): macOS ties
# per-app settings such as "Allow in the Menu Bar" to the signing identity, so ad-hoc signatures
# (new identity every build) make those settings go stale after each rebuild.
SIGN_ID="TokenTracking Local Signing"
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  codesign --force --sign "$SIGN_ID" "$APP"
  echo "Signed with \"$SIGN_ID\""
else
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "Ad-hoc signed. For a stable identity (keeps menu bar permission across rebuilds): sh scripts/create-signing-cert.sh"
fi
touch "$APP"  # nudge Finder to pick up the icon
echo "Built $APP"
echo "Run it:  open $APP"
