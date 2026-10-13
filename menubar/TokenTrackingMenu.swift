// TokenTracking menu bar app: shows configurable service usage slots and a native SwiftUI
// panel backed by the local service. No dependencies; built
// with `npm run build:menubar` (swiftc, no Xcode project). See docs/ARCHITECTURE.md.
import SwiftUI
import Combine

let baseURL = URL(string: ProcessInfo.processInfo.environment["TOKENTRACKING_URL"] ?? "http://127.0.0.1:7878")!

// MARK: - Local service ownership
// The app is the only thing the user runs: if the Node service isn't already up, start it as a child
// process (bundle-relative paths in releases, see BuildConfig.swift) and stop it again on quit.
@MainActor
final class ServiceRunner {
    static let shared = ServiceRunner()
    private var process: Process?

    func ensureRunning() async {
        if await Self.healthy() { return }
        guard FileManager.default.isExecutableFile(atPath: BuildConfig.nodePath) else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: BuildConfig.nodePath)
        p.arguments = ["--disable-warning=ExperimentalWarning", "server/src/index.js"]
        p.currentDirectoryURL = URL(fileURLWithPath: BuildConfig.projectDir)
        var env = ProcessInfo.processInfo.environment
        env["TOKENTRACKING_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier) // service exits if we die
        p.environment = env
        let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".tokentracking")
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent("service.log")
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        if let log = try? FileHandle(forWritingTo: logURL) {
            log.seekToEndOfFile()
            p.standardOutput = log
            p.standardError = log
        }
        do { try p.run(); process = p } catch { return }
        for _ in 0..<20 { // wait up to ~5 s for it to come up
            try? await Task.sleep(nanoseconds: 250_000_000)
            if await Self.healthy() { return }
        }
    }

    func stop() { process?.terminate() }

    static func healthy() async -> Bool {
        var req = URLRequest(url: baseURL.appendingPathComponent("api/health"))
        req.timeoutInterval = 1
        return (try? await URLSession.shared.data(for: req)) != nil
    }
}

