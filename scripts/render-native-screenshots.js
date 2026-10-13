// Render the actual native views from demo JSON in an isolated renderer. No service, logins,
// user preferences or production app state are changed. AppKit renders native controls in full.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const [statusPath, workDir] = process.argv.slice(2);
const appDir = resolve('build/screenshot-preview/TokenTrackingDemo.app');
mkdirSync(join(appDir, 'Contents/MacOS'), { recursive: true });
mkdirSync(join(appDir, 'Contents/Resources'), { recursive: true });
copyFileSync(statusPath, join(appDir, 'Contents/Resources/demo-status.json'));
writeFileSync(join(appDir, 'Contents/Info.plist'), `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.tokentracking.screenshot-demo</string><key>CFBundleName</key><string>TokenTracking Demo</string><key>CFBundleExecutable</key><string>TokenTrackingDemo</string><key>LSUIElement</key><true/></dict></plist>`);
if (!statusPath || !workDir) throw new Error('Expected demo status JSON and temporary work directory');
let source = readFileSync('menubar/TokenTrackingMenu.swift', 'utf8').replace('@main\nfinal class AppDelegate', 'final class AppDelegate');
const start = source.indexOf('    init() {', source.indexOf('final class StatusModel'));
const end = source.indexOf('    func poll()', start);
source = source.slice(0, start) + `    init() {
        preferences = .defaults
        status = try! JSONDecoder().decode(Status.self, from: Data(contentsOf: URL(fileURLWithPath: ${JSON.stringify(join(appDir, "Contents/Resources/demo-status.json"))})))
        apply(status!)
    }
\n` + source.slice(end);
source = source.replace('@State private var customizing = false', `@State private var customizing = false
    init(model: StatusModel, showSettings: Bool = false) {
        self.model = model
        self._customizing = State(initialValue: showSettings)
    }`);
source += `
@main struct NativeShots {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        app.appearance = NSAppearance(named: .darkAqua)
        let model = StatusModel()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 560), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "TokenTracking · Demo"
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: PanelView(model: model).environment(\\.colorScheme, .dark))
        window.center()
        window.makeKeyAndOrderFront(nil)
        app.activate(ignoringOtherApps: true)
        app.run()
    }
}
`;
const file = join(workDir, 'NativeShots.swift');
const config = join(workDir, 'BuildConfig.swift');
writeFileSync(file, source);
writeFileSync(config, 'enum BuildConfig { static let nodePath = "/unused"; static let projectDir = "/unused" }');
const binary = join(appDir, 'Contents/MacOS/TokenTrackingDemo');
execFileSync('swiftc', ['-parse-as-library', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`, '-module-cache-path', join(workDir, 'module-cache'), 'menubar/MenuBarPreferences.swift', file, config, '-o', binary], { stdio: 'inherit' });
console.log('Native screenshot demo built: ' + appDir + '\nOpen this app and capture panel/Settings with computer-use tools or manually; never capture the production app.');
