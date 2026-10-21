import Foundation

struct ServiceSetup: Decodable {
    let selectedProviders: [String]
    let completed: Bool
    let chromeAvailable: Bool
    let browserOpen: Bool
    let refreshing: Bool
    var needsSetup: Bool { !completed }
}

struct SetupService: Identifiable {
    let id: String
    let name: String
    let detail: String
    var needsBrowser: Bool { id != "antigravity" }
    static let all: [SetupService] = [
        .init(id: "claude", name: "Claude", detail: "Claude and Claude Code subscription limits"),
        .init(id: "cursor", name: "Cursor", detail: "Includes the separate Grok Bot limit"),
        .init(id: "openai", name: "ChatGPT", detail: "5-hour and weekly limits"),
        .init(id: "antigravity", name: "Antigravity", detail: "Reads local limits while Antigravity is running"),
        .init(id: "muse", name: "Muse", detail: "Weekly usage limit"),
        .init(id: "gemini", name: "Gemini", detail: "Gemini app usage limits"),
    ]

    static func menuIDs(for providers: Set<String>) -> Set<String> {
        var ids = providers.intersection(all.map(\.id))
        if ids.contains("cursor") { ids.insert("grok-bot") }
        return ids
    }
}
