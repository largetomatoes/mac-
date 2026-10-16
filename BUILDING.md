# 对应源码、构建与再发行

本文件记录从本仓库构建主要客户端的步骤。代码授权见 [LICENSE](LICENSE)，
第三方条件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，
贡献安排见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 获取确切源码

```sh
git clone https://github.com/largetomatoes/wenjian-software.git
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


## 3.14（319）维护说明


需要 Node.js 22.13+ 与 npm。先在根目录执行 `npm ci`，再在 `work/mac-app` 执行 `npm ci`。不要把个人资料、云凭据或任何签名私钥放进源码。

## Mac

在 macOS 根目录执行 `node work/mac-app/scripts/build-mac.mjs`。生成 `work/mac-app/release/Wenjian-3.14-macOS-arm64.zip`。安装包使用干净的 `work/mac-app/seed.json`；正式用户资料在应用支持目录，绝不从那里打包。

## Windows

执行 `node work/mac-app/scripts/build-windows.mjs`。生成 `work/mac-app/release/Wenjian-3.14-Windows-x64.zip`。外层目录、可执行文件为英文，ZIP 保留 UTF-8 文件名标志。

## Android

安装 Java 21、Android SDK Platform 36、Build Tools 36，并由使用者阅读及接受 SDK 许可，设置 `JAVA_HOME`、`ANDROID_HOME`。执行 `npm run build:mobile`、`npm run android:sync`，进入 `android` 执行 `./gradlew :app:assembleRelease :app:lintRelease`。

正式覆盖更新必须使用自己已有的应用签名。指定 `WENJIAN_ANDROID_KEYSTORE`、`WENJIAN_ANDROID_PASSWORD_FILE`、`WENJIAN_ANDROID_KEY_ALIAS`、`WENJIAN_ANDROID_CERT_SHA256` 后执行 `node scripts/package-android.mjs`。源码不提供作者的签名私钥。

## 更新与源码对应

公开版本在桌面 `asar-src/package.json` 的 `releaseVersion` 和 Android 的 `versionName` 中保持 3.14。括号构建号来自桌面的 `buildVersion` / `CFBundleVersion` 与 Android 的 `versionCode`，应统一递增。本次为 319。

同版本发布在说明中加入 `<!-- wenjian-build:319 -->`，安装包命名 `Wenjian-3.14-build319-平台`，提供使用原更新签名密钥签署的 `update-manifest-319.json`。清单包含公开版本、整数构建号、平台、完整下载 URL、字节数与 SHA256；只增加构建号也会被319及以后版本发现。未持有原作者的更新私钥时，衍生项目必须替换更新公钥及更新来源，不能给官方应用推送更新。

对应源码标签 `v3.14-build319`。遵守 LICENSE、NOTICE、TRADEMARK.md 及贡献协议；修改记录见 `RELEASE_NOTES_3.14_319.md`。

## 验证

`npx tsc --noEmit --incremental false`；`node tests/test-app-updates.mjs`；`node --test tests/test-app-updater.cjs tests/test-update-installer.cjs`；`node tests/test-sync-desktop-v2.mjs`；`node tests/test-organization-archives.mjs`。其他阅读、卡片、编码、备份及手机 API 回归位于 `tests`。使用虚构资料，避免测试连接个人云账号。

## 3.14（320）仓库迁移维护

对应标签为`v3.14-build320`，公开版本3.14、桌面buildVersion/CFBundleVersion与Android versionCode均为320。软件仓库`largetomatoes/wenjian-software`，官网仓库`largetomatoes/wenjian-web`。更新来源直接使用新仓库，历史下载只允许新旧两个指定仓库，继续验证签名和摘要。

发行附件名使用`Wenjian-3.14-build320-平台`，另附`update-manifest-320.json`，发行说明首行标记`<!-- wenjian-build:320 -->`。历史319清单及安装包保持不变。320来源和变更范围见`RELEASE_NOTES_3.14_320.md`。319及更早客户端须手动覆盖升级一次。

## 3.14（321）独立 Release

对应源代码标签 `v3.14-build321`。桌面 `asar-src/package.json` 的 buildVersion、Mac native-Info.plist 的 CFBundleVersion 与 Android versionCode 均为 321。Mac 与 Windows 构建顺序执行（共用 SPA 暂存目录）。

Windows 需要 NSIS 3.x 的 `makensis`（macOS 可通过 Homebrew 安装）。运行 `node work/mac-app/scripts/build-windows.mjs` 会依次构建完整目录、UTF-8 ZIP 和 Setup.exe；单独制作安装程序可运行 `node work/mac-app/scripts/build-windows-installer.mjs`。安装程序无需联网，默认按当前用户安装。开发环境缓存路径由环境变量指定，不能带入源码归档。

Windows 字体已随源码提交，不需要运行时联网。`assets/fonts/SOURCES.json` 记录官方来源及上游原字体摘要，WOFF2 用 fonttools 4.60.2 + brotli 1.2.0 从对应可变 TTF 转换，保留原始字形与字重范围。两份 OFL 许可证随字体分发，不要以项目自定义许可覆盖它们。

Windows CI 工作流 `windows-release-smoke.yml` 从指定 Release 下载构建产物，在临时 Windows runner 测试普通 ZIP 与安装版读取同一资料目录、静默安装、覆盖安装、字体文件服务和卸载保留资料。测试拒绝在已有用户资料的系统执行。

独立 Release 名称为 `问间 3.14（321）`，标签 `v3.14-build321`。签名更新清单 payload 中增加 `tag`，须与 version/build 一致；附件名称 `Wenjian-3.14-build321-平台`。Windows 签名自动更新载荷仍为 ZIP，Setup.exe 是首次及手动覆盖安装入口。320 及以前需要手动覆盖升级一次，不能仅修改远端发现信息解决。

诊断采集只记录本地阶段、异常类型/代码位置与内存统计，默认不会发送。物理 Android 实机验证仍需连接用户设备。