// AppKit status item + popover (rather than SwiftUI MenuBarExtra, whose icon+text label can render
// empty on some macOS versions). The panel content is still SwiftUI.
@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var model: StatusModel!
    private var observer: AnyCancellable?

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            model = StatusModel()
            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            statusItem.autosaveName = "TokenTracking"
            statusItem.isVisible = true
            if let button = statusItem.button {
                button.imagePosition = .imageLeading
                button.action = #selector(togglePopover(_:))
                button.target = self
            }
            popover.behavior = .transient
            popover.contentSize = NSSize(width: 400, height: 560)
            popover.contentViewController = NSHostingController(rootView: PanelView(model: model))
            updateButton()
            observer = model.objectWillChange.sink { [weak self] _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.updateButton() } }
            }
            // macOS silently hides menu bar items when the bar is full (notch) or when the app isn't
            // allowed in System Settings → Menu Bar (new apps start disallowed on recent macOS).
            // Watch for that: fall back to a Dock icon + window, and switch back once the item shows.
            Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.checkVisible() }
            }
        }
    }

    private var fallbackWindow: NSWindow?

    @MainActor private func checkVisible() {
        let visible = statusItem.button?.window?.occlusionState.contains(.visible) ?? false
        if visible, model.menuBarHidden {
            // The icon is back (user allowed it or made room): return to menu-bar-only mode.
            model.menuBarHidden = false
            fallbackWindow?.close()
            NSApp.setActivationPolicy(.accessory)
        } else if !visible, !model.menuBarHidden {
            NSLog("TokenTracking: menu bar item hidden (not allowed in System Settings → Menu Bar, or no room); using Dock icon + window")
            model.menuBarHidden = true
            NSApp.setActivationPolicy(.regular)
            showWindow()
        }
    }

    @MainActor private func showWindow() {
        if fallbackWindow == nil {
            let w = NSWindow(contentViewController: NSHostingController(rootView: PanelView(model: model)))
            w.title = "TokenTracking"
            w.styleMask = [.titled, .closable, .miniaturizable]
            w.isReleasedWhenClosed = false
            w.setContentSize(NSSize(width: 400, height: 560))
            w.center()
            fallbackWindow = w
        }
        fallbackWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        model.panelOpened()
    }

    // Clicking the Dock icon (fallback mode) reopens the window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        MainActor.assumeIsolated { showWindow() }
        return true
    }

    @MainActor private func updateButton() {
        guard let button = statusItem?.button else { return }
        button.toolTip = model.tooltip
        if !model.slots.isEmpty {
            // One icon + two usage characters per service, drawn as one template image.
            button.image = MenuBarGlyphs.image(for: model.slots)
            button.imagePosition = .imageOnly
            button.title = ""
        } else {
            let image = NSImage(systemSymbolName: model.symbol, accessibilityDescription: "TokenTracking usage")
            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageLeading
            button.title = model.preferences.visibleIDs.isEmpty ? "" : " " + model.title
        }
    }

    @objc private func togglePopover(_ sender: NSStatusBarButton) {
        MainActor.assumeIsolated {
            if popover.isShown {
                popover.performClose(sender)
            } else {
                popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
                popover.contentViewController?.view.window?.makeKey()
                NSApp.activate(ignoringOtherApps: true)
                model.panelOpened()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { ServiceRunner.shared.stop() }
    }
}

// MARK: - Menu bar glyphs

/// One service in the menu bar: a brand icon and two characters for its highest usage meter.
struct MenuSlot: Equatable {
    let symbol: String
    let text: String   // "0"…"99" = % used, "––" = at the limit, "??" = no reading
}

enum MenuBarGlyphs {
    /// Available slots. Saved preferences choose their visibility and order.
    /// Grok Bot is a separate limit inside Cursor.
    static let services: [(id: String, symbol: String, name: String, matches: (String, String) -> Bool)] = [
        ("claude", "claude", "Claude", { p, _ in p == "claude" }),
        ("cursor", "cursor", "Cursor", { p, m in p == "cursor" && m != "grok-bot" }),
        ("antigravity", "antigravity", "Antigravity", { p, _ in p == "antigravity" }),
        ("grok-bot", "grok-bot", "Grok Bot", { p, m in p == "cursor" && m == "grok-bot" }),
        ("openai", "openai", "OpenAI", { p, _ in p == "openai" }),
        ("muse", "muse", "Muse", { p, _ in p == "muse" }),
        ("gemini", "gemini", "Gemini", { p, _ in p == "gemini" }),
    ]

    /// Two characters: % used 0–99 (single digits padded with a trailing figure space so the width is
    /// stable), "––" at/over the limit.
    static func digits(_ pct: Double) -> String {
        if pct >= 100 { return "––" }
        let n = min(99, max(0, Int(pct)))
        return n < 10 ? "\(n)\u{2007}" : String(n) // pad after, so the digit stays next to its icon
    }

    /// Local vector knot: six interlocking loops distinguish OpenAI from generic AI sparkles.
    /// Drawn in code so menu bar tinting and Retina scaling need no downloaded assets.
    static func openAIIcon() -> NSImage {
        NSImage(size: NSSize(width: 14, height: 14), flipped: false) { _ in
            NSColor.black.setStroke()
            for i in 0..<6 {
                let path = NSBezierPath()
                path.move(to: NSPoint(x: 7, y: 2))
                path.curve(to: NSPoint(x: 12, y: 5), controlPoint1: NSPoint(x: 10, y: 0.6), controlPoint2: NSPoint(x: 12.5, y: 2.5))
                path.line(to: NSPoint(x: 12, y: 7.4))
                path.line(to: NSPoint(x: 7, y: 10.3))
                path.line(to: NSPoint(x: 4.9, y: 9.1))
                path.line(to: NSPoint(x: 9.9, y: 6.2))
                let transform = AffineTransform(translationByX: -7, byY: -7)
                path.transform(using: transform)
                var rotation = AffineTransform()
                rotation.rotate(byDegrees: CGFloat(i) * 60)
                path.transform(using: rotation)
                path.transform(using: AffineTransform(translationByX: 7, byY: 7))
                path.lineWidth = 0.9
                path.lineJoinStyle = .round
                path.lineCapStyle = .round
                path.stroke()
            }
            return true
        }
    }

    private static let svgs: [String: String] = [
        "claude": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-0.5 -0.5 27 25\"><path fill=\"black\" d=\"m4.709 15.955 4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z\"/></svg>",
        "cursor": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-55 -40 577 612\"><path fill=\"black\" d=\"M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z\"/></svg>",
        "muse": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path fill=\"black\" d=\"M24.6257 16.1214C28.2365 16.1214 30.8187 18.9408 30.8187 23.3643C30.8185 27.7868 30.1055 31.7765 28.9225 40.2466C28.0743 46.1813 26.62 55.2418 26.0132 59.0088C27.1782 56.7815 29.9074 51.5757 30.3914 50.5982C36.1081 39.061 42.0657 28.7544 43.7826 26.0254C46.0594 22.382 48.062 20.9229 51.1597 20.9229C52.7685 20.923 54.6826 21.7357 55.6315 22.819C56.9178 24.2895 57.1859 26.6602 57.1411 29.244C57.0738 33.2073 56.5599 39.5264 55.8553 46.5698C55.5416 49.7057 54.9365 56.1066 54.5288 60.4004C58.1883 53.8532 64.9609 41.8109 67.6921 37.6058C70.0727 33.9402 72.466 31.5797 75.6836 31.5796C78.4595 31.5796 81.8809 33.5416 81.6772 38.7573C81.3774 46.4556 80.2673 63.2232 79.7607 70.7479C83.1662 65.7913 87.6377 58.4543 89.3148 55.6966C91.0104 52.908 92.75 50.6542 95.3898 50.5778C98.0987 50.4995 99.913 52.341 99.9959 55.1839C100.078 58.0277 98.3835 61.2256 96.1344 64.856C93.6937 68.7957 90.9621 73.0123 87.6383 76.9491C84.3148 80.8856 81.2604 83.8782 76.5991 83.8786C72.4243 83.8786 69.4869 81.1043 69.283 76.0254C69.1768 73.364 69.6804 67.6405 70.0602 63.1673C70.5 57.9875 71.0315 52.9861 71.403 49.6786C67.7337 56.3979 60.0101 70.4676 56.5348 75.9603C53.1343 81.3339 51.4774 83.2269 47.8882 83.2275C44.2977 83.2275 42.7226 80.6416 42.6717 76.7497C42.6142 72.5285 45.7852 47.1821 46.8587 38.737C45.1183 42.4616 40.839 51.6056 38.1551 57.0435C35.5587 62.3055 31.204 71.3978 28.0436 76.6357C25.7668 80.4094 23.2092 83.2273 19.4173 83.2275C15.6252 83.2275 13.4847 80.6784 13.4847 76.5788C13.4847 72.4794 14.6716 65.6492 15.9465 57.1777C16.5839 53.0781 17.3108 48.6133 18.1315 43.8761C18.7324 40.448 19.7764 34.4169 20.4183 30.7129C17.502 35.2539 12.2536 43.4278 10.6567 45.8903C8.88113 48.6291 7.28747 50.626 4.64681 50.6266C1.7329 50.6266 0.000532901 48.3522 0 45.7113C0 43.0703 1.34323 41.0344 3.52376 37.4512C6.32403 32.8465 11.3578 26.57 14.1154 23.2747C17.3656 19.3912 20.6139 16.1219 24.6257 16.1214Z\"/></svg>",
        "grok-bot": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"45 45 422 422\"><path fill=\"black\" d=\"M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677\"/></svg>",
        "gemini": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"black\" d=\"M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.93 4.68-.96 2.19-2.58 3.81t-3.81 2.55Q2.49 12 0 12q2.49 0 4.68.93a12.3 12.3 0 0 1 3.81 2.58 12.3 12.3 0 0 1 2.58 3.81Z\"/></svg>",
        "antigravity": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 1 24 21\"><path fill=\"black\" d=\"M3.2 20.2C5 18.5 6.8 15.5 8.2 11.5C9.6 7.5 10.6 2 12 2C13.4 2 14.4 7.5 15.8 11.5C17.2 15.5 19 18.5 20.8 20.2C21.7 20.9 21.2 21.8 20 21.8C18.8 21.8 17.6 20.5 16.5 17.5C15 13.5 13.7 8.5 12 8.5C10.3 8.5 9 13.5 7.5 17.5C6.4 20.5 5.2 21.8 4 21.8C2.8 21.8 2.3 20.9 3.2 20.2Z\"/></svg>"
    ]

    private static var iconCache: [String: NSImage] = [:]

    static func icon(for id: String, size: CGFloat = 14) -> NSImage? {
        if id == "openai" || id == "openai.knot" {
            if size == 14 { return openAIIcon() }
            let key = "openai-\(Int(size))"
            if let cached = iconCache[key] { return cached }
            let knot = openAIIcon()
            let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
                knot.draw(in: rect)
                return true
            }
            image.isTemplate = true
            iconCache[key] = image
            return image
        }
        let key = "\(id)-\(Int(size))"
        if let cached = iconCache[key] { return cached }
        guard let svg = svgs[id], let raw = NSImage(data: Data(svg.utf8)) else {
            let sf = NSImage(systemSymbolName: id, accessibilityDescription: nil)
            sf?.isTemplate = true
            return sf
        }
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            raw.draw(in: rect)
            return true
        }
        image.isTemplate = true
        iconCache[key] = image
        return image
    }

    /// Draw icons and digits in black on a transparent image and mark it as a template, so macOS
    /// tints it for light/dark menu bars and the pressed state, like any other menu bar icon.
    static func image(for slots: [MenuSlot]) -> NSImage {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.black]
        let height: CGFloat = 18, iconGap: CGFloat = 1.5, slotGap: CGFloat = 6
        let parts = slots.map { slot -> (NSImage?, NSAttributedString) in
            (icon(for: slot.symbol, size: 14),
             NSAttributedString(string: slot.text, attributes: attrs))
        }
        let width = parts.reduce(CGFloat(0)) { w, p in w + (p.0?.size.width ?? 0) + iconGap + p.1.size().width } + slotGap * CGFloat(max(0, parts.count - 1))
        let image = NSImage(size: NSSize(width: ceil(width), height: height), flipped: false) { _ in
            var x: CGFloat = 0
            for (icon, text) in parts {
                if let icon {
                    icon.draw(in: NSRect(x: x, y: (height - icon.size.height) / 2, width: icon.size.width, height: icon.size.height))
                    x += icon.size.width + iconGap
                }
                let ts = text.size()
                text.draw(at: NSPoint(x: x, y: (height - ts.height) / 2))
                x += ts.width + slotGap
            }
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "TokenTracking usage"
        return image
    }
}

