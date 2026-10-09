# 问间移动阅读版 2.1.3（待真机验收）

安卓 8.0 及以上。重点是 PDF / EPUB 阅读、过程注解、读书笔记、关联问题和三端同步。安装包保持空白，不内置个人笔记、书籍或云端密钥。

## 构建

1. 安装 Node.js 22.13+、Java 21，并由使用者接受 Android SDK 许可。
2. 安装 Android SDK Platform 36 和 Build Tools 36，设置 `ANDROID_HOME` 和 `JAVA_HOME`。
3. 根目录运行 `npm ci`。
4. `npm run build:mobile`。
5. `npm run android:sync`。
6. 在 `android` 目录运行 `./gradlew assembleDebug`。输出 `android/app/build/outputs/apk/debug/app-debug.apk` 是调试签名的测试包。

正式发布时应使用独立且妥善备份的 release keystore；不把密钥、密码或本机 SDK 路径提交到仓库。桌面 2.0 发布包只有完整云备份，三端同步需要同时升级到包含本次实现的新桌面版本。

## 同步协议

- Mac / Windows 的 Electron 本地服务与 Android 的原生存储模块提供同一套 API；共享 `lib/sync/` 的合并规则。
- 默认关闭，使用者选择 OSS 或坚果云 WebDAV，在三端使用相同账户与资料库。OSS 只访问 `prefix/sync-v1/`，旧完整备份仍在 `prefix/snapshots/`。坚果云固定使用 `问间资料库/sync-v1/`，不触碰 Obsidian。
- 变更文件以 SHA256 命名，禁止覆盖；失败后复用持久化队列重试。
- 同一记录的并发编辑保留多个版本；用户明确选择后才收敛。删除与修改冲突保留正文可见。
- 阅读进度与书籍信息分开同步；OCR 按页同步。书籍原件以内容 SHA256 存储，手机打开时按需下载并校验。
- 无自建服务器、后台常驻或 AI 改写。App 在前台检查状态；OSS 间隔 1 分钟，坚果云间隔 5 分钟，避免超过服务的请求频率限制。支持立即同步。
- 未提交的输入草稿继续保存在本机，不会用另一设备的草稿覆盖它。

## 当前验证范围

模拟三台设备的首次加入、离线保存、并发修改、冲突选择、删除冲突、重复重试、传输期间本机保存、下载校验失败已覆盖。
浏览器中的手机尺寸预览使用独立 IndexedDB 和虚构 PDF / EPUB，禁止保存云端密钥。它只验证界面和共享逻辑，不能替代安卓 APK 或真机测试。

正式使用前仍需要安卓真机选字、文件导入和阅读体验验收，以及真实 OSS / 坚果云账号的三端连通测试。Windows 包仍需 Windows 实机启动测试。

## 坚果云

- Mac、Windows 左上角同步菜单有独立的坚果云入口；安卓右上角同步窗口选择坚果云。三端共用设置与冲突界面。
- 使用邮箱及第三方应用密码；桌面通过系统安全存储加密，安卓通过 Android Keystore 加密，不写入笔记备份。
- 旧坚果云同步目录显示本机保存状态；启用新同步时先复制并核验笔记，再切换到本机目录。保留旧文件不删除，避免同步客户端与应用同时覆盖整份资料。
- 一次只连接一个服务。资料库有同步历史后不能直接换目标账户或目录，需要单独迁移，防止混合两套历史。
- WebDAV 单本书限制为 500 MB，超限不影响笔记先同步；文件变更按 SHA256 首字符分目录，碰到目录读取上限时停止合并，不把不完整目录当作成功。
- 坚果云说明：https://help.jianguoyun.com/?p=2064

## 2026-10-08 验证

已完成 TypeScript 检查、桌面与手机界面构建、Mac / Windows 2.1.0 空白发布包生成和 Capacitor 资源同步。
同步模拟覆盖三设备加入、并发编辑、断网重试、选择冲突时保存其他新内容、凭据不回传、目标锁定、旧目录迁移、损坏书籍、目录截断。
坚果云 Android Java 传输类使用 Java 21 编译，并以 OkHttp 测试拦截器验证 GET / PUT / PROPFIND / MKCOL 与文件校验。
用户已明确同意 SDK 许可。已安装项目内独立 Android SDK，完整原生 debug / release 构建通过，lint 为 0 错误、20 条警告。已生成独立签名的发布 APK，通过签名、16 KB 对齐、包身份和离线资源检查，并在 Android 36 arm64 模拟器成功安装和启动。模拟器窗口未能被当前 UI 工具识别，因此未将安装成功视为界面验收。未连接真实坚果云账号、未改动已安装的个人问间。

修正 Android 打包工具会移除 OCR 字库 .gz 后缀的问题：移动端打入原始 .traineddata，OCR 使用 gzip:false，桌面仍使用 gzip。移动 PDF 使用 PDF.js legacy 构建，最低 WebView 111；过旧 WebView 会显示本地升级提示。

测试：

`npm run test:sync`

`node --test tests/test-nutstore-sync.cjs tests/test-device-sync-transport.cjs tests/test-sync-desktop-api.cjs tests/test-local-sync-migration.cjs tests/test-oss-cloud.cjs`

## 发布包签名

原生工程运行 `./gradlew :app:assembleRelease :app:lintRelease`，根目录运行 `node scripts/package-android.mjs`。输出目录是 `outputs/android-release`，含 APK、SHA256 校验值和签名检查报告。

脚本支持 `ANDROID_HOME`、`JAVA_HOME`、`WENJIAN_ANDROID_KEYSTORE`、`WENJIAN_ANDROID_PASSWORD_FILE`、`WENJIAN_ANDROID_KEY_ALIAS`。本机签名文件在被 Git 忽略的 `work/android-tools/signing/`，仅用于后续版本连续升级，须单独妥善备份，不能随源码或安装包发布。

发布文件统一整理在 `outputs/问间-2.1.0/`。Mac 包已在独立测试目录打开并验证坚果云窗口；Windows 包仅完成构建和资源审计，尚无 Windows 实机验收。

## Android 2.1.3 手机界面

新增“问题”入口，复用电脑的全部展开关系图与编号，支持单指移动、双指缩放、全图和核心定位。点击节点查看原始记录、子问题、交叉主题、阅读笔记和形成过程。阅读顶部精简为返回/书名/搜索/笔记/更多，翻页固定到底部；过程笔记的关联按钮可打开问题。弹窗不再使用电脑居中偏移，键盘可用高度由 visualViewport 驱动，安卓返回键按弹窗层级关闭。旋转屏幕后重新适应全图。

验证通过：TypeScript、图布局和触摸缩放数学测试、三端同步回归、release构建与lint（0错误）、升级签名与资源审计。虚构资料手机预览覆盖320×640、390×780、844×390横屏、390×360输入高度，以及PDF选字保存、EPUB搜索/选字/章节记录。仍待实体手机长按、双指、系统返回与实际键盘验收。发布包位于 outputs/问间-2.1.3，未包含个人或虚构测试资料。

### 2.2.0：章节笔记与更新

主页的「笔记」按稳定书籍 ID 和已有章节归类，保留过程笔记、读书笔记、后续思考与问题链接。`lib/book-notebook.ts` 和 `ChapterNoteSections` 与桌面共用；旧资料没有书籍 ID 时只匹配唯一来源，避免同名书混淆。

「版本与更新」只读取 `largetomatoes/mac-` 的正式 Releases，按当前平台选择安装包，自动检查每天至多一次，支持手动重试。安卓保持同一应用 ID 与签名，覆盖安装可保留本机数据。
