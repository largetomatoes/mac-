import Foundation
import Capacitor
import CryptoKit
import UIKit
import UniformTypeIdentifiers

/// 问间 iOS 尖峰版原生插件：先覆盖阅读与笔记所需的最小功能集
/// （资料库读写、书籍导入、版本检查），同步相关方法暂为占位实现。
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
                try data.write(to: target, options: .atomic)
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
                let sha = hasher.finalize().map { String(format: "%02x", $0) }.joined()
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

    // MARK: - 同步相关（尖峰版占位）

    @objc func getSyncIdentity(_ call: CAPPluginCall) {
        call.resolve([
            "provider": "oss", "configured": false, "target": "", "username": "",
            "verified": false, "remoteHasData": false, "directory": "问间资料库"
        ])
    }

    @objc func getConfig(_ call: CAPPluginCall) {
        call.resolve(["configured": false])
    }

    @objc func setConfig(_ call: CAPPluginCall) { call.reject("iOS 尖峰版暂不支持同步设置，请等待后续版本。") }
    @objc func setSyncConnection(_ call: CAPPluginCall) { call.reject("iOS 尖峰版暂不支持同步设置，请等待后续版本。") }
    @objc func connectSync(_ call: CAPPluginCall) { call.reject("iOS 尖峰版暂不支持三端同步，请等待后续版本。") }
    @objc func detachSync(_ call: CAPPluginCall) { call.reject("iOS 尖峰版暂不支持三端同步，请等待后续版本。") }
    @objc func remote(_ call: CAPPluginCall) { call.reject("iOS 尖峰版暂不支持三端同步，请等待后续版本。") }
    @objc func transferBook(_ call: CAPPluginCall) { call.reject("iOS 尖峰版暂不支持云端书籍传输，请等待后续版本。") }
}

struct PluginError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
