# QNAP 家庭试运行部署

入口：`https://nas590daa.local:62187/`。NAS 固定地址为 `192.168.0.230`。

家庭 NAS 已接收实际账本。2026-11-03 用户确认厘序与 MoneyWiz 并跑试用。自动备份关闭，升级前单独创建 SQLite 一致性恢复点。

2026-11-03 当前服务镜像为 `fine-ledger:0.14.5-nas-ios-edge-d613d5b9`，发布指纹为 `0.14.5-d613d5b97ed99424`。镜像基于上一版 `fine-ledger:0.14.5-nas-swipe-581956c7`，保留大账本滑动优化并恢复 iOS 边缘返回的触摸捕获。升级前的一次性 SQLite 一致性恢复点与上一版 Compose 配置位于 NAS 的 `/share/Container/fine-ledger/data/pre-upgrade-ios-edge-d613d5b9/`，提交水位为 5；恢复数据库前先核对水位 5 之后的交易。

以下创建步骤用于首次安装。现有实例升级沿用应用名和持久挂载。

## Container Station 创建应用

镜像和宿主目录准备完成后，在 Container Station → 应用程序 → 创建：

1. 名称填写 `fine-ledger`。
2. 将同目录 `compose.yaml` 的完整内容粘贴到 YAML 编辑器。
3. 点击“验证”；通过后点击“创建”。
4. 若有“创建前拉取映像”选项，关闭它：两个镜像已从 Mac 导入 NAS。
5. 保持默认资源设置；不要开启特权模式或宿主网络。
6. 可选的默认 Web URL 不是必要设置；直接收藏完整 HTTPS 入口，避免管理器使用 IP 或 HTTP 生成错误地址。

容器、健康状态、日志以及启停操作可从此应用及其关联容器查看。
应用创建后的 YAML 由 Container Station 管理；今后仅修改宿主 compose 文件不会自动更新控制台中的应用配置。
升级时先核对版本、镜像和数据兼容性，再使用控制台的应用更新功能；不要自行删除应用、容器、镜像或数据目录。

## 持久化与口令

宿主项目目录：`/share/Container/fine-ledger/`。

- `data/`：运行数据库；容器重建时继续挂载此目录。
- `caddy-data/`：CA 和证书私钥；必须持续保留，重建容器不能重新创建 CA。
- `caddy-config/`：Caddy 运行配置。
- `caddy/Caddyfile`：HTTPS 及反向代理配置。
- `secrets/access-password`：独立的应用登录口令，不是 SSH 密码。
- `certificates/`：给设备安装的公开根证书，不放 CA 私钥。

两个容器都是非 root 用户、只读根文件系统，必要目录单独可写。
厘序另挂载容量上限 64 MB 的内存 `/tmp`，供 SQLite 大批量初始化等操作创建临时文件；不会持久化账本到该目录。缺少此挂载时，大账本可能报 `SQLITE_IOERR_GETTEMPPATH`（6410）。
HTTPS 使用 `fine-ledger-caddy:2.11.7-nas-20261102` 派生镜像；构建来源与操作见 `Caddy.Dockerfile`。
官方 Caddy 二进制携带低端口文件能力标记，与 `cap_drop: ALL` 冲突；派生镜像仅去掉该标记，继续保留非 root 和最小权限限制。
只发布 `192.168.0.230:62187/tcp`，4181 不发布到宿主。
专用桥接网络为 `172.30.62.0/29`，厘序仅信任 Caddy 的 `172.30.62.2` 代理地址。
两个容器各配置 `json-file` 日志轮转：每份 10 MB，最多 3 份。

## iPhone 证书与迁移

1. 在设备安装已核对 SHA-256 指纹的公开根证书。
2. iPhone：设置 → 通用 → VPN 与设备管理，安装证书描述文件。
3. 设置 → 通用 → 关于本机 → 证书信任设置，启用对应根证书的完全信任。
4. Safari 打开完整 HTTPS 入口，确认没有证书警告，然后添加到主屏幕。
5. 从新增主屏幕图标打开后，新建本机账本，再导入用户自己的旧账本文件。
6. 核对导入结果，再连接当前服务，使用独立应用口令将账本上传到空服务端。
7. 确认已同步，再验证离线保存与恢复网络后的同步。

Safari 与主屏幕应用存储彼此独立，迁移操作应在准备正式使用的主屏幕环境完成。
保留旧来源的图标、账本及导出文件，完成核对前不清理。

## 试运行维护边界

`FINE_LEDGER_AUTO_BACKUP=false`；部署验收还应核对数据库中的实际运行设置。
没有独立外部备份目标；同 RAID 上的手动备份主要用于误操作或升级恢复。
手动备份创建后，应用仍按其保留策略维护备份；本次初始服务没有历史备份。
不承诺未实际执行的 NAS 整机重启、iPhone 离线启动或正式账本迁移验收。

参考：[QNAP 创建和管理 Compose 应用](https://www.qnap.com/en/how-to/tutorial/article/how-to-use-container-station-3)、[Caddy 本地 HTTPS](https://caddyserver.com/docs/automatic-https)、[Apple 根证书信任步骤](https://support.apple.com/en-us/102390)。
