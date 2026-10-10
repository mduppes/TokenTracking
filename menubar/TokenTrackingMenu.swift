// TokenTracking menu bar app: shows the most at-risk usage meter in the macOS menu bar and a compact
// dashboard (served by the local service at /?compact) in a pop-down panel. No dependencies; built
// with `npm run build:menubar` (swiftc, no Xcode project). See docs/ARCHITECTURE.md.
import SwiftUI
import WebKit

let baseURL = URL(string: ProcessInfo.processInfo.environment["TOKENTRACKING_URL"] ?? "http://127.0.0.1:7878")!

@main
struct TokenTrackingMenuApp: App {
    @StateObject private var model = StatusModel()

    var body: some Scene {
        MenuBarExtra {
            PanelView(model: model)
        } label: {
            HStack(spacing: 3) {
                Image(systemName: model.symbol)
                Text(model.title)
            }
        }
        .menuBarExtraStyle(.window)
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
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.poll() }
        }
    }

    func poll() {
        Task {
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
        let meters = s.providers.flatMap { $0.meters }.filter { $0.usedPercent != nil }
        guard let top = meters.max(by: { a, b in
            let ra = rank[a.pace.status] ?? 0, rb = rank[b.pace.status] ?? 0
            return ra != rb ? ra < rb : a.usedPercent! < b.usedPercent!
        }), let pct = top.usedPercent else {
            title = "–"; symbol = "gauge.with.dots.needle.0percent"; return
        }
        title = "\(Int(pct.rounded()))%"
        switch pct {
        case ..<25: symbol = "gauge.with.dots.needle.0percent"
        case ..<50: symbol = "gauge.with.dots.needle.33percent"
        case ..<70: symbol = "gauge.with.dots.needle.50percent"
        case ..<90: symbol = "gauge.with.dots.needle.67percent"
        default: symbol = "gauge.with.dots.needle.100percent"
        }
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
                    Text("Start it with `npm start` in the project folder.").foregroundStyle(.secondary)
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
        .onAppear {
            model.poll()
            if model.reachable { model.webView.reload() }
        }
    }
}
