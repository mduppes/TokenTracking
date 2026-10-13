import Foundation

/// Display preferences only; hiding a slot never disables collection or dashboard meters.
struct MenuBarPreferences: Codable, Equatable {
    static let serviceIDs = ["claude", "cursor", "antigravity", "grok-bot", "openai", "muse", "gemini"]
    static let defaults = MenuBarPreferences(order: serviceIDs, hidden: ["gemini"])
    static let storageKey = "menuBarPreferences.v1"

    var order: [String]
    var hidden: Set<String>
    var meterIDs: [String: String]
    var visibleIDs: [String] { order.filter { !hidden.contains($0) } }

    init(order: [String], hidden: Set<String>, meterIDs: [String: String] = [:]) {
        self.order = order
        self.hidden = hidden
        self.meterIDs = meterIDs
    }

    private enum CodingKeys: String, CodingKey { case order, hidden, meterIDs }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        order = try values.decode([String].self, forKey: .order)
        hidden = try values.decode(Set<String>.self, forKey: .hidden)
        meterIDs = try values.decodeIfPresent([String: String].self, forKey: .meterIDs) ?? [:]
    }

    func normalized() -> Self {
        var seen = Set<String>()
        let known = order.filter { Self.serviceIDs.contains($0) && seen.insert($0).inserted }
        let added = Self.serviceIDs.filter { !seen.contains($0) }
        // Future services appear in the editor without unexpectedly widening the menu bar.
        return Self(order: known + added, hidden: hidden.intersection(Self.serviceIDs).union(added),
                    meterIDs: meterIDs.filter { Self.serviceIDs.contains($0.key) && !$0.value.isEmpty })
    }

    mutating func move(_ id: String, to target: String) {
        guard id != target, let from = order.firstIndex(of: id), let to = order.firstIndex(of: target) else { return }
        order.remove(at: from)
        order.insert(id, at: to)
    }

    static func load(from store: UserDefaults = .standard) -> Self {
        guard let data = store.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode(Self.self, from: data) else { return defaults }
        return saved.normalized()
    }

    func save(to store: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { store.set(data, forKey: Self.storageKey) }
    }
}
