# 问间

问间是围绕“我们该如何处理我们和世界的关系？”组织问题、回答、卡片、阅读笔记和文稿的本地应用。想法可以先留在卡片集中，之后再连接到一个或多个问题；搜索可以直接找到某条思考、回应或书中的笔记。

## 下载与安装

从仓库的 **Releases** 下载对应系统的安装包。Mac（Apple 芯片）使用 `Wenjian-*-macOS-arm64.zip`，解压后把“问间”拖入“应用程序”；Windows x64 使用 `Wenjian-*-Windows-x64.zip`，解压后运行 `问间.exe`。当前构建没有 Apple 公证或 Windows 商业代码签名，系统首次启动时可能要求手动允许。

应用本身不需要登录。未配置云备份时，笔记和电子书只保存在本机；已有的独立“问间同步”目录仍保存笔记，不会改动 Obsidian 的目录。问间会核对并复制旧目录中的原书到应用自己的本地书库，之后导入的新书也保存在此处，不再增加坚果云的书籍占用；旧目录中的原书暂时保留，方便回退。若原数据目录暂时不可用，应用会停止启动，避免误建空白资料库。

## 日常使用与备份

- 问题树、回答、交叉思考、卡片集和修改记录保留思考的来源与形成过程。
- 全局搜索能按记得的大意寻找思考、回应、读书笔记、书籍思考和文稿，并打开对应记录。
- 未正式保存的卡片、问题页、读书笔记和文稿草稿会保存在本机；文稿修改时会检查版本冲突。
- PDF 和 EPUB 阅读支持原文摘录、过程笔记、读书笔记和书籍思考；扫描版 PDF 可在本机 OCR。
- 在桌面应用的“问间”（Windows 为“文件”）菜单中选择“导出完整备份…”，可生成包含笔记、草稿和所有原书文件的 `.wenjian-backup`。备份会逐项校验，恢复时保留现有书籍文件，并在覆盖笔记前保留备用副本。旧版 JSON 备份仍可导入，但不包含原书文件。

## 阿里云 OSS 云备份

问间可以把完整备份作为**私有、独立的快照**上传到阿里云 OSS。它是手动云备份与跨电脑迁移入口，当前**不会自动实时同步**，也不提供 Android 客户端。在一台电脑上传后，另一台 Mac 或 Windows 电脑可以配置同一个 Bucket，查看并恢复云端快照；恢复前应用会自动给该电脑的现有资料生成一份完整备份。上传前会检查云端是否出现其他设备的新快照，避免静默覆盖。

先在阿里云建立私有 Bucket 和专用 RAM 用户，将权限限定到问间使用的 Bucket/目录，至少包括 `oss:PutObject`、`oss:GetObject` 和 `oss:ListObjects`。不要使用主账号 AccessKey。然后在桌面应用菜单中打开“阿里云 OSS 备份…”，填写地域（例如 `cn-shanghai`）、Bucket、目录、RAM AccessKey ID 和 Secret。Secret 只在本机通过系统安全存储加密保存，不会写入 GitHub 仓库或备份文件。上传与下载使用 HTTPS 和 SHA-256 校验。OSS 存储、流量费用由你的阿里云账号承担。

云端快照包含笔记原文和书籍内容。请保持 Bucket 私有，妥善保管 RAM 密钥。阿里云的 [RAM 最小权限说明](https://help.aliyun.com/en/oss/user-guide/ram-policy/) 和 [AccessKey 安全建议](https://help.aliyun.com/en/oss/user-guide/reduce-the-risks-of-unauthorized-access-caused-by-accesskey-pair-leaks) 可用于设置权限。

## 开发

需要 Node.js 22 或更新版本。

```bash
npm ci
npm run build
npm run lint
node --test tests/test-complete-backup.cjs tests/test-oss-cloud.cjs tests/test-search-ranking.mjs tests/test-pdf-export.cjs
node scripts/test-cross-blocks.mjs
npm ci --prefix work/mac-app
npm run package:mac --prefix work/mac-app # 在 Apple 芯片 Mac 上
npm run package:win --prefix work/mac-app # 在 Windows x64 上
```

仓库只包含代码、图标和空白种子数据；用户笔记、密钥、电子书、构建产物不纳入 Git。Mac 和 Windows 安装包目前通过本机打包并上传到 GitHub Releases；自动发布尚未启用。

## 当前版本

1.12.0（build 25）：完整备份、草稿恢复和更准确的搜索；增加阿里云 OSS 私有云备份入口及 Windows 离线构建。
