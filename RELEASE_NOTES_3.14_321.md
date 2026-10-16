# 问间 3.14（321）· 书籍随同步与 Windows 安装版

本次为独立 Release `v3.14-build321`。公开版本仍为 3.14，三端内部构建号均为 321。

## 三端同步：点击一次，笔记和原书一起传输

Mac、Windows、Android 的同步均先合并笔记、批注与书籍信息，再上传本机新增原件、下载其他设备新增的 PDF / EPUB，最后发布原件地址。任何一端都可以作为原书的来源。

修正旧云端地址记录可能导致原书被跳过的问题：每次同步读取一次原件目录，缺失的云端原件由持有原书的设备补传；本机没有原书且云端也没有时，会明确列入待传输书籍。未变化的原件不重复传输。书籍目录或个别原件传输失败不会清空本机文件，也不会把笔记成功误报为全部完成。

坚果云使用独立的「问间资料库」，不会进入 Obsidian 的文件夹。WebDAV 单本书仍受 500 MB 限制；账户流量和请求额度取决于坚果云。目录达到服务器安全读取上限时会暂停，而不是以不完整列表覆盖资料。请等待同步窗口的书籍状态完成后，再到另一端同步。

## Windows 安装版与字体

新增完整离线 `Setup.exe`，安装到当前用户的 `%LOCALAPPDATA%\Programs\Wenjian`，无需管理员权限；创建快捷方式和卸载入口。原便携版默认使用的 `%APPDATA%\问间` 资料目录继续沿用。自定义外部资料目录配置也保留，不需要重新导入笔记。

覆盖安装前请先保存并退出问间；安装失败保留原应用。卸载保留本机笔记和书籍。应用内后续更新仍使用签名 ZIP 覆盖安装目录，并保留卸载程序；ZIP 是更新载荷，不是首次安装必须手动解压的要求。

内置 Noto Sans SC 和 Noto Serif SC 离线字体，分别用于界面和笔记正文，接近 Mac 的黑体/宋体搭配。Mac 继续使用系统字体；PDF 原书排版保持不变。字体的 SIL OFL 许可证单独保留于 `assets/fonts/`，不受项目自定义许可限制。

## Android 同步中断修复与诊断

降低整库 JSON 在 JavaScript/原生桥之间反复复制的峰值内存：分块传输、流式原子保存、流式备份，并保留版本竞争检查与失败回滚。同步锁记录当前任务归属，重新打开后仅能恢复本机确已中断的原任务，不能凭设备名称解除别人的有效锁。

新增「导出同步诊断」，记录阶段、异常代码位置、设备和内存信息，不包含笔记正文、密码或云端地址。阅读进程异常后暂停自动同步，允许手动重试。321 之前崩溃留下的锁没有可验证的本机任务记录，首次升级后可能仍需等待旧锁过期（最长约十分钟）。

这项修复针对排查发现的内存峰值与恢复缺陷。尚未取得用户一加 12 的崩溃日志，不能断言已验证其闪退根因。若仍闪退，请通过设置导出同步诊断；若来不及导出，可连接 Mac 开启 USB 调试后采集问间专属崩溃日志。请不要卸载或清除资料。

## 下载与升级

- [Mac · Apple 芯片](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14-build321/Wenjian-3.14-build321-macOS-arm64.zip)
- [Windows x64 · 安装版](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14-build321/Wenjian-3.14-build321-Windows-x64-Setup.exe)
- [Android · 原证书覆盖安装](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14-build321/Wenjian-3.14-build321-Android.apk)
- [完整对应源码 ZIP](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14-build321/Wenjian-3.14-build321-source.zip)
- [源码、构建说明与修改记录](https://github.com/largetomatoes/wenjian-software/tree/v3.14-build321)

**320 及以前请手动覆盖升级一次。** 这些旧客户端不能识别独立的 `-build321` 发布标签；远端改名或改说明不能改变已安装二进制。321 起按公开版本和内部构建号排序识别独立 Release，并验证精确标签、签名、摘要和平台身份。此次不向旧 Release 堆放新安装包。

Mac 请覆盖原应用，Windows 直接运行 Setup，Android 覆盖安装；都不要先卸载或清除数据。桌面上的隔离阅读演示版不作修改。

## 检查范围

三端虚构书库验证各端新增图书的双向原件传输、字节校验、缺失补传、失败重试及未变化文件复用；完整数据与同步回归、类型检查、Android lint 与原证书签名、Mac 隔离窗口检查、包体无私人资料审计。Windows 安装与覆盖验收的实际结果另见随附验证报告；Android 未连接实体手机验收。
