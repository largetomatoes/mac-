# 问间 3.14（320）· 仓库更名与更新兼容

本次只调整项目地址与更新来源，公开版本继续为3.14。构建号从319增加为320，原有阅读、卡片、问题页和数据格式不变。

## 新地址

- 软件、源码与安装包：[wenjian-software](https://github.com/largetomatoes/wenjian-software)
- 官网工程：[wenjian-web](https://github.com/largetomatoes/wenjian-web)
- 官网与下载页：[问间官网](https://largetomatoes.github.io/wenjian-web/)

软件仓库由`mac-`改名，官网仓库由`wenjian`改名；保留同一仓库的历史提交、标签、发行版本和附件。不复用两个旧名称，以保留GitHub的仓库跳转。

## 更新说明

三端320直接从新软件仓库检查更新，兼容旧`mac-`和新`wenjian-software`两处历史发布链接；签名、SHA-256、平台身份、构建号及可信来源验证继续有效。

**319及以前的客户端需要手动覆盖升级一次。** 它们使用旧API地址且部分原生实现不跟随改名跳转，不能通过修改远端设置修正已安装的程序。请从下列链接下载320，覆盖原程序，不要先卸载。Mac本机由维护流程先备份再原位替换，桌面演示版保持不动。

- [Mac · Apple芯片](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14/Wenjian-3.14-build320-macOS-arm64.zip)
- [Windows · x64](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14/Wenjian-3.14-build320-Windows-x64.zip)
- [Android · 原证书覆盖安装](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14/Wenjian-3.14-build320-Android.apk)
- [完整源码ZIP](https://github.com/largetomatoes/wenjian-software/releases/download/v3.14/Wenjian-3.14-build320-source.zip)
- [对应源码标签与构建说明](https://github.com/largetomatoes/wenjian-software/tree/v3.14-build320)

320以后同为3.14时也比较构建号。升级保留账号配置、本机笔记、原书和草稿。同步继续使用319的云格式4；本次不运行个人云账号联调。

原有319及更早的附件和签名清单不被覆盖；它们仍可通过GitHub的旧仓库链接跳转下载。历史`v3.14`标签保持原位；请使用`v3.14-build320`或本说明的源码ZIP获取本构建对应的源码。

## 验证范围

更新回归包含三端在新旧仓库链接下的发现与选择、签名清单下载、旧签名包兼容、仿冒仓库和错误版本拒绝、同版本构建号比较、类型检查。Mac、Windows与Android重新构建并验证空白种子、无个人资料和签名；Mac在隔离窗口和正式原位安装后检查，Windows和Android未做实体设备运行验收。iOS仅同步源码中的地址，本次不构建或发布iOS。

功能变化与已有界面说明继续见[319版说明](https://github.com/largetomatoes/wenjian-software/blob/v3.14-build319/RELEASE_NOTES_3.14_319.md)。

验证记录见[VERIFICATION_3.14_320.md](https://github.com/largetomatoes/wenjian-software/blob/v3.14-build320/VERIFICATION_3.14_320.md)。
