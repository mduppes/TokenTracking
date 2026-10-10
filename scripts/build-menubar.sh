#!/bin/sh
# Builds build/TokenTracking.app from menubar/*.swift with the Swift compiler from the Xcode
# command line tools (no Xcode project). Usage: npm run build:menubar
set -eu
cd "$(dirname "$0")/.."
APP=build/TokenTracking.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TokenTracking</string>
  <key>CFBundleIdentifier</key><string>local.tokentracking.menubar</string>
  <key>CFBundleExecutable</key><string>TokenTracking</string>
  <key>CFBundlePackageType</key><string>APPL</string>
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
codesign --force --sign - "$APP" >/dev/null 2>&1 || true  # ad-hoc signature for local use
echo "Built $APP"
echo "Run it:  open $APP"
