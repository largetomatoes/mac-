import Foundation
import Capacitor
import CryptoKit
import UIKit
import UniformTypeIdentifiers

/// 问间 iOS 原生插件（移植自安卓 WenjianStoragePlugin.java / NutstoreClient.java / OssV4Signer.java）。
/// 凭据使用 AES-GCM 加密后保存在应用沙盒（密钥存系统钥匙串），文件格式与安卓完全一致。
@objc(WenjianStoragePlugin)
public class WenjianStoragePlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "WenjianStoragePlugin"
    public let jsName = "WenjianStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "appReleases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openRelease", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readStore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeStore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bookInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importBook", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSyncIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSyncConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connectSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detachSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remote", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transferBook", returnType: CAPPluginReturnPromise)
    ]

    private let disk = DispatchQueue(label: "com.wenjian.reader.disk", qos: .userInitiated)
    private let network = DispatchQueue(label: "com.wenjian.reader.network", qos: .userInitiated, attributes: .concurrent)
    private let maxStoreBytes = 128 * 1024 * 1024
    private let maxBookBytes: Int64 = 5 * 1024 * 1024 * 1024
    private var pendingImport: CAPPluginCall?
    private weak var importPicker: UIDocumentPickerViewController?

    struct PluginError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }

    /// JS 调用参数（等价于安卓的 call.getData() / call.getObject()）。
    private func arguments(_ call: CAPPluginCall) -> [String: Any] {
        call.options as? [String: Any] ?? [:]
    }

    private func argumentObject(_ call: CAPPluginCall, _ key: String) -> [String: Any]? {
        arguments(call)[key] as? [String: Any]
    }

    // MARK: - 存储位置

    private func directory() throws -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private func bookFile(_ name: String?) throws -> URL {
        guard let name = name, name.range(of: "^[a-zA-Z0-9._-]+\\.(pdf|epub)$", options: .regularExpression) != nil else {
            throw PluginError("书籍文件名无效")
        }
        let dir = try directory().appendingPathComponent("books", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(name)
    }

    private func atomicWrite(_ target: URL, _ data: Data) throws {
        let temporary = URL(fileURLWithPath: target.path + ".tmp-" + UUID().uuidString)
        try data.write(to: temporary)
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.moveItem(at: temporary, to: target)
    }

    // MARK: - 加密配置存储（密钥在钥匙串，密文文件与安卓格式一致）

    private func secretKey() throws -> SymmetricKey {
        let account = "wenjian-secure-key-v1"
        if let existing = try? keychainLoad(account: account) {
            return SymmetricKey(data: existing)
        }
        var keyData = Data(count: 32)
        let result = keyData.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard result == errSecSuccess else { throw PluginError("无法生成加密密钥") }
        try keychainStore(account: account, data: keyData)
        return SymmetricKey(data: keyData)
    }

    private func keychainStore(account: String, data: Data) throws {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.wenjian.reader",
            kSecAttrAccount as String: account
        ]
        SecItemDelete(base as CFDictionary)
        var attributes = base
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw PluginError("无法保存加密密钥")
        }
    }

    private func keychainLoad(account: String) throws -> Data {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.wenjian.reader",
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            throw PluginError("无法读取加密密钥")
        }
        return data
    }

    private func encryptJSON(_ object: [String: Any]) throws -> Data {
        let plaintext = try JSONSerialization.data(withJSONObject: object)
        let sealed = try AES.GCM.seal(plaintext, using: try secretKey())
        // 与安卓格式一致：data = 密文 || GCM tag
        let payload: [String: Any] = [
            "iv": sealed.nonce.withUnsafeBytes { Data($0) }.base64EncodedString(),
            "data": (sealed.ciphertext + sealed.tag).base64EncodedString()
        ]
        return try JSONSerialization.data(withJSONObject: payload)
    }

    private func decryptJSON(_ data: Data) throws -> [String: Any] {
        let saved = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let ivString = saved?["iv"] as? String, let dataString = saved?["data"] as? String,
              let iv = Data(base64Encoded: ivString), let body = Data(base64Encoded: dataString),
              body.count > 16 else {
            throw PluginError("加密资料格式不正确")
        }
        let nonce = try AES.GCM.Nonce(data: iv)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: body.dropLast(16), tag: body.suffix(16))
        let plaintext = try AES.GCM.open(box, using: try secretKey())
        return (try JSONSerialization.jsonObject(with: plaintext)) as? [String: Any] ?? [:]
    }

    private func saveSecureFile(_ name: String, _ object: [String: Any]) throws {
        try atomicWrite(try directory().appendingPathComponent(name), try encryptJSON(object))
    }

    private func loadSecureFile(_ name: String) throws -> [String: Any]? {
        let file = try directory().appendingPathComponent(name)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try decryptJSON(try Data(contentsOf: file))
    }

    // MARK: - 资料库读写

    @objc func readStore(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do {
                let file = try self.directory().appendingPathComponent("reader-store.json")
                var result: [String: Any] = [:]
                let backup = URL(fileURLWithPath: file.path + ".bak")
                let fm = FileManager.default
                let target = fm.fileExists(atPath: file.path) ? file : (fm.fileExists(atPath: backup.path) ? backup : nil)
                if let target = target {
                    let data = try Data(contentsOf: target)
                    if data.count > self.maxStoreBytes { throw PluginError("本地资料过大") }
                    result["text"] = String(decoding: data, as: UTF8.self)
                }
                call.resolve(result)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func writeStore(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do {
                guard let text = call.getString("text") else { throw PluginError("本地资料过大") }
                let data = Data(text.utf8)
                if data.count > self.maxStoreBytes { throw PluginError("本地资料过大") }
                if (try? JSONSerialization.jsonObject(with: data)) == nil { throw PluginError("本地资料格式不正确") }
                let fm = FileManager.default
                let target = try self.directory().appendingPathComponent("reader-store.json")
                let previous = try self.directory().appendingPathComponent("reader-previous.json")
                if fm.fileExists(atPath: target.path) {
                    try? fm.removeItem(at: previous)
                    try fm.copyItem(at: target, to: previous)
                }
                try self.atomicWrite(target, data)
                call.resolve(["ok": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - 书籍

    @objc func bookInfo(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do {
                let file = try self.bookFile(call.getString("name"))
                let available = FileManager.default.fileExists(atPath: file.path)
                call.resolve(["available": available, "uri": file.absoluteString])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func importBook(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let viewController = self.bridge?.viewController else {
                call.reject("无法打开文件选择窗口")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.pdf, UTType.epub], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pendingImport = call
            self.importPicker = picker
            viewController.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingImport, let source = urls.first else { return }
        pendingImport = nil
        let name = source.lastPathComponent
        let lowered = name.lowercased()
        let format = lowered.hasSuffix(".epub") ? "epub" : lowered.hasSuffix(".pdf") ? "pdf" : ""
        if format.isEmpty {
            call.reject("请选择 PDF 或 EPUB 文件")
            return
        }
        network.async { [weak self] in
            guard let self = self else { return }
            do {
                let started = source.startAccessingSecurityScopedResource()
                defer { if started { source.stopAccessingSecurityScopedResource() } }
                let temporary = try self.directory().appendingPathComponent("import-" + UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: temporary) }
                var hasher = SHA256()
                var size: Int64 = 0
                let input = try FileHandle(forReadingFrom: source)
                let output = try FileHandle(forWritingTo: temporary)
                defer { try? input.close(); try? output.close() }
                while true {
                    let chunk = try input.read(upToCount: 64 * 1024) ?? Data()
                    if chunk.isEmpty { break }
                    size += Int64(chunk.count)
                    if size > self.maxBookBytes { throw PluginError("书籍超过 5 GB") }
                    hasher.update(data: chunk)
                    try output.write(contentsOf: chunk)
                }
                try output.synchronize()
                let sha = OssV4Signer.hex(Data(hasher.finalize()))
                let header = try Data(contentsOf: temporary, options: .mappedIfSafe).prefix(5)
                let magicOK = format == "pdf"
                    ? String(decoding: header, as: UTF8.self) == "%PDF-"
                    : header.count >= 2 && header[header.startIndex] == 0x50 && header[header.startIndex + 1] == 0x4B
                if !magicOK { throw PluginError("文件格式与扩展名不符") }
                let stored = sha + "." + format
                let target = try self.bookFile(stored)
                if !FileManager.default.fileExists(atPath: target.path) {
                    try FileManager.default.moveItem(at: temporary, to: target)
                }
                call.resolve(["name": name, "storedFile": stored, "format": format, "sha256": sha, "size": NSNumber(value: size)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingImport?.resolve(["cancelled": true])
        pendingImport = nil
    }

    // MARK: - 版本与更新

    @objc func appReleases(_ call: CAPPluginCall) {
        network.async {
            var request = URLRequest(url: URL(string: "https://api.github.com/repos/largetomatoes/mac-/releases?per_page=30")!)
            request.timeoutInterval = 8
            request.setValue("Wenjian-Update-Check", forHTTPHeaderField: "User-Agent")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            URLSession.shared.dataTask(with: request) { data, response, error in
                if let error = error {
                    call.reject(error.localizedDescription.contains("timed out") ? "连接发布服务器超时，请稍后重试。" : "暂时无法连接 GitHub，请检查网络后重试。")
                    return
                }
                guard let http = response as? HTTPURLResponse, let data = data, data.count <= 4 * 1024 * 1024 else {
                    call.reject("更新信息过大")
                    return
                }
                guard http.statusCode == 200 else {
                    call.reject((http.statusCode == 403 || http.statusCode == 429) ? "更新检查达到访问限额，请稍后重试。" : "未能读取正式发布信息，请稍后重试。")
                    return
                }
                if let releases = (try? JSONSerialization.jsonObject(with: data)) as? [Any] {
                    call.resolve(["releases": releases])
                } else {
                    call.reject("更新信息格式不正确")
                }
            }.resume()
        }
    }

    @objc func openRelease(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let value = call.getString("url"), let url = URL(string: value) else {
                call.reject("发布链接无效")
                return
            }
            let path = url.path
            let valid = url.scheme == "https" && url.host == "github.com" && url.port == nil && url.user == nil
                && url.password == nil && url.query == nil && url.fragment == nil
                && (path == "/largetomatoes/mac-/releases"
                    || path.hasPrefix("/largetomatoes/mac-/releases/tag/")
                    || path.hasPrefix("/largetomatoes/mac-/releases/download/"))
            guard valid else {
                call.reject("发布链接无效")
                return
            }
            UIApplication.shared.open(url) { ok in
                if ok { call.resolve(["ok": true]) } else { call.reject("未能打开浏览器，请检查系统浏览器。") }
            }
        }
    }

    // MARK: - OSS 配置

    private func ossConfig() throws -> [String: Any]? {
        try loadSecureFile("oss-secure.json")
    }

    private func connectionConfig() throws -> [String: Any] {
        try loadSecureFile("sync-connection-secure.json") ?? ["provider": "oss"]
    }

    private static func ossTarget(_ cfg: [String: Any]?) throws -> String {
        guard let cfg = cfg, let region = cfg["region"] as? String,
              let bucket = cfg["bucket"] as? String, let prefix = cfg["prefix"] as? String else { return "" }
        return region + "/" + bucket + "/" + prefix
    }

    private func publicConfig(_ cfg: [String: Any]?) -> [String: Any] {
        var result: [String: Any] = ["configured": cfg != nil]
        if let cfg = cfg {
            for field in ["region", "bucket", "prefix", "accessKeyId"] {
                if let value = cfg[field] as? String { result[field] = value }
            }
        }
        return result
    }

    @objc func getConfig(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do { call.resolve(self.publicConfig(try self.ossConfig())) }
            catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func setConfig(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do {
                guard let input = argumentObject(call, "config") else { throw PluginError("请填写 OSS 设置") }
                let old = try self.ossConfig()
                let region = input["region"] as? String ?? ""
                let bucket = input["bucket"] as? String ?? ""
                var prefix = (input["prefix"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "wenjian/"
                let id = input["accessKeyId"] as? String ?? ""
                var secret = input["accessKeySecret"] as? String ?? ""
                if secret.isEmpty, let old = old { secret = old["accessKeySecret"] as? String ?? "" }
                let match = { (value: String, pattern: String) -> Bool in
                    value.range(of: pattern, options: .regularExpression) != nil
                }
                guard match(region, "^[a-z][a-z0-9]*(-[a-z0-9]+)+$"),
                      match(bucket, "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"),
                      match(id, "^[A-Za-z0-9_-]{8,128}$"),
                      secret.count >= 8, secret.count <= 256,
                      !secret.contains("\n"), !secret.contains("\r") else {
                    throw PluginError("OSS 设置格式不正确")
                }
                if prefix.isEmpty { prefix = "wenjian/" }
                guard !prefix.hasPrefix("/"), !prefix.contains(".."), !prefix.contains("//"),
                      !match(prefix, "[\\\\?#\\p{Cntrl}]"), prefix.count <= 500 else {
                    throw PluginError("目录前缀格式不正确")
                }
                if !prefix.hasSuffix("/") { prefix += "/" }
                let cfg: [String: Any] = ["region": region, "bucket": bucket, "prefix": prefix,
                                          "accessKeyId": id, "accessKeySecret": secret]
                let notebook = try self.directory().appendingPathComponent("reader-store.json")
                if FileManager.default.fileExists(atPath: notebook.path),
                   (try self.connectionConfig())["provider"] as? String == "oss" {
                    let bundle = try JSONSerialization.jsonObject(with: Data(contentsOf: notebook)) as? [String: Any]
                    if let sync = bundle?["sync"] as? [String: Any] {
                        let target = sync["target"] as? String ?? ""
                        let newTarget = try Self.ossTarget(cfg)
                        if !target.isEmpty && target != newTarget && !Self.canCorrectUnconfirmedSync(sync) {
                            throw PluginError("请先在三端同步中更换资料库，再修改 OSS 位置")
                        }
                    }
                }
                try self.saveSecureFile("oss-secure.json", cfg)
                call.resolve(self.publicConfig(cfg))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - 同步连接

    private func syncIdentity() throws -> [String: Any] {
        let connection = try connectionConfig()
        let provider = connection["provider"] as? String ?? "oss"
        let target = provider == "nutstore"
            ? ((connection["username"] as? String) != nil ? try NutstoreClient.target(connection) : "")
            : try Self.ossTarget(try ossConfig())
        let configured = provider == "nutstore" ? (connection["password"] as? String) != nil : (try ossConfig()) != nil
        return [
            "provider": provider,
            "configured": configured,
            "username": connection["username"] as? String ?? "",
            "target": target,
            "verified": !target.isEmpty && target == (connection["checkedTarget"] as? String ?? ""),
            "remoteHasData": connection["remoteHasData"] as? Bool ?? false,
            "directory": "问间资料库"
        ]
    }

    @objc func getSyncIdentity(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do { call.resolve(try self.syncIdentity()) }
            catch { call.reject(error.localizedDescription) }
        }
    }

    private static func canCorrectUnconfirmedSync(_ sync: [String: Any]) -> Bool {
        if !(sync["lastSync"] as? String ?? "").isEmpty { return false }
        if (sync["device"] as? String ?? "").isEmpty { return false }
        if let published = sync["published"] as? [Any], !published.isEmpty { return false }
        guard let received = sync["received"] as? [Any], received.isEmpty,
              let operations = sync["operations"] as? [[String: Any]],
              let pending = sync["pending"] as? [[String: Any]],
              operations.count == pending.count else { return false }
        var queued: [String: [String: Any]] = [:]
        for operation in pending {
            guard let id = operation["id"] as? String, queued[id] == nil else { return false }
            queued[id] = operation
        }
        let device = sync["device"] as? String ?? ""
        func canonical(_ value: [String: Any]) -> String {
            (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
                .map { String(decoding: $0, as: UTF8.self) } ?? ""
        }
        for operation in operations {
            guard let id = operation["id"] as? String, operation["device"] as? String == device,
                  let copy = queued[id], canonical(copy) == canonical(operation) else { return false }
        }
        return true
    }

    private func candidate(_ input: [String: Any]?) throws -> [String: Any] {
        guard let input = input else { throw PluginError("请选择同步服务") }
        let old = try connectionConfig()
        let provider = input["provider"] as? String ?? ""
        if provider == "nutstore" {
            let username = (input["username"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            var validated = try NutstoreClient.validate(input, previousPassword: username == (old["username"] as? String ?? "") ? (old["password"] as? String ?? "") : "")
            validated["provider"] = "nutstore"
            return validated
        }
        if provider == "oss", try ossConfig() != nil {
            return ["provider": "oss"]
        }
        throw PluginError("请先配置同步服务")
    }

    private func applyConnection(_ next: [String: Any], _ verification: [String: Any]?) throws -> [String: Any] {
        let target = next["provider"] as? String == "nutstore"
            ? try NutstoreClient.target(next)
            : try Self.ossTarget(try ossConfig())
        let store = try directory().appendingPathComponent("reader-store.json")
        if FileManager.default.fileExists(atPath: store.path) {
            let previous = try Data(contentsOf: store)
            var bundle = try JSONSerialization.jsonObject(with: previous) as? [String: Any] ?? [:]
            if let sync = bundle["sync"] as? [String: Any] {
                let current = sync["target"] as? String ?? ""
                if !current.isEmpty && current != target {
                    guard Self.canCorrectUnconfirmedSync(sync) else {
                        throw PluginError("这套资料已有云端历史，请在连接设置中选择「更换资料库」")
                    }
                    try atomicWrite(try directory().appendingPathComponent("reader-previous.json"), previous)
                    var newSync = sync
                    newSync["target"] = ""
                    newSync["enabled"] = false
                    bundle["sync"] = newSync
                    bundle["syncRevision"] = ((bundle["syncRevision"] as? NSNumber)?.int64Value ?? 0) + 1
                    try atomicWrite(store, try JSONSerialization.data(withJSONObject: bundle))
                }
            }
        }
        var saved = next
        if let verification = verification {
            saved["checkedTarget"] = target
            saved["checkedAt"] = ISO8601DateFormatter().string(from: Date())
            saved["remoteHasData"] = ((verification["keys"] as? [Any])?.count ?? 0) > 0
        }
        try saveSecureFile("sync-connection-secure.json", saved)
        return try syncIdentity()
    }

    @objc func setSyncConnection(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do {
                let next = try self.candidate(self.argumentObject(call, "config"))
                call.resolve(try self.applyConnection(next, nil))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func connectSync(_ call: CAPPluginCall) {
        network.async { [weak self] in
            guard let self = self else { return }
            do {
                let next = try self.candidate(self.argumentObject(call, "config"))
                let target = next["provider"] as? String == "nutstore"
                    ? try NutstoreClient.target(next)
                    : try Self.ossTarget(try self.ossConfig())
                let store = try self.directory().appendingPathComponent("reader-store.json")
                if FileManager.default.fileExists(atPath: store.path) {
                    let bundle = try JSONSerialization.jsonObject(with: Data(contentsOf: store)) as? [String: Any]
                    if let sync = bundle?["sync"] as? [String: Any] {
                        let current = sync["target"] as? String ?? ""
                        if !current.isEmpty && target != current && !Self.canCorrectUnconfirmedSync(sync) {
                            throw PluginError("这套资料已有云端历史，请先更换资料库")
                        }
                    }
                }
                let check: [String: Any]
                if next["provider"] as? String == "nutstore" {
                    check = try NutstoreClient(config: next).remote(["action": "check"])
                } else {
                    guard let cfg = try self.ossConfig() else { throw PluginError("请先填写 OSS 设置") }
                    check = try self.ossRemote(cfg, ["action": "check"])
                }
                self.disk.async {
                    do { call.resolve(try self.applyConnection(next, check)) }
                    catch { call.reject(error.localizedDescription) }
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - 更换资料库（含完整备份）

    private func fileDigest(_ file: URL) throws -> [String: Any] {
        var hasher = SHA256()
        var size: Int64 = 0
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        while true {
            let chunk = try handle.read(upToCount: 64 * 1024) ?? Data()
            if chunk.isEmpty { break }
            size += Int64(chunk.count)
            hasher.update(data: chunk)
        }
        return ["size": NSNumber(value: size), "sha256": OssV4Signer.hex(Data(hasher.finalize()))]
    }

    @objc func detachSync(_ call: CAPPluginCall) {
        disk.async { [weak self] in
            guard let self = self else { return }
            do {
                let store = try self.directory().appendingPathComponent("reader-store.json")
                let before = try Data(contentsOf: store, options: .mappedIfSafe)
                var bundle = try JSONSerialization.jsonObject(with: before) as? [String: Any] ?? [:]
                let sync = bundle["sync"] as? [String: Any]
                guard (call.getString("target") ?? "") == (sync?["target"] as? String ?? "") else {
                    throw PluginError("同步状态刚发生变化，请重新打开连接设置")
                }
                guard let dataDict = bundle["data"] as? [String: Any],
                      let shelf = dataDict["libraryBooks"] as? [[String: Any]] else {
                    throw PluginError("资料格式不正确")
                }
                var books: [[String: Any]] = []
                var names = Set<String>()
                for book in shelf {
                    let name = book["storedFile"] as? String ?? ""
                    if (book["format"] as? String ?? "") == "reference" && name.isEmpty { continue }
                    let file = try self.bookFile(name)
                    guard FileManager.default.fileExists(atPath: file.path) else {
                        throw PluginError("《" + (book["title"] as? String ?? "") + "》本机没有原文件，请先下载，再更换资料库")
                    }
                    if names.insert(name).inserted {
                        var entry = try self.fileDigest(file)
                        entry["storedFile"] = name
                        books.append(entry)
                    }
                }
                let draftsObject: [String: Any] = ["drafts": bundle["drafts"] as? [String: Any] ?? [:]]
                let drafts = try JSONSerialization.data(withJSONObject: draftsObject)
                var manifest: [String: Any] = [
                    "format": "wenjian-complete-backup",
                    "version": 1,
                    "createdAt": ISO8601DateFormatter().string(from: Date()),
                    "notebook": ["size": NSNumber(value: before.count), "sha256": OssV4Signer.hex(Data(SHA256.hash(data: before)))],
                    "drafts": ["size": NSNumber(value: drafts.count), "sha256": OssV4Signer.hex(Data(SHA256.hash(data: drafts)))],
                    "books": books
                ]
                let backupDir = try self.directory().appendingPathComponent("restore-safeguards")
                try FileManager.default.createDirectory(at: backupDir, withIntermediateDirectories: true)
                let destination = backupDir.appendingPathComponent("更换同步资料库-\(Int(Date().timeIntervalSince1970 * 1000)).wenjian-backup")
                let partial = URL(fileURLWithPath: destination.path + ".partial")
                defer { try? FileManager.default.removeItem(at: partial) }
                do {
                    let output = try FileHandle(forWritingTo: partial)
                    defer { try? output.close() }
                    try output.write(contentsOf: Data("WENJIAN_BACKUP_V1\n".utf8))
                    let metadata = try JSONSerialization.data(withJSONObject: manifest)
                    var length = UInt64(metadata.count).bigEndian
                    try output.write(contentsOf: withUnsafeBytes(of: &length) { Data($0) })
                    try output.write(contentsOf: metadata)
                    try output.write(contentsOf: before)
                    try output.write(contentsOf: drafts)
                    for book in books {
                        let file = try self.bookFile(book["storedFile"] as? String)
                        var hasher = SHA256()
                        var size: Int64 = 0
                        let input = try FileHandle(forReadingFrom: file)
                        defer { try? input.close() }
                        while true {
                            let chunk = try input.read(upToCount: 64 * 1024) ?? Data()
                            if chunk.isEmpty { break }
                            size += Int64(chunk.count)
                            hasher.update(data: chunk)
                            try output.write(contentsOf: chunk)
                        }
                        let sha = OssV4Signer.hex(Data(hasher.finalize()))
                        guard NSNumber(value: size) == (book["size"] as? NSNumber), sha == (book["sha256"] as? String) else {
                            throw PluginError("备份期间书籍发生变化，请重试")
                        }
                    }
                    try output.synchronize()
                    try? FileManager.default.removeItem(at: destination)
                    try FileManager.default.moveItem(at: partial, to: destination)
                }
                // 凭据旁路副本（与安卓一致：复制加密文件）
                let credentials = try self.directory().appendingPathComponent("sync-connection-secure.json")
                if FileManager.default.fileExists(atPath: credentials.path) {
                    try? self.atomicWrite(URL(fileURLWithPath: destination.path + ".connection.json"), try Data(contentsOf: credentials))
                }
                var shelfCopy = shelf
                for index in shelfCopy.indices { shelfCopy[index].removeValue(forKey: "cloudFile") }
                var newData = dataDict
                newData["libraryBooks"] = shelfCopy
                bundle["data"] = newData
                bundle["version"] = ((bundle["version"] as? NSNumber)?.int64Value ?? 0) + 1
                bundle["syncRevision"] = ((bundle["syncRevision"] as? NSNumber)?.int64Value ?? 0) + 1
                bundle["sync"] = [
                    "schema": 1, "device": UUID().uuidString, "enabled": false, "target": "",
                    "operations": [Any](), "pending": [Any](), "received": [Any](), "published": [Any](), "observed": [String: Any]()
                ]
                try self.atomicWrite(try self.directory().appendingPathComponent("reader-previous.json"), before)
                try self.atomicWrite(store, try JSONSerialization.data(withJSONObject: bundle))
                try self.saveSecureFile("sync-connection-secure.json",
                                        ["provider": (try self.connectionConfig())["provider"] as? String ?? "nutstore"])
                call.resolve(["backupPath": destination.path, "identity": try self.syncIdentity()])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - 传输分发

    private func nutstoreClient(_ requestedTarget: String?) throws -> NutstoreClient? {
        let connection = try connectionConfig()
        guard connection["provider"] as? String == "nutstore" else { return nil }
        if let requestedTarget = requestedTarget, !requestedTarget.isEmpty,
           requestedTarget != (try NutstoreClient.target(connection)) {
            throw PluginError("同步位置已改变，本次传输取消")
        }
        return try NutstoreClient(config: connection)
    }

    @objc func remote(_ call: CAPPluginCall) {
        network.async { [weak self] in
            guard let self = self else { return }
            do {
                let input = self.arguments(call)
                if let dav = try self.nutstoreClient(call.getString("target")) {
                    call.resolve(try dav.remote(input))
                    return
                }
                guard let cfg = try self.ossConfig() else { throw PluginError("请先填写 OSS 设置") }
                if let requested = call.getString("target"), !requested.isEmpty,
                   requested != (try Self.ossTarget(cfg)) {
                    throw PluginError("同步位置已改变，本次传输取消")
                }
                call.resolve(try self.ossRemote(cfg, input))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func transferBook(_ call: CAPPluginCall) {
        network.async { [weak self] in
            guard let self = self else { return }
            do {
                let action = call.getString("action") ?? ""
                let name = call.getString("name")
                let file = try self.bookFile(name)
                if let dav = try self.nutstoreClient(call.getString("target")) {
                    if action == "upload" { call.resolve(try dav.upload(file)); return }
                    if action == "download" {
                        guard let manifest = self.argumentObject(call, "file") else { throw PluginError("云端书籍清单无效") }
                        call.resolve(try dav.download(manifest, to: file))
                        return
                    }
                    throw PluginError("不支持的传输操作")
                }
                guard let cfg = try self.ossConfig() else { throw PluginError("请先填写 OSS 设置") }
                if let requested = call.getString("target"), !requested.isEmpty,
                   requested != (try Self.ossTarget(cfg)) {
                    throw PluginError("同步位置已改变，本次传输取消")
                }
                if action == "upload" {
                    guard FileManager.default.fileExists(atPath: file.path) else { throw PluginError("本机没有这本书") }
                    let digest = try self.fileDigest(file)
                    let sha = digest["sha256"] as? String ?? ""
                    let format = file.lastPathComponent.hasSuffix(".pdf") ? "pdf" : "epub"
                    let relative = "books/" + sha + "." + format
                    let objectKey = try self.ossObject(cfg, relative)
                    _ = try self.ossRequest(cfg, "PUT", objectKey, query: [:],
                                            headers: ["content-type": "application/octet-stream",
                                                      "x-oss-forbid-overwrite": "true",
                                                      "x-oss-meta-wenjian-sha256": sha],
                                            uploadFile: file)
                    call.resolve(["key": relative, "sha256": sha, "size": digest["size"] as Any])
                    return
                }
                guard action == "download" else { throw PluginError("不支持的传输操作") }
                guard let manifest = self.argumentObject(call, "file"),
                      let relative = manifest["key"] as? String, let expected = manifest["sha256"] as? String,
                      let sizeNumber = manifest["size"] as? NSNumber else {
                    throw PluginError("书籍清单无效")
                }
                let size = sizeNumber.int64Value
                guard size >= 1, size <= maxBookBytes,
                      expected.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                      relative == "books/" + expected + ".pdf" || relative == "books/" + expected + ".epub" else {
                    throw PluginError("书籍清单无效")
                }
                let partial = try directory().appendingPathComponent("download-" + UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: partial) }
                _ = try self.ossRequest(cfg, "GET", try self.ossObject(cfg, relative), query: [:], headers: [:], downloadTo: partial)
                let digest = try self.fileDigest(partial)
                guard (digest["size"] as? NSNumber)?.int64Value == size, digest["sha256"] as? String == expected else {
                    throw PluginError("书籍下载校验失败")
                }
                try? FileManager.default.removeItem(at: file)
                try FileManager.default.moveItem(at: partial, to: file)
                call.resolve(["ok": true])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - OSS 传输

    private func ossObject(_ cfg: [String: Any], _ relative: String?) throws -> String {
        guard let relative = relative,
              relative.range(of: "^(changes/[a-f0-9]{64}\\.json|books/[a-f0-9]{64}\\.(pdf|epub))$", options: .regularExpression) != nil else {
            throw PluginError("同步对象名称无效")
        }
        return (cfg["prefix"] as? String ?? "") + "sync-v1/" + relative
    }

    private static func xmlValue(_ value: String, _ tag: String) -> String? {
        let pattern = "<\(tag)>([\\s\\S]*?)</\(tag)>"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: value, range: NSRange(location: 0, length: (value as NSString).length)) else { return nil }
        let raw = (value as NSString).substring(with: match.range(at: 1))
        return raw.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    private func ossRequest(_ cfg: [String: Any], _ method: String, _ object: String,
                            query params: [String: String], headers extra: [String: String],
                            body: Data? = nil, uploadFile: URL? = nil, downloadTo: URL? = nil) throws -> (status: Int, body: Data, headers: [String: String]) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let time = formatter.string(from: Date())
        var headers = extra
        headers["x-oss-date"] = time
        headers["x-oss-content-sha256"] = "UNSIGNED-PAYLOAD"
        let authorization = OssV4Signer.authorization(
            method: method,
            bucket: cfg["bucket"] as? String ?? "",
            object: object,
            query: params,
            headers: headers,
            region: cfg["region"] as? String ?? "",
            id: cfg["accessKeyId"] as? String ?? "",
            secret: cfg["accessKeySecret"] as? String ?? "",
            timestamp: time
        )
        let host = (cfg["bucket"] as? String ?? "") + ".oss-" + (cfg["region"] as? String ?? "") + ".aliyuncs.com"
        let query = OssV4Signer.queryString(params)
        guard let url = URL(string: "https://" + host + "/" + OssV4Signer.pathEncode(object) + (query.isEmpty ? "" : "?" + query)) else {
            throw PluginError("OSS 地址无效")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 120
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue(authorization, forHTTPHeaderField: "Authorization")
        if let body = body {
            request.httpBody = body
            request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        }

        var result: (status: Int, body: Data, headers: [String: String])?
        var taskError: Error?
        let semaphore = DispatchSemaphore(value: 0)
        let task: URLSessionDataTask
        if let uploadFile = uploadFile {
            task = URLSession.shared.uploadTask(with: request, fromFile: uploadFile) { data, response, error in
                if let error = error { taskError = error; semaphore.signal(); return }
                let http = response as? HTTPURLResponse
                var headers: [String: String] = [:]
                http?.allHeaderFields.forEach { headers[String(describing: $0.key).lowercased()] = String(describing: $0.value) }
                result = (http?.statusCode ?? -1, data ?? Data(), headers)
                semaphore.signal()
            }
        } else {
            task = URLSession.shared.dataTask(with: request) { data, response, error in
                if let error = error { taskError = error; semaphore.signal(); return }
                let http = response as? HTTPURLResponse
                var headers: [String: String] = [:]
                http?.allHeaderFields.forEach { headers[String(describing: $0.key).lowercased()] = String(describing: $0.value) }
                let body = data ?? Data()
                if let downloadTo = downloadTo, (200..<300).contains(http?.statusCode ?? -1) {
                    try? FileManager.default.removeItem(at: downloadTo)
                    try? body.write(to: downloadTo)
                }
                result = (http?.statusCode ?? -1, body, headers)
                semaphore.signal()
            }
        }
        task.resume()
        semaphore.wait()
        if let taskError = taskError { throw taskError }
        return result!
    }

    private func ossRequireSuccess(_ status: Int) throws {
        guard (200..<300).contains(status) else {
            throw PluginError(status == 403 ? "OSS 拒绝访问，请检查权限或设备时间" : "OSS 请求失败（\(status)）")
        }
    }

    private func ossRemote(_ cfg: [String: Any], _ input: [String: Any]) throws -> [String: Any] {
        let action = input["action"] as? String ?? ""
        let relative = input["key"] as? String
        if action == "check" {
            let probe = Data("{\"schema\":1,\"purpose\":\"wenjian-connection-check\"}".utf8)
            let key = (cfg["prefix"] as? String ?? "") + "sync-v1/connection-check.json"
            let put = try ossRequest(cfg, "PUT", key, query: [:],
                                     headers: ["content-type": "application/json", "x-oss-forbid-overwrite": "true"],
                                     body: probe)
            if put.status != 409 { try ossRequireSuccess(put.status) }
            let get = try ossRequest(cfg, "GET", key, query: [:], headers: [:])
            try ossRequireSuccess(get.status)
            guard get.body == probe else { throw PluginError("连接检查文件不一致") }
            var result = try ossRemote(cfg, ["action": "list"])
            result["ok"] = true
            return result
        }
        if action == "list" {
            var keys: [String] = []
            var token: String? = nil
            let prefix = (cfg["prefix"] as? String ?? "") + "sync-v1/"
            repeat {
                var params: [String: String] = ["list-type": "2", "prefix": prefix + "changes/", "max-keys": "1000"]
                if let token = token { params["continuation-token"] = token }
                let response = try ossRequest(cfg, "GET", "", query: params, headers: [:])
                try ossRequireSuccess(response.status)
                let xml = String(decoding: response.body, as: UTF8.self)
                let keyPattern = "<Key>([\\s\\S]*?)</Key>"
                if let regex = try? NSRegularExpression(pattern: keyPattern) {
                    let matches = regex.matches(in: xml, range: NSRange(location: 0, length: (xml as NSString).length))
                    for match in matches {
                        let block = (xml as NSString).substring(with: match.range)
                        if let key = Self.xmlValue(block, "Key"), key.hasPrefix(prefix) {
                            let value = String(key.dropFirst(prefix.count))
                            _ = try ossObject(cfg, value)
                            keys.append(value)
                        }
                    }
                }
                let next = Self.xmlValue(xml, "NextContinuationToken")
                let truncated = Self.xmlValue(xml, "IsTruncated") == "true"
                if truncated && (next == nil || next == token) { throw PluginError("同步目录分页失败") }
                token = truncated ? next : nil
            } while token != nil
            return ["keys": keys]
        }
        guard let relative = relative, relative.hasPrefix("changes/") else { throw PluginError("请使用书籍传输接口") }
        let key = try ossObject(cfg, relative)
        let put = action == "put"
        guard put || action == "get" else { throw PluginError("不支持的操作") }
        let body = put ? Data((input["text"] as? String ?? "").utf8) : nil
        if put {
            let sha = OssV4Signer.hex(Data(SHA256.hash(data: body!)))
            guard body!.count <= 16 * 1024 * 1024, relative == "changes/" + sha + ".json" else {
                throw PluginError("同步文件校验不正确")
            }
        }
        let response = try ossRequest(cfg, put ? "PUT" : "GET", key, query: [:],
                                      headers: put ? ["content-type": "application/json", "x-oss-forbid-overwrite": "true"] : [:],
                                      body: body)
        if put, response.status == 409 {
            let existing = try ossRequest(cfg, "GET", key, query: [:], headers: [:])
            try ossRequireSuccess(existing.status)
            guard existing.body == body else { throw PluginError("云端文件校验失败") }
            return ["ok": true]
        }
        try ossRequireSuccess(response.status)
        return put ? ["ok": true] : ["text": String(decoding: response.body, as: UTF8.self)]
    }
}