// MARK: - Status polling

struct Status: Decodable {
    struct Provider: Decodable, Identifiable {
        let id: String; let name: String; let planLabel: String?; let meters: [Meter]
        let emptyText: String?; let canOpenBrowser: Bool?; let actionLabel: String?
    }
    struct Meter: Decodable, Identifiable {
        let id: String; let label: String; let window: String; let usedPercent: Double?
        let resetsAt: String?; let capturedAt: String; let stale: Bool; let pace: Pace
    }
    struct Pace: Decodable { let status: String; let expectedPercent: Double? }
    struct Headless: Decodable { let nextAt: String? }
    /// Built by the service (server/src/status.js withPresentation) so the web dashboard and this panel
    /// show the same notices and resets without duplicating the rules.
    struct Notice: Decodable { let provider: String; let kind: String; let text: String; let canLogIn: Bool; let actionLabel: String? }
    struct Reset: Decodable {
        let provider: String; let providerName: String; let meterId: String; let label: String
        let usedPercent: Double?; let resetsAt: String; let status: String; let stale: Bool
    }
    let providers: [Provider]
    let headless: Headless?
    let notices: [Notice]
    let resetsNext: [Reset]
    let refreshMessage: String?
}

/// ISO-8601 with or without fractional seconds (the service sends milliseconds).
func parseDate(_ s: String?) -> Date? {
    guard let s else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}

