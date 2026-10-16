# 问间 Web 2 · iPhone / iPad

- 公开 Web App，每人连接自己的坚果云；不要求 ChatGPT 账号，不创建共用笔记库。
- iPad 侧栏、网格书库、横屏阅读与本书笔记并排；适配竖屏及分屏。
- PDF / EPUB、过程笔记、章节、问题关联、卡片、离线与原协议同步。原件按需下载，单本传输限 80 MB。
- 默认不记住应用密码，可选本机加密记住。WebDAV 中转固定坚果云目录，保留 ETag 并发校验，增加分 IP 短时请求限制。
- 桌面端和安卓的安装包、构建入口保持原样。

验证：虚构云盘和样书下的 PDF / EPUB、选字笔记、离线重开、草稿、多窗口保存、两个独立浏览器资料隔离；Chrome 的 390、768、820、1024、1180 与 507 px 界面检查。尚未在真实 iPhone / iPad 上验收长按选字、系统键盘和内存限制。

## 2026-10-16 · 独立 Cloudflare Workers 托管

- 公开入口迁移到作者自有 Cloudflare 账号：https://reader.wenjian-app.workers.dev/read/ ，地址不再带作者邮箱前缀；旧临时 Sites 地址停止作为主入口。
- 复用既有 Worker 产物（静态 PWA + 同源 `/api/webdav` 受限中转），无 D1 / R2，无公共笔记库；免费版请求体上限 100 MB，80 MB 单本传输限制与 ETag、限流、隐私行为不变。
- 新增 `npm run deploy:web-app`（`scripts/deploy-web-cloudflare.mjs`）：本机 `wrangler login` 后一键构建并发布，可用 `WENJIAN_WORKER_NAME` 指定 Worker 名。
- 已线上核对：`/read/`、manifest、Service Worker 正常；中转拒绝跨源（403）与目录越界（400）；经 Worker 回源坚果云连通（假凭据返回 401）；移动端浏览器渲染无控制台错误。
- 注意：`workers.dev` 免费域名在大陆不保证可达；换源后旧地址本机资料需先导出、再用同一坚果云在新地址接入。
