// TokenTracking menu bar app: shows the most at-risk usage meter in the macOS menu bar and a compact
// dashboard (served by the local service at /?compact) in a pop-down panel. No dependencies; built
// with `npm run build:menubar` (swiftc, no Xcode project). See docs/ARCHITECTURE.md.
import SwiftUI
import WebKit
import Combine

let baseURL = URL(string: ProcessInfo.processInfo.environment["TOKENTRACKING_URL"] ?? "http://127.0.0.1:7878")!

// MARK: - Local service ownership
// The app is the only thing the user runs: if the Node service isn't already up, start it as a child
// process (paths baked in at build time, see BuildConfig.swift) and stop it again on quit.
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
            // "{icon}3 {icon}9 {icon}-": one icon + usage digit per service, drawn as one template image.
            button.image = MenuBarGlyphs.image(for: model.slots)
            button.imagePosition = .imageOnly
            button.title = ""
        } else {
            let image = NSImage(systemSymbolName: model.symbol, accessibilityDescription: "TokenTracking usage")
            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageLeading
            button.title = " " + model.title
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

/// One service in the menu bar: an SF Symbol and a single character for its worst meter.
struct MenuSlot: Equatable {
    let symbol: String
    let text: String   // "0"…"99" = % used, "––" = at the limit, "??" = no reading
}

enum MenuBarGlyphs {
    /// Services shown in the menu bar, in order. Grok Bot is a separate limit inside Cursor.
    /// Gemini is deliberately left out (its app limits stay near 0% for this user); it's still on the dashboard.
    static let services: [(id: String, symbol: String, name: String, matches: (String, String) -> Bool)] = [
        ("claude", "asterisk", "Claude", { p, _ in p == "claude" }),
        ("cursor", "cursorarrow", "Cursor", { p, m in p == "cursor" && m != "grok-bot" }),
        ("antigravity", "arrow.up.circle", "Antigravity", { p, _ in p == "antigravity" }),
        ("grok-bot", "xmark", "Grok Bot", { p, m in p == "cursor" && m == "grok-bot" }),
        ("muse", "m.circle", "Muse", { p, _ in p == "muse" }),
    ]

    /// Two characters: % used 0–99 (single digits padded with a trailing figure space so the width is
    /// stable), "––" at/over the limit.
    static func digits(_ pct: Double) -> String {
        if pct >= 100 { return "––" }
        let n = min(99, max(0, Int(pct)))
        return n < 10 ? "\(n)\u{2007}" : String(n) // pad after, so the digit stays next to its icon
    }

    /// Draw icons and digits in black on a transparent image and mark it as a template, so macOS
    /// tints it for light/dark menu bars and the pressed state, like any other menu bar icon.
    static func image(for slots: [MenuSlot]) -> NSImage {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .medium)
        let config = NSImage.SymbolConfiguration(pointSize: 12, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.black]
        let height: CGFloat = 18, iconGap: CGFloat = 1.5, slotGap: CGFloat = 6
        let parts = slots.map { slot -> (NSImage?, NSAttributedString) in
            (NSImage(systemSymbolName: slot.symbol, accessibilityDescription: nil)?.withSymbolConfiguration(config),
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
    struct Provider: Decodable { let id: String; let name: String; let meters: [Meter] }
    struct Meter: Decodable { let id: String; let label: String; let usedPercent: Double?; let pace: Pace; let stale: Bool }
    struct Pace: Decodable { let status: String }
    let providers: [Provider]
}

@MainActor
final class StatusModel: ObservableObject {
    @Published var title = "…"
    @Published var slots: [MenuSlot] = []
    @Published var tooltip = "TokenTracking"
    @Published var symbol = "gauge.with.dots.needle.0percent"
    @Published var reachable = true
    @Published var refreshing = false
    @Published var menuBarHidden = false

    private let panelURL = URL(string: "/?compact", relativeTo: baseURL)!
    private let webGuard = WebGuard()

    lazy var webView: WKWebView = {
        let w = WKWebView()
        w.setValue(false, forKey: "drawsBackground")
        w.navigationDelegate = webGuard
        webGuard.reload = { [weak self] in self?.loadPanel() }
        w.load(URLRequest(url: panelURL))
        return w
    }()

    /// Always a fresh load, not reload(): after sleep the page's web process can be gone (blank panel),
    /// or the first load may have failed before the service was up. Either way reload() has nothing to reload.
    func loadPanel() {
        webView.load(URLRequest(url: panelURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private var timer: Timer?

    init() {
        Task { @MainActor in
            await ServiceRunner.shared.ensureRunning()
            self.poll()
            self.loadPanel()
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
                apply(try JSONDecoder().decode(Status.self, from: data))
                reachable = true
            } catch {
                reachable = false
                title = "–"
                symbol = "exclamationmark.triangle"
            }
        }
    }

    /// Title = the most at-risk meter: worst pace status first, then highest % used.
    private func apply(_ s: Status) {
        // Per-service digits: the worst (highest %) meter of each service that has data.
        var lines: [String] = []
        slots = MenuBarGlyphs.services.compactMap { svc in
            let ms = s.providers.flatMap { p in p.meters.filter { svc.matches(p.id, $0.id) } }
            guard !ms.isEmpty else { return nil }
            guard let worst = ms.compactMap({ m in m.usedPercent.map { (m, $0) } }).max(by: { $0.1 < $1.1 }) else {
                lines.append("\(svc.name): no reading")
                return MenuSlot(symbol: svc.symbol, text: "??")
            }
            let stale = ms.contains { $0.stale } ? " · stale" : ""
            lines.append("\(svc.name): \(Int(worst.1.rounded()))% (\(worst.0.label))\(stale)")
            return MenuSlot(symbol: svc.symbol, text: MenuBarGlyphs.digits(worst.1))
        }
        let rank = ["limited": 4, "over-pace": 3, "ahead": 2, "ok": 1]
        let meters = s.providers.flatMap { p in p.meters.map { (p.name, $0) } }.filter { $0.1.usedPercent != nil }
        guard let (name, top) = meters.max(by: { a, b in
            let ra = rank[a.1.pace.status] ?? 0, rb = rank[b.1.pace.status] ?? 0
            return ra != rb ? ra < rb : a.1.usedPercent! < b.1.usedPercent!
        }), let pct = top.usedPercent else {
            title = "–"; symbol = "gauge.with.dots.needle.0percent"; tooltip = "TokenTracking: no data yet"; return
        }
        title = "\(Int(pct.rounded()))%"
        let paceText = ["limited": "limit reached", "over-pace": "will run out before reset", "ahead": "ahead of pace", "ok": "on pace"][top.pace.status] ?? ""
        tooltip = (lines + ["", "Most at risk: \(name) · \(top.label): \(Int(pct.rounded()))% used\(paceText.isEmpty ? "" : " (\(paceText))")"]).joined(separator: "\n")
        switch pct {
        case ..<25: symbol = "gauge.with.dots.needle.0percent"
        case ..<50: symbol = "gauge.with.dots.needle.33percent"
        case ..<70: symbol = "gauge.with.dots.needle.50percent"
        case ..<90: symbol = "gauge.with.dots.needle.67percent"
        default: symbol = "gauge.with.dots.needle.100percent"
        }
    }

    func panelOpened() {
        poll()
        loadPanel()
    }

    func refreshNow() async {
        refreshing = true
        var req = URLRequest(url: baseURL.appendingPathComponent("api/refresh"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = Data("{}".utf8)
        req.timeoutInterval = 180
        _ = try? await URLSession.shared.data(for: req)
        refreshing = false
        poll()
        loadPanel()
    }
}

// MARK: - Panel

/// Keeps the panel's web view alive: if WebKit's content process dies (e.g. memory pressure during sleep)
/// or a load fails (service restarting), load the page again instead of staying blank.
final class WebGuard: NSObject, WKNavigationDelegate {
    var reload: (() -> Void)?
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload?() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retry(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retry(error) }
    private func retry(_ error: Error) {
        // A newer load cancels the previous one; that's not a failure (retrying would loop forever).
        if (error as NSError).code == NSURLErrorCancelled { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.reload?() }
    }
}

struct WebView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct PanelView: View {
    @ObservedObject var model: StatusModel

    var body: some View {
        VStack(spacing: 0) {
            if model.menuBarHidden {
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
                Divider()
            }
            if model.reachable {
                WebView(webView: model.webView)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "bolt.horizontal.circle").font(.largeTitle).foregroundStyle(.secondary)
                    Text("The TokenTracking service isn't running.").font(.headline)
                    Text("It's started automatically; see ~/.tokentracking/service.log").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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
}