/// "2d 4h", "3h 12m", "45m"
func shortDuration(_ seconds: TimeInterval) -> String {
    let m = max(0, Int(seconds / 60)), d = m / 1440, h = (m % 1440) / 60
    return d > 0 ? "\(d)d \(h)h" : h > 0 ? "\(h)h \(m % 60)m" : "\(m % 60)m"
}

func ago(_ date: Date?) -> String {
    guard let date else { return "never" }
    let m = Int(-date.timeIntervalSinceNow / 60)
    return m < 1 ? "just now" : m < 60 ? "\(m)m ago" : m < 1440 ? "\(m / 60)h ago" : "\(m / 1440)d ago"
}

@MainActor
final class StatusModel: ObservableObject {
    @Published private(set) var preferences = MenuBarPreferences.load()
    @Published var title = "…"
    @Published var slots: [MenuSlot] = []
    @Published var tooltip = "TokenTracking"
    @Published var symbol = "gauge.with.dots.needle.0percent"
    @Published var reachable = true
    @Published var refreshing = false
    @Published var refreshError: String?
    @Published var menuBarHidden = false
    /// Latest /api/status, rendered natively by PanelView. (The panel used to be a WKWebView of the
    /// dashboard, but after the Mac slept it often drew nothing at all, even when recreated: 2026-10-11.)
    @Published var status: Status?
    @Published var loginNote: [String: String] = [:]

    private var timer: Timer?

