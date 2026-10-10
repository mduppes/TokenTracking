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
            // If the menu bar is full (common with a notch), macOS silently doesn't show new items.
            // Fall back to a Dock icon that opens the same panel in a small window.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { MainActor.assumeIsolated { self.checkVisible() } }
        }
    }

    private var fallbackWindow: NSWindow?

    @MainActor private func checkVisible() {
        let visible = statusItem.button?.window?.occlusionState.contains(.visible) ?? false
        guard !visible else { return }
        NSLog("TokenTracking: menu bar item not visible (menu bar full?); showing Dock icon + window")
        NSApp.setActivationPolicy(.regular)
        showWindow()
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
        let image = NSImage(systemSymbolName: model.symbol, accessibilityDescription: "TokenTracking usage")
        image?.isTemplate = true
        button.image = image
        button.title = " " + model.title
        button.toolTip = model.tooltip
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

// MARK: - Status polling

struct Status: Decodable {
    struct Provider: Decodable { let id: String; let name: String; let meters: [Meter] }
    struct Meter: Decodable { let label: String; let usedPercent: Double?; let pace: Pace }
    struct Pace: Decodable { let status: String }
    let providers: [Provider]
}

@MainActor
final class StatusModel: ObservableObject {
    @Published var title = "…"
    @Published var tooltip = "TokenTracking"
    @Published var symbol = "gauge.with.dots.needle.0percent"
    @Published var reachable = true
    @Published var refreshing = false

    lazy var webView: WKWebView = {
        let w = WKWebView()
        w.setValue(false, forKey: "drawsBackground")
        w.load(URLRequest(url: URL(string: "/?compact", relativeTo: baseURL)!))
        return w
    }()

    private var timer: Timer?

    init() {
        Task { @MainActor in
            await ServiceRunner.shared.ensureRunning()
            self.poll()
            self.webView.reload()
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
        tooltip = "Most at risk: \(name) · \(top.label): \(Int(pct.rounded()))% used\(paceText.isEmpty ? "" : " (\(paceText))")"
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
        if reachable { webView.reload() }
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
        webView.reload()
    }
}

// MARK: - Panel

struct WebView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct PanelView: View {
    @ObservedObject var model: StatusModel

    var body: some View {
        VStack(spacing: 0) {
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
