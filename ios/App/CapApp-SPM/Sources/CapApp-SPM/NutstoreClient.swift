import Foundation
import CryptoKit

/// 坚果云 WebDAV 传输层。只允许访问问间专属目录（移植自安卓 NutstoreClient.java）。
final class NutstoreClient: NSObject, URLSessionDataDelegate {
    static let root = "/dav/问间资料库/sync-v1/"
    static let maxBook: Int64 = 500_000_000

    private let username: String
    private let password: String
    private var ensured = Set<String>()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 300
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    struct Failure: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }

    static func validate(_ input: [String: Any], previousPassword: String) throws -> [String: Any] {
        var username = (input["username"] as? String ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        var password = input["password"] as? String ?? ""
        if password.isEmpty { password = previousPassword }
        let pattern = "^[^\\s:@]+@[^\\s:@]+\\.[^\\s:@]+$"
        guard username.range(of: pattern, options: .regularExpression) != nil,
              username.count <= 254, password.count >= 4, password.count <= 256,
              !password.contains("\r"), !password.contains("\n") else {
            throw Failure("请填写坚果云邮箱和应用密码")
        }
        return ["username": username, "password": password]
    }

    static func target(_ config: [String: Any]) throws -> String {
        guard let username = config["username"] as? String else { throw Failure("请填写坚果云邮箱和应用密码") }
        return "nutstore/" + username.lowercased() + "/问间资料库/"
    }

    init(username: String, password: String) {
        self.username = username
        self.password = password
        super.init()
    }

    convenience init(config: [String: Any]) throws {
        guard let username = config["username"] as? String, let password = config["password"] as? String else {
            throw Failure("请填写坚果云邮箱和应用密码")
        }
        self.init(username: username, password: password)
    }

    // MARK: - HTTP

    private func objectPath(_ key: String) throws -> String {
        let pattern = "^(changes/[a-f0-9]{64}\\.json|books/[a-f0-9]{64}\\.(pdf|epub))$"
        guard key.range(of: pattern, options: .regularExpression) != nil else {
            throw Failure("同步文件名无效")
        }
        return Self.root + (key.hasPrefix("changes/")
            ? "changes/" + String(key[key.index(key.startIndex, offsetBy: 8)]) + "/" + String(key[key.index(key.startIndex, offsetBy: 8)...])
            : key)
    }

    /// 不跟随重定向（与桌面/安卓行为一致）。
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    private func request(_ method: String, _ path: String, body: Data? = nil,
                         headers extra: [String: String] = [:],
                         downloadTo: URL? = nil) throws -> (status: Int, headers: [String: String], body: Data, download: (size: Int64, sha256: String)?) {
        let encoded = path.split(separator: "/", omittingEmptySubsequences: false)
            .map { OssV4Signer.encode(String($0)) }
            .joined(separator: "/")
        guard let url = URL(string: "https://dav.jianguoyun.com" + encoded) else { throw Failure("坚果云地址无效") }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        let auth = Data("\(username):\(password)".utf8).base64EncodedString()
        urlRequest.setValue("Basic " + auth, forHTTPHeaderField: "Authorization")
        for (key, value) in extra { urlRequest.setValue(value, forHTTPHeaderField: key) }
        if let body = body {
            urlRequest.httpBody = body
            urlRequest.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        }

        var result: (status: Int, headers: [String: String], body: Data, download: (size: Int64, sha256: String)?)?
        var taskError: Error?
        let semaphore = DispatchSemaphore(value: 0)

        let finish: (Int, [String: String], Data, (Int64, String)?) -> Void = { status, headers, body, download in
            result = (status, headers, body, download)
            semaphore.signal()
        }

        if let destination = downloadTo {
            let task = session.downloadTask(with: urlRequest) { tempURL, response, error in
                if let error = error { taskError = error; semaphore.signal(); return }
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? -1
                var headers: [String: String] = [:]
                http?.allHeaderFields.forEach { headers[String(describing: $0.key).lowercased()] = String(describing: $0.value) }
                guard let tempURL = tempURL else {
                    finish(status, headers, Data(), nil)
                    return
                }
                var hasher = SHA256()
                var size: Int64 = 0
                do {
                    let handle = try FileHandle(forReadingFrom: tempURL)
                    defer { try? handle.close() }
                    while true {
                        let chunk = try handle.read(upToCount: 64 * 1024) ?? Data()
                        if chunk.isEmpty { break }
                        size += Int64(chunk.count)
                        hasher.update(data: chunk)
                    }
                    let sha = OssV4Signer.hex(Data(hasher.finalize()))
                    if (200..<300).contains(status) {
                        try? FileManager.default.removeItem(at: destination)
                        try FileManager.default.moveItem(at: tempURL, to: destination)
                    }
                    finish(status, headers, Data(), (size, sha))
                } catch {
                    taskError = error
                    semaphore.signal()
                }
            }
            task.resume()
        } else {
            let task = session.dataTask(with: urlRequest) { data, response, error in
                if let error = error { taskError = error; semaphore.signal(); return }
                let http = response as? HTTPURLResponse
                let status = http?.statusCode ?? -1
                var headers: [String: String] = [:]
                http?.allHeaderFields.forEach { headers[String(describing: $0.key).lowercased()] = String(describing: $0.value) }
                finish(status, headers, data ?? Data(), nil)
            }
            task.resume()
        }
        semaphore.wait()
        if let taskError = taskError { throw taskError }
        return result!
    }

    private func success(_ response: (status: Int, headers: [String: String], body: Data, download: (size: Int64, sha256: String)?)) throws {
        let code = response.status
        if (200..<300).contains(code) { return }
        let message = code == 401 ? "坚果云身份验证失败（401），请检查账号邮箱和第三方应用密码"
            : code == 403 ? "坚果云拒绝访问（403），请检查应用授权或目录权限；这不一定是密码错误"
            : code == 429 ? "坚果云请求过于频繁，请稍后重试"
            : code == 507 ? "坚果云空间或流量不足"
            : "坚果云请求失败（\(code)）"
        struct HTTPFailure: LocalizedError {
            let message: String
            var errorDescription: String? { message }
        }
        throw HTTPFailure(message: message)
    }

    private func ensure(_ key: String?) throws {
        var paths = ["/dav/问间资料库/", Self.root, Self.root + "changes/", Self.root + "books/"]
        if let key = key, key.hasPrefix("changes/") {
            paths.append(Self.root + "changes/" + String(key[key.index(key.startIndex, offsetBy: 8)]) + "/")
        }
        for path in paths {
            if ensured.contains(path) { continue }
            let response = try request("MKCOL", path)
            if response.status != 405 { try success(response) }
            ensured.insert(path)
        }
    }

    // MARK: - WebDAV XML

    static func decodeXml(_ value: String) -> String {
        var output = value
        // 数字实体
        let pattern = "&#(x[0-9a-fA-F]+|[0-9]+);"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return output }
        let ns = output as NSString
        let matches = regex.matches(in: output, range: NSRange(location: 0, length: ns.length))
        var result = ""
        var last = 0
        for match in matches {
            result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let raw = ns.substring(with: match.range(at: 1))
            let scalar: UnicodeScalar?
            if raw.hasPrefix("x") || raw.hasPrefix("X") {
                scalar = UInt32(raw.dropFirst(), radix: 16).flatMap(UnicodeScalar.init)
            } else {
                scalar = UInt32(raw).flatMap(UnicodeScalar.init)
            }
            result += scalar.map { String($0) } ?? ns.substring(with: match.range)
            last = match.range.location + match.range.length
        }
        result += ns.substring(from: last)
        for (entity, char) in [("lt", "<"), ("gt", ">"), ("quot", "\""), ("apos", "'"), ("amp", "&")] {
            result = result.replacingOccurrences(of: "&\(entity);", with: char)
        }
        return result
    }

    static func children(_ xml: String, folder: String) throws -> [String] {
        func has(_ pattern: String, _ text: String) -> Bool {
            (text.range(of: pattern, options: .regularExpression) != nil)
        }
        guard has("<(?:[\\w-]+:)?multistatus[\\s>]", xml),
              has("</(?:[\\w-]+:)?multistatus>", xml),
              !has("(?i)<!DOCTYPE|<!ENTITY", xml) else {
            throw Failure("坚果云目录响应不完整")
        }
        let blocksPattern = "<(?:[\\w-]+:)?response[\\s>]([\\s\\S]*?)</(?:[\\w-]+:)?response>"
        guard let blocksRegex = try? NSRegularExpression(pattern: blocksPattern) else { throw Failure("坚果云目录响应不完整") }
        let ns = xml as NSString
        let matches = blocksRegex.matches(in: xml, range: NSRange(location: 0, length: ns.length))
        var result: [String] = []
        var count = 0
        for match in matches {
            count += 1
            if count >= 750 { throw Failure("坚果云目录达到单次读取上限，已暂停同步") }
            let raw = ns.substring(with: match.range(at: 1))
            let hrefPattern = "<(?:[\\w-]+:)?href[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?href>"
            guard let hrefRegex = try? NSRegularExpression(pattern: hrefPattern),
                  let href = hrefRegex.firstMatch(in: raw, range: NSRange(location: 0, length: (raw as NSString).length)) else {
                throw Failure("目录缺少文件地址")
            }
            let hrefText = decodeXml((raw as NSString).substring(with: href.range(at: 1)))
            guard let uri = URL(string: hrefText, relativeTo: URL(string: "https://dav.jianguoyun.com"))?.absoluteURL,
                  uri.scheme == "https", uri.host == "dav.jianguoyun.com", uri.port == nil else {
                throw Failure("坚果云返回外部地址")
            }
            let path = uri.path
            guard has("<(?:[\\w-]+:)?status[^>]*>HTTP/\\d(?:\\.\\d)? 2\\d\\d", raw) else {
                throw Failure("坚果云文件状态读取失败")
            }
            if path.hasSuffix("/") ? String(path.dropLast()) == (folder.hasSuffix("/") ? String(folder.dropLast()) : folder) : path == folder {
                continue
            }
            guard path.hasPrefix(folder) else { throw Failure("坚果云返回目录外文件") }
            var child = String(path.dropFirst(folder.count))
            if child.hasSuffix("/") { child = String(child.dropLast()) }
            if child.contains("/") { throw Failure("坚果云返回目录外文件") }
            if has("<(?:[\\w-]+:)?collection(?:\\s[^>]*)?/?[>]", raw) && !child.hasSuffix("/") { child += "/" }
            result.append(child)
        }
        if count == 0 { throw Failure("坚果云目录响应为空，未合并") }
        return result
    }

    private func listing(_ folder: String) throws -> [String] {
        let xml = "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>"
        let response = try request("PROPFIND", folder, body: Data(xml.utf8), headers: ["Depth": "1", "content-type": "application/xml"])
        if response.status == 404 { return [] }
        try success(response)
        return try Self.children(String(decoding: response.body, as: UTF8.self), folder: folder)
    }

    // MARK: - 同步操作

    func remote(_ input: [String: Any]) throws -> [String: Any] {
        let action = input["action"] as? String ?? ""
        if action == "check" {
            try ensure(nil)
            let probe = Data("{\"schema\":1,\"purpose\":\"wenjian-connection-check\"}".utf8)
            let path = Self.root + "connection-check.json"
            let put = try request("PUT", path, body: probe, headers: ["If-None-Match": "*", "content-type": "application/json"])
            if put.status != 412 { try success(put) }
            let get = try request("GET", path)
            try success(get)
            guard get.body == probe else { throw Failure("连接检查文件不一致") }
            var result = try remote(["action": "list"])
            result["ok"] = true
            return result
        }
        if action == "list" {
            var keys: [String] = []
            for dir in try listing(Self.root + "changes/") {
                guard dir.range(of: "^[a-f0-9]/$", options: .regularExpression) != nil else {
                    throw Failure("同步目录含未知文件，未合并")
                }
                for name in try listing(Self.root + "changes/" + dir) {
                    let pattern = "^" + String(dir.prefix(1)) + "[a-f0-9]{63}\\.json$"
                    guard name.range(of: pattern, options: .regularExpression) != nil else {
                        throw Failure("同步文件名不正确")
                    }
                    keys.append("changes/" + name)
                }
            }
            return ["keys": keys]
        }
        guard let key = input["key"] as? String else { throw Failure("同步文件校验不正确") }
        let path = try objectPath(key)
        guard key.hasPrefix("changes/") else { throw Failure("请使用书籍接口") }
        if action == "get" {
            let response = try request("GET", path)
            try success(response)
            return ["text": String(decoding: response.body, as: UTF8.self)]
        }
        let body = Data((input["text"] as? String ?? "").utf8)
        let sha = OssV4Signer.hex(Data(SHA256.hash(data: body)))
        guard action == "put", body.count <= 16 * 1024 * 1024, key == "changes/" + sha + ".json" else {
            throw Failure("同步文件校验不正确")
        }
        try ensure(key)
        let put = try request("PUT", path, body: body, headers: ["If-None-Match": "*", "content-type": "application/json"])
        if put.status == 412 {
            let existing = try request("GET", path)
            try success(existing)
            guard existing.body == body else { throw Failure("云端文件校验失败") }
        } else {
            try success(put)
        }
        return ["ok": true]
    }

    func upload(_ file: URL) throws -> [String: Any] {
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        let size = (attributes[.size] as? Int64) ?? 0
        guard size >= 1, size <= Self.maxBook else {
            throw Failure("坚果云 WebDAV 单本书需小于 500 MB；笔记仍可同步")
        }
        var hasher = SHA256()
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        while true {
            let chunk = try handle.read(upToCount: 64 * 1024) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        let sha = OssV4Signer.hex(Data(hasher.finalize()))
        let key = "books/" + sha + (file.lastPathComponent.hasSuffix(".pdf") ? ".pdf" : ".epub")
        try ensure(nil)
        let response = try request("PUT", try objectPath(key), body: try Data(contentsOf: file),
                                   headers: ["If-None-Match": "*", "content-type": "application/octet-stream"])
        if response.status == 412 {
            let head = try request("HEAD", try objectPath(key))
            try success(head)
            guard head.headers["content-length"] == String(size) else { throw Failure("云端书籍大小与本机不一致") }
        } else {
            try success(response)
        }
        return ["key": key, "sha256": sha, "size": size]
    }

    func download(_ manifest: [String: Any], to file: URL) throws -> [String: Any] {
        guard let sha = manifest["sha256"] as? String, let key = manifest["key"] as? String,
              let sizeNumber = manifest["size"] as? NSNumber else {
            throw Failure("云端书籍清单无效")
        }
        let size = sizeNumber.int64Value
        guard sha.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              key == "books/" + sha + ".pdf" || key == "books/" + sha + ".epub",
              size >= 1, size <= Self.maxBook else {
            throw Failure("云端书籍清单无效")
        }
        let partial = file.deletingLastPathComponent().appendingPathComponent("download-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: partial) }
        let response = try request("GET", try objectPath(key), downloadTo: partial)
        try success(response)
        guard let download = response.download, download.size == size, download.sha256 == sha else {
            throw Failure("书籍校验失败，未替换本机文件")
        }
        try? FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: partial, to: file)
        return ["ok": true]
    }
}