    init() {
        rebuildSlots()
        Task { @MainActor in
            await ServiceRunner.shared.ensureRunning()
            self.poll()
        }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    func poll() {
        Task {
            if !(await ServiceRunner.healthy()) { await ServiceRunner.shared.ensureRunning() } // restart if it died
            do {
                let (data, _) = try await URLSession.shared.data(from: baseURL.appendingPathComponent("api/status"))
                let s = try JSONDecoder().decode(Status.self, from: data)
                status = s
                apply(s)
                reachable = true
            } catch {
                reachable = false
                title = "–"
                symbol = "exclamationmark.triangle"
            }
        }
    }

    func setVisible(_ id: String, _ visible: Bool) {
        guard MenuBarPreferences.serviceIDs.contains(id) else { return }
        if visible { preferences.hidden.remove(id) } else { preferences.hidden.insert(id) }
        preferencesChanged()
    }

    func moveService(_ id: String, to target: String) {
        preferences.move(id, to: target)
        preferencesChanged()
    }

    func restoreDefaults() {
        preferences = .defaults
        preferencesChanged()
    }

    func setMeter(_ service: String, _ meter: String) {
        if meter.isEmpty { preferences.meterIDs.removeValue(forKey: service) }
        else { preferences.meterIDs[service] = meter }
        preferencesChanged()
    }

    func metersForService(_ id: String) -> [Status.Meter] {
        guard let svc = MenuBarGlyphs.services.first(where: { $0.id == id }) else { return [] }
        return (status?.providers ?? []).flatMap { p in p.meters.filter { svc.matches(p.id, $0.id) } }
    }

    private func preferencesChanged() {
        preferences.save()
        if let status { apply(status) } else { rebuildSlots() }
    }

    @discardableResult private func rebuildSlots() -> [String] {
        var lines: [String] = []
        slots = preferences.visibleIDs.compactMap { id in
            guard let svc = MenuBarGlyphs.services.first(where: { $0.id == id }) else { return nil }
            let ms = metersForService(id).filter { preferences.meterIDs[id] == nil || $0.id == preferences.meterIDs[id] }
            // Keep selected slots stable even before login or a first reading.
            if ms.isEmpty {
                lines.append("\(svc.name): \(preferences.meterIDs[id] == nil ? "no reading" : "selected meter unavailable")")
                return MenuSlot(symbol: svc.symbol, text: "??")
            }
            guard let worst = ms.compactMap({ m in m.usedPercent.map { (m, $0) } }).max(by: { $0.1 < $1.1 }) else {
                lines.append("\(svc.name): no reading")
                return MenuSlot(symbol: svc.symbol, text: "??")
            }
            let stale = ms.contains { $0.stale } ? " · stale" : ""
            lines.append("\(svc.name): \(Int(worst.1.rounded()))% (\(worst.0.label))\(stale)")
            return MenuSlot(symbol: svc.symbol, text: MenuBarGlyphs.digits(worst.1))
        }
        tooltip = lines.isEmpty ? "TokenTracking" : lines.joined(separator: "\n")
        return lines
    }

    /// Menu bar: per-service digits; tooltip: per-service values + the most at-risk meter.
    private func apply(_ s: Status) {
        let lines = rebuildSlots()
        let rank = ["limited": 4, "over-pace": 3, "ahead": 2, "ok": 1]
        let meters = s.providers.flatMap { p in p.meters.map { (p.name, $0) } }.filter { $0.1.usedPercent != nil }
        guard let (name, top) = meters.max(by: { a, b in
            let ra = rank[a.1.pace.status] ?? 0, rb = rank[b.1.pace.status] ?? 0
            return ra != rb ? ra < rb : a.1.usedPercent! < b.1.usedPercent!
        }), let pct = top.usedPercent else {
            title = "–"; symbol = "gauge.with.dots.needle.0percent"; tooltip = (lines + ["TokenTracking: no data yet"]).joined(separator: "\n"); return
        }
        title = "\(Int(pct.rounded()))%"
        let paceText = PaceText.label[top.pace.status]?.lowercased() ?? ""
        tooltip = (lines + ["", "Most at risk: \(name) · \(top.label): \(Int(pct.rounded()))% used\(paceText.isEmpty ? "" : " (\(paceText))")"]).joined(separator: "\n")
        switch pct {
        case ..<25: symbol = "gauge.with.dots.needle.0percent"
        case ..<50: symbol = "gauge.with.dots.needle.33percent"
        case ..<70: symbol = "gauge.with.dots.needle.50percent"
        case ..<90: symbol = "gauge.with.dots.needle.67percent"
        default: symbol = "gauge.with.dots.needle.100percent"
        }
    }

    func panelOpened() { poll() }

    func refreshNow() async {
        refreshing = true
        refreshError = nil
        defer { refreshing = false }
        do {
            let (_, res) = try await post("api/refresh", body: "{}", timeout: 180)
            if (res as? HTTPURLResponse)?.statusCode != 200 { refreshError = "Refresh failed. Check the service and try again." }
        } catch { refreshError = "Refresh failed: \(error.localizedDescription)" }
        poll()
    }

    /// Opens the TokenTracking browser on a provider's login page (POST /api/login).
    func logIn(_ provider: String) async {
        loginNote[provider] = "Opening…"
        do {
            let (data, res) = try await post("api/login", body: "{\"provider\":\"\(provider)\"}", timeout: 10)
            let ok = (res as? HTTPURLResponse)?.statusCode == 200
            let reason = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["reason"] as? String
            loginNote[provider] = ok ? "Check your login, then quit that window (⌘Q). It refreshes automatically." : (reason ?? "Couldn't open the browser.")
        } catch { loginNote[provider] = "The service isn't reachable." }
    }

    private func post(_ path: String, body: String, timeout: TimeInterval) async throws -> (Data, URLResponse) {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = Data(body.utf8)
        req.timeoutInterval = timeout
        return try await URLSession.shared.data(for: req)
    }
}

// MARK: - Panel (native SwiftUI)

enum PaceText {
    static let label = ["ok": "On pace", "ahead": "Ahead of pace", "over-pace": "Will run out before reset", "limited": "Limit reached", "unknown": "Pace unknown"]
    static func color(_ status: String) -> Color {
        switch status {
        case "ok": return .green
        case "ahead": return .yellow
        case "over-pace": return .orange
        case "limited": return .red
        default: return .secondary
        }
    }
}

struct PanelView: View {
    @ObservedObject var model: StatusModel
    @State private var customizing = false

