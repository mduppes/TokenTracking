// TokenTracking menu bar app: shows the most at-risk usage meter in the macOS menu bar and a compact
// dashboard (served by the local service at /?compact) in a pop-down panel. No dependencies; built
// with `npm run build:menubar` (swiftc, no Xcode project). See docs/ARCHITECTURE.md.
import SwiftUI
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
    struct Provider: Decodable, Identifiable {
        let id: String; let name: String; let planLabel: String?; let meters: [Meter]
    }
    struct Meter: Decodable, Identifiable {
        let id: String; let label: String; let window: String; let usedPercent: Double?
        let resetsAt: String?; let capturedAt: String; let stale: Bool; let pace: Pace
    }
    struct Pace: Decodable { let status: String; let expectedPercent: Double? }
    struct Headless: Decodable { let nextAt: String? }
    /// Built by the service (server/src/status.js withPresentation) so the web dashboard and this panel
    /// show the same notices and resets without duplicating the rules.
    struct Notice: Decodable { let provider: String; let kind: String; let text: String; let canLogIn: Bool }
    struct Reset: Decodable {
        let provider: String; let providerName: String; let meterId: String; let label: String
        let usedPercent: Double?; let resetsAt: String; let status: String; let stale: Bool
    }
    let providers: [Provider]
    let headless: Headless?
    let notices: [Notice]
    let resetsNext: [Reset]
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
    @Published var title = "…"
    @Published var slots: [MenuSlot] = []
    @Published var tooltip = "TokenTracking"
    @Published var symbol = "gauge.with.dots.needle.0percent"
    @Published var reachable = true
    @Published var refreshing = false
    @Published var menuBarHidden = false
    /// Latest /api/status, rendered natively by PanelView. (The panel used to be a WKWebView of the
    /// dashboard, but after the Mac slept it often drew nothing at all, even when recreated: 2026-10-11.)
    @Published var status: Status?
    @Published var loginNote: [String: String] = [:]

    private var timer: Timer?

    init() {
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

    /// Menu bar: per-service digits; tooltip: per-service values + the most at-risk meter.
    private func apply(_ s: Status) {
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
        _ = try? await post("api/refresh", body: "{}", timeout: 180)
        refreshing = false
        poll()
    }

    /// Opens the TokenTracking browser on a provider's login page (POST /api/login).
    func logIn(_ provider: String) async {
        loginNote[provider] = "Opening…"
        do {
            let (data, res) = try await post("api/login", body: "{\"provider\":\"\(provider)\"}", timeout: 10)
            let ok = (res as? HTTPURLResponse)?.statusCode == 200
            let reason = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["reason"] as? String
            loginNote[provider] = ok ? "Log in, then quit that window (⌘Q). It refreshes automatically." : (reason ?? "Couldn't open the login window.")
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

    var body: some View {
        VStack(spacing: 0) {
            if model.menuBarHidden { hiddenBanner; Divider() }
            if !model.reachable {
                VStack(spacing: 8) {
                    Image(systemName: "bolt.horizontal.circle").font(.largeTitle).foregroundStyle(.secondary)
                    Text("The TokenTracking service isn't running.").font(.headline)
                    Text("It's started automatically; see ~/.tokentracking/service.log").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let s = model.status {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header(s)
                        notices(s)
                        resetsNext(s)
                        ForEach(s.providers) { ProviderCard(provider: $0) }
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
            notice(id: n.provider, color: n.kind == "login" ? .red : n.kind == "error" ? .orange : .secondary, text: n.text, canLogIn: n.canLogIn)
        }
    }

    private func notice(id: String, color: Color, text: String, canLogIn: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(color).frame(width: 8, height: 8).padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
                if let note = model.loginNote[id] { Text(note).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 4)
            if canLogIn, model.loginNote[id] == nil {
                Button("Log in") { Task { await model.logIn(id) } }.controlSize(.small)
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
                    HStack {
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

struct ProviderCard: View {
    let provider: Status.Provider

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(provider.name).font(.headline)
                if let plan = provider.planLabel { Text(plan).font(.caption).foregroundStyle(.secondary) }
                Spacer()
            }
            ForEach(provider.meters) { MeterRow(meter: $0) }
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
