# 对应源码、构建与再发行

本文件记录从本仓库构建主要客户端的步骤。代码授权见 [LICENSE](LICENSE)，
第三方条件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，
贡献安排见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 获取确切源码

```sh
git clone https://github.com/largetomatoes/mac-.git
cd mac-
git checkout <发行页面标明的完整提交或标签>
npm ci
```

将占位的提交或标签换成发行者给出的真实值。`npm ci` 使用根锁文件；首次
构建需要访问 npm、Electron 或 Android 的依赖来源。使用 Node.js 22.13
或更新的兼容版本。当前桌面与 Android 共用主要界面、阅读与笔记逻辑。

不要把“最新主分支”当作所有旧安装包的对应源码。当前仓库的许可文档变更
不表示旧二进制已重新构建或重新标注许可；历史版本以其对应提交及有效授权为准。

## Mac（Apple 芯片）

需要 macOS、自带的 `codesign`、`ditto`、`plutil` 等工具，以及上述 Node 环境。
在项目根目录运行：

```sh
npm ci --prefix work/mac-app
npm run package:mac --prefix work/mac-app
```

脚本使用 `work/mac-app/local-spa` 构建界面，复制空白种子和必需的离线 PDF/OCR
资源，再使用 Electron 打包。默认生成本机临时签名，不需要官方私钥或已有应用。
不要为普通源码构建设置只用于维护者缓存复用的 `WENJIAN_MAC_RUNTIME_APP`。

应用与 ZIP 位于 `work/mac-app/release/` 下；准确路径由命令输出。
公开版本、内部版本与构建号以 `work/mac-app/asar-src/package.json` 和
`work/mac-app/native-Info.plist` 为准，并须保持打包脚本所要求的一致性。

## Windows x64

在 Windows x64 环境准备 Node.js 及 Python 3，并从项目根目录运行：

```sh
npm ci --prefix work/mac-app
npm run package:win --prefix work/mac-app
```

源码脚本为 `work/mac-app/scripts/build-windows.mjs`；归档脚本为同目录下的
`archive-windows.py`。它会打包 `Wenjian.exe`，输出至 `work/mac-app/release/`
及其 Windows 子目录，并用带 UTF-8 文件名标志的 ZIP 归档。命令名 `python3`
应在 PATH 中可用；如系统只提供 `python`，需按实际环境配置该命令。
跨平台生成 Windows 归档不等于完成真实 Windows 安装验收。

## Android 测试包

准备 Java 21、Android SDK Platform 36 和 Build Tools 36.0.0；SDK 许可由
构建者本人阅读并接受。设置 `JAVA_HOME`、`ANDROID_HOME`，使用本机
`android/local.properties` 指向 SDK（此文件不提交）。项目根目录运行：

```sh
npm run build:mobile
npm run android:sync
cd android
./gradlew :app:assembleDebug
```

Windows 可使用 `gradlew.bat :app:assembleDebug`。测试 APK 位于
`android/app/build/outputs/apk/debug/app-debug.apk`，无需官方 release 私钥。
它使用调试签名，不能据此保证覆盖安装官方签名版本；请在隔离设备或相应
测试身份下验收。版本和 SDK 配置见 `android/app/build.gradle`、`android/variables.gradle`。

正式 APK 需使用发行者自己的签名材料。现有 `scripts/package-android.mjs`
支持 `WENJIAN_ANDROID_KEYSTORE`、`WENJIAN_ANDROID_PASSWORD_FILE`、
`WENJIAN_ANDROID_KEY_ALIAS`、`WENJIAN_ANDROID_CERT_SHA256` 等环境变量；
签名脚本默认核对官方历史证书指纹，自有发行须按自己的证书明确设置。
不要将官方身份、签名私钥或已安装用户的资料作为公开构建前提。

## 修改版身份、品牌与更新

对外修改版应按 [TRADEMARK.md](TRADEMARK.md) 更换所需名称及视觉标识，
明确维护者和改动，避免与官方版本混淆。应用 ID、数据目录、签名和更新
通道也应按自身发行身份处理；源码中保留的官方公钥不赋予制作官方更新的权利。
商业授权不自动允许使用官方图标或关闭源码。

构建及测试请使用空白种子和虚构资料。原生程序提供的测试资料目录只用于
隔离测试，不应指向真实笔记、同步库或个人安装目录。

## 验证和发行时需要提供的内容

按修改范围运行相关检查，例如：

```sh
npx tsc --noEmit
npm run test:sync
node --test tests/test-book-reading.cjs tests/test-maintenance-recovery.cjs
```

Android 可在 `android` 目录运行 `./gradlew :app:lintRelease :app:testReleaseUnitTest`。
构建或逻辑测试通过，不代表完成所有平台的实机、触控及真实云库验收。

对外发行时至少随包或在同一发布页面给出：

- 安装包对应的完整提交、标签或源码归档及其公开地址；包含 LICENSE、版权
  与第三方声明，以及实际使用的构建脚本、锁文件和必要配置。
- 平台、版本、构建号、构建环境及本版本的准确构建步骤。
- 对比上游的修改记录；原样再发行注明未修改。
- 商业发行或收费服务按约定事先获得的有效书面授权，且仍提供对应源码。

公开构建材料不包含个人笔记、原书、云凭据、私钥或本机缓存。
本次只补充许可与构建文档，未重新构建、替换已安装应用或重新发布旧安装包。