    var body: some View {
        VStack(spacing: 0) {
            if model.menuBarHidden { hiddenBanner; Divider() }
            HStack(alignment: .top) {
                if customizing {
                    Text("Settings").font(.headline)
                } else if let s = model.status {
                    header(s)
                } else {
                    Text("TokenTracking").font(.headline)
                }
                Spacer()
                Button { customizing.toggle() } label: {
                    Image(systemName: customizing ? "xmark" : "gearshape")
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                .help(customizing ? "Back to usage" : "Settings")
                .accessibilityLabel(customizing ? "Back to usage" : "Settings")
            }
            .padding(14)
            Divider()
            if customizing {
                MenuBarEditor(model: model)
            } else if !model.reachable {
                VStack(spacing: 8) {
                    Image(systemName: "bolt.horizontal.circle").font(.largeTitle).foregroundStyle(.secondary)
                    Text("The TokenTracking service isn't running.").font(.headline)
                    Text("It's started automatically; see ~/.tokentracking/service.log").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let s = model.status {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        notices(s)
                        resetsNext(s)
                        if let message = model.refreshError ?? s.refreshMessage { Text(message).font(.callout).foregroundStyle(.orange) }
                        ForEach(s.providers) { ProviderCard(provider: $0, model: model) }
                    }
                    .padding(14)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            HStack {
                Button {
                    Task { await model.refreshNow() }
                } label: {
                    Label(model.refreshing ? "Refreshing…" : "Refresh now", systemImage: "arrow.clockwise")
                }
                .disabled(model.refreshing || !model.reachable)
                Spacer()
                Button("Open dashboard") { NSWorkspace.shared.open(baseURL) }
                Button("Quit") { NSApp.terminate(nil) }
            }
            .padding(10)
        }
        .frame(width: 400, height: 560)
    }

    private var hiddenBanner: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "menubar.rectangle").foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 4) {
                Text("The menu bar icon is hidden").font(.headline)
                Text("Allow TokenTracking under System Settings → Menu Bar, or make room in the menu bar. This window closes by itself once the icon shows.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button("Open Menu Bar settings") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.ControlCenter-Settings.extension")!)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12))
    }

    private func header(_ s: Status) -> some View {
        let latest = s.providers.flatMap(\.meters).compactMap { parseDate($0.capturedAt) }.max()
        var line = "Updated \(ago(latest))"
        if let next = parseDate(s.headless?.nextAt) {
            line += next.timeIntervalSinceNow > 0 ? " · next refresh in \(shortDuration(next.timeIntervalSinceNow))" : " · refreshing…"
        }
        return VStack(alignment: .leading, spacing: 2) {
            Text("TokenTracking").font(.headline)
            Text(line).font(.caption).foregroundStyle(.secondary)
        }
    }

    /// Notices come ready-made from the service (same as the web dashboard).
    @ViewBuilder private func notices(_ s: Status) -> some View {
        ForEach(Array(s.notices.enumerated()), id: \.offset) { _, n in
            notice(id: n.provider, color: n.kind == "login" ? .red : n.kind == "error" ? .orange : .secondary, text: n.text, canLogIn: n.canLogIn, actionLabel: n.actionLabel)
        }
    }

    private func notice(id: String, color: Color, text: String, canLogIn: Bool, actionLabel: String?) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8).padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
                if let note = model.loginNote[id] { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 4)
            if canLogIn {
                Button(actionLabel ?? "Open browser") { Task { await model.logIn(id) } }.controlSize(.small)
                    .disabled(model.loginNote[id] == "Opening…")
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }

    /// The five meters that reset soonest (pre-sorted by the service).
    @ViewBuilder private func resetsNext(_ s: Status) -> some View {
        let rows = Array(s.resetsNext.prefix(5))
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Resets next").font(.subheadline.weight(.semibold))
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    let left = parseDate(r.resetsAt)?.timeIntervalSinceNow ?? 0
                    HStack(spacing: 6) {
                        if let icon = MenuBarGlyphs.icon(for: r.meterId == "grok-bot" ? "grok-bot" : r.provider, size: 14) {
                            Image(nsImage: icon)
                                .renderingMode(.template)
                        }
                        Text("\(r.providerName) · \(r.label)").font(.callout).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        Text(r.usedPercent.map { "\(Int($0.rounded()))%" } ?? "?").font(.callout.monospacedDigit())
                            .foregroundStyle(r.status == "ok" ? Color.secondary : PaceText.color(r.status))
                        Text(left > 0 ? "in \(shortDuration(left))" : "reset")
                            .font(.callout.monospacedDigit().weight(.semibold)).frame(minWidth: 64, alignment: .trailing)
                        if r.stale { Text("stale").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
        }
    }
}

