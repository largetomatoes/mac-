import Foundation
import CryptoKit

/// 阿里云 OSS V4 签名（与桌面端 oss-cloud.js、安卓 OssV4Signer.java 完全一致的规范化规则；不记录任何密钥）。
enum OssV4Signer {
    private static let unreserved: Set<UInt8> = {
        var set = Set<UInt8>()
        for byte in UInt8(ascii: "A")...UInt8(ascii: "Z") { set.insert(byte) }
        for byte in UInt8(ascii: "a")...UInt8(ascii: "z") { set.insert(byte) }
        for byte in UInt8(ascii: "0")...UInt8(ascii: "9") { set.insert(byte) }
        for scalar in "-_.~".unicodeScalars { set.insert(UInt8(ascii: scalar)) }
        return set
    }()

    /// RFC3986 未保留字符编码，等价于 Java URLEncoder 后的 +→%20、*→%2A、%7E→~。
    static func encode(_ value: String) -> String {
        var output = ""
        for byte in Array(value.utf8) {
            if unreserved.contains(byte) {
                output.append(Character(UnicodeScalar(byte)))
            } else {
                output.append(String(format: "%%%02X", byte))
            }
        }
        return output
    }

    static func pathEncode(_ value: String) -> String {
        value.split(separator: "/", omittingEmptySubsequences: false).map { encode(String($0)) }.joined(separator: "/")
    }

    static func queryString(_ params: [String: String]) -> String {
        params.keys.sorted().map { encode($0) + "=" + encode(params[$0]!) }.joined(separator: "&")
    }

    private static func hmac(_ key: Data, _ text: String) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: Data(text.utf8), using: SymmetricKey(data: key)))
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    /// 生成 Authorization 头；headers 的键会被小写规范化、值去首尾空白。
    static func authorization(method: String, bucket: String, object: String, query: [String: String],
                              headers input: [String: String], region: String, id: String,
                              secret: String, timestamp: String) -> String {
        let date = String(timestamp.prefix(8))
        let scope = date + "/" + region + "/oss/aliyun_v4_request"

        var normalized: [String: String] = [:]
        for (key, value) in input { normalized[key.lowercased()] = value.trimmingCharacters(in: .whitespaces) }
        var canonicalHeaders = ""
        var additional: [String] = []
        for key in normalized.keys.sorted() {
            if key == "content-length" || key == "content-disposition" { additional.append(key) }
            if key.hasPrefix("x-oss-") || key == "content-type" || key == "content-md5" || additional.contains(key) {
                canonicalHeaders += key + ":" + normalized[key]! + "\n"
            }
        }
        let names = additional.joined(separator: ";")
        let canonical = method + "\n" + pathEncode("/" + bucket + "/" + object) + "\n"
            + queryString(query) + "\n" + canonicalHeaders + "\n" + names + "\nUNSIGNED-PAYLOAD"
        let digest = hex(Data(SHA256.hash(data: Data(canonical.utf8))))

        var key = Data(("aliyun_v4" + secret).utf8)
        key = hmac(key, date)
        key = hmac(key, region)
        key = hmac(key, "oss")
        key = hmac(key, "aliyun_v4_request")
        let signature = hex(hmac(key, "OSS4-HMAC-SHA256\n" + timestamp + "\n" + scope + "\n" + digest))

        return "OSS4-HMAC-SHA256 Credential=" + id + "/" + scope
            + (names.isEmpty ? "" : ",AdditionalHeaders=" + names) + ",Signature=" + signature
    }
}
