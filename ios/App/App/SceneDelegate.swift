import UIKit
import Capacitor
import WebKit
import CapApp_SPM
import AppPlugin

/// 显式注册问间原生插件。
/// Debug 构建把应用代码放在独立 dylib 里，Capacitor 的自动扫描只覆盖主程序镜像，
/// 因此这里在 WebView 加载前主动注册，确保 Release / Debug 都可用。
class WenjianBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        if let bridge = bridge {
            if bridge.plugin(withName: "WenjianStorage") == nil {
                bridge.registerPluginInstance(WenjianStoragePlugin())
            }
            if bridge.plugin(withName: "App") == nil {
                bridge.registerPluginInstance(AppPlugin())
            }
            // 尖峰验证专用：通过环境变量 SPIKE_BOOK 指定书名，自动打开该书
            // （模拟器无法注入触屏，用于验证 PDF 渲染与 OCR；不影响正常使用）。
            if let title = ProcessInfo.processInfo.environment["SPIKE_BOOK"], !title.isEmpty {
                spikeAutoOpen(bookTitle: title, attempts: 60)
            }
        }
        super.capacitorDidLoad()
    }

    /// 轮询等待书库渲染完成后自动点开指定书籍（尖峰验证专用）。
    private func spikeAutoOpen(bookTitle: String, attempts: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, let webView = self.bridge?.webView else { return }
            webView.evaluateJavaScript("document.querySelectorAll('button.mobile-book').length") { result, _ in
                let count = result as? Int ?? 0
                if count > 0 {
                    let escaped = bookTitle.replacingOccurrences(of: "'", with: "\\'")
                    webView.evaluateJavaScript("""
                    (function(){
                      const items = document.querySelectorAll('button.mobile-book');
                      for (const item of items) {
                        if (item.textContent.includes('\(escaped)')) { item.click(); return 'clicked'; }
                      }
                      return 'missing';
                    })();
                    """, completionHandler: nil)
                } else if attempts > 0 {
                    self.spikeAutoOpen(bookTitle: bookTitle, attempts: attempts - 1)
                }
            }
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = WenjianBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