struct MenuBarEditor: View {
    @ObservedObject var model: StatusModel
    @State private var draggedService: String?
    @State private var rowFrames: [String: CGRect] = [:]
    @State private var dragY: CGFloat = 0
    @State private var grabOffset: CGFloat = 0


    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Check the services to show. Drag a row or use the arrows to reorder. Changes save automatically.")
                .font(.callout).foregroundStyle(.secondary)
            ZStack(alignment: .topLeading) {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(model.preferences.order, id: \.self) { id in
                            if let service = MenuBarGlyphs.services.first(where: { $0.id == id }) {
                                serviceRow(id, name: service.name)
                            }
                        }
                    }
                }
                if let id = draggedService,
                   let service = MenuBarGlyphs.services.first(where: { $0.id == id }),
                   let frame = rowFrames[id] {
                    serviceRowContent(id, name: service.name)
                        .frame(width: frame.width)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .windowBackgroundColor)))
                        .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
                        .offset(x: frame.minX, y: dragY - grabOffset)
                        .allowsHitTesting(false)
                }
            }
            .coordinateSpace(name: "serviceRows")
            .onPreferenceChange(ServiceRowFrames.self) { rowFrames = $0 }
            Text("Hidden services still refresh and appear in the dashboard.")
                .font(.caption).foregroundStyle(.secondary)
            Button("Restore defaults") { model.restoreDefaults() }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onDisappear { draggedService = nil }
    }

    private func serviceRow(_ id: String, name: String) -> some View {
        serviceRowContent(id, name: name)
            .opacity(draggedService == id ? 0.15 : 1)
            .background(GeometryReader { geo in
                Color.clear.preference(key: ServiceRowFrames.self, value: [id: geo.frame(in: .named("serviceRows"))])
            })
            .contentShape(Rectangle())
            .simultaneousGesture(DragGesture(minimumDistance: 5, coordinateSpace: .named("serviceRows"))
                .onChanged { value in
                    if draggedService == nil {
                        draggedService = id
                        grabOffset = value.startLocation.y - (rowFrames[id]?.minY ?? value.startLocation.y)
                    }
                    dragY = value.location.y
                    guard let target = model.preferences.order.first(where: {
                        $0 != id && rowFrames[$0]?.contains(value.location) == true
                    }) else { return }
                    withAnimation(.easeInOut(duration: 0.16)) {
                        model.moveService(id, to: target)
                    }
                }
                .onEnded { _ in draggedService = nil })
    }

    private func serviceRowContent(_ id: String, name: String) -> some View {
        let order = model.preferences.order
        let index = order.firstIndex(of: id) ?? 0
        let meters = model.metersForService(id)
        let selected = model.preferences.meterIDs[id] ?? ""
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Toggle(isOn: Binding(
                    get: { !model.preferences.hidden.contains(id) },
                    set: { model.setVisible(id, $0) }
                )) {
                    HStack(spacing: 6) {
                        if let icon = MenuBarGlyphs.icon(for: id, size: 16) {
                            Image(nsImage: icon).renderingMode(.template)
                        }
                        Text(name)
                    }
                }
                .toggleStyle(.checkbox)
                Spacer()
                Button {
                    model.moveService(id, to: order[index - 1])
                } label: { Image(systemName: "chevron.up") }
                .disabled(index == 0)
                .help("Move \(name) up")
                .accessibilityLabel("Move \(name) up")
                Button {
                    model.moveService(id, to: order[index + 1])
                } label: { Image(systemName: "chevron.down") }
                .disabled(index == order.count - 1)
                .help("Move \(name) down")
                .accessibilityLabel("Move \(name) down")
            }
            Picker("Show", selection: Binding(
              get: { model.preferences.meterIDs[id] ?? "" },
              set: { model.setMeter(id, $0) }
            )) {
                Text("Highest usage").tag("")
                ForEach(meters) { meter in Text(meter.label).tag(meter.id) }
                if !selected.isEmpty && !meters.contains(where: { $0.id == selected }) {
                    Text("\(selected) (unavailable)").tag(selected)
                }
            }
            .pickerStyle(.menu)
            .accessibilityLabel("Meter shown for \(name)")
        }
        .controlSize(.small)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }
}

