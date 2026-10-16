# 问间 3.14（319）

公开版本继续为 3.14，本次内部构建为 319。Mac、Windows、Android 使用相同的数据模型；桌面阅读演示版本保持不变。

## 本次变化

- 已读完使用 PDF、EPUB、Zotero 标识后的对号，书名保持整洁；标记时间、取消与筛选继续保留。
- 共同笔记分别保留两本书的选文，每段原文可独立填写章节，再写同一条自己的思考并关联问题。Mac 默认按住 Option，设置中可改为 Command；Windows 默认 Alt；手机使用选文更多操作。
- 修复卡片集触控板滚动，标题及工具区域也可滚动卡片列表；保留放大的卡片架。卡片可编辑原话、加自定义标签，并选择问题页采用；已采用的原话快照与修改历史保留。安卓加入相同的卡片编辑、标签筛选和采用功能。
- 汇总页可以独立安排问题位置并自动编号，原问题页结构保留；思路采用归档与恢复，安卓维护逻辑与桌面保持一致。
- Mac、Windows 全新打开先显示《给使用者的一封信》，确认后进入初始化。读过后不重复弹出，可在设置重读。原有资料升级不重置已读状态。
- EPUB 对照选文使用本栏指针捕获，避免跨栏扩选与系统文字拖动；旧书完成异步加载后再释放，避免切换时后台报错。
- 同为 3.14 时按内部构建号判断更新，界面显示 3.14（319）。下载使用独立构建文件与签名清单，校验构建号、文件摘要和安装身份。

## 升级

Mac 原位替换同一「问间.app」，Windows 解压覆盖原程序目录，Android 使用相同原证书覆盖安装。不要先卸载，也不要把个人资料目录替换为安装包目录。

旧客户端只比较公开版本号，无法远程改写其更新判断。这次旧 3.14 用户需手动下载并覆盖升级一次；319 起同一公开版本增加构建号即可在应用内发现更新。

新问题位置、卡片采用历史与归档使用云资料格式 4。请把参与同步的三端都升级到 3.14（319）后使用；旧客户端遇到新格式会停止写入。升级不重置账号、笔记、书籍或草稿。不需要自行重建云目录。

## 下载与源码

- [Mac · Apple 芯片](https://github.com/largetomatoes/mac-/releases/download/v3.14/Wenjian-3.14-build319-macOS-arm64.zip)
- [Windows · x64](https://github.com/largetomatoes/mac-/releases/download/v3.14/Wenjian-3.14-build319-Windows-x64.zip)
- [Android](https://github.com/largetomatoes/mac-/releases/download/v3.14/Wenjian-3.14-build319-Android.apk)
- [对应完整源码与修改记录](https://github.com/largetomatoes/mac-/tree/v3.14-build319)
- [源码 ZIP](https://github.com/largetomatoes/mac-/releases/download/v3.14/Wenjian-3.14-build319-source.zip)

本构建使用独立附件名，保留旧 v3.14 安装包与清单。请使用本说明中的 319 源码标签或源码 ZIP；GitHub 针对历史 v3.14 标签自动生成的源码属于该标签原来的构建。

## 构建与验证

构建步骤见 BUILDING.md。三端发布包均为空白资料库，不包含作者书籍、笔记、草稿、云账号、访问密钥或签名私钥。Android 保持原证书与应用 ID。

功能回归覆盖独立问题页结构、三设备数据往返、共同笔记来源、卡片修改及归档恢复、备份、编码、阅读、更新签名和安装回退；另有 Mac 原生窗口及手机宽度的构建界面测试。Windows 原生模块与 UTF-8 归档、Android 编译/lint/签名/对齐均检查；本次未在实体 Windows 或 Android 设备完成运行验收，也未操作个人坚果云或 OSS 进行联调。

详细验证范围见 [VERIFICATION_3.14_319.md](VERIFICATION_3.14_319.md)。