struct ServiceRowFrames: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct ProviderCard: View {
    let provider: Status.Provider
    @ObservedObject var model: StatusModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 6) {
                if let icon = MenuBarGlyphs.icon(for: provider.id, size: 16) {
                    Image(nsImage: icon)
                        .renderingMode(.template)
                }
                Text(provider.name).font(.headline)
                if let plan = provider.planLabel { Text(plan).font(.caption).foregroundStyle(.secondary) }
                Spacer()
            }
            ForEach(provider.meters) { MeterRow(meter: $0) }
            if provider.meters.isEmpty {
                Text(provider.emptyText ?? "No usage reading yet.").font(.callout).foregroundStyle(.secondary)
                if provider.canOpenBrowser == true {
                    Button(provider.actionLabel ?? "Open browser") { Task { await model.logIn(provider.id) } }.controlSize(.small)
                        .disabled(model.loginNote[provider.id] == "Opening…")
                    if let note = model.loginNote[provider.id] { Text(note).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }
}

struct MeterRow: View {
    let meter: Status.Meter

    var body: some View {
        let pct = meter.usedPercent ?? 0
        let color = PaceText.color(meter.pace.status)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(meter.label).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                pill(color: meter.pace.status == "ok" ? .blue : color)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.1))
                    Capsule().fill(color).frame(width: geo.size.width * min(1, pct / 100))
                    if let e = meter.pace.expectedPercent {
                        Rectangle().fill(Color.primary).frame(width: 2, height: 12).offset(x: geo.size.width * min(1, e / 100) - 1)
                    }
                }
            }
            .frame(height: 7)
            HStack(spacing: 6) {
                Text(meter.usedPercent.map { "\(Int($0.rounded()))%" } ?? "?").font(.callout.monospacedDigit().weight(.semibold))
                Text(PaceText.label[meter.pace.status] ?? "").font(.caption).foregroundStyle(.secondary)
                if meter.stale { Text("· last read \(ago(parseDate(meter.capturedAt)))").font(.caption).foregroundStyle(.orange) }
            }
        }
    }

    private func pill(color: Color) -> some View {
        let date = parseDate(meter.resetsAt)
        let text = date.map { $0.timeIntervalSinceNow > 0 ? shortDuration($0.timeIntervalSinceNow) : "reset" } ?? "?"
        return Label(text, systemImage: "arrow.clockwise")
            .font(.caption.monospacedDigit().weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.18)))
            .foregroundStyle(color)
            .help(date.map { "Resets \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Reset time unknown")
    }
}
