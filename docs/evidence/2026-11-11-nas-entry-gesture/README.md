# NAS 记账入口与边缘返回部署

2026-11-11，用户确认体验验收通过并授权部署 NAS。

- 入口：`https://nas590daa.local:62187/`。
- 新镜像：`fine-ledger:0.14.5-nas-entry-gesture-760054d`，linux/amd64。
- 镜像 ID：`sha256:978c7c85d7a636662b757fb9cc85a0f14296575d829101c3d9e5dd7a253f651e`。
- 发布指纹：`0.14.5-760054d8f5570596`。
- 旧镜像：`fine-ledger:0.14.5-nas-running-balance-cd95256`，保留可回退。

部署在旧镜像上仅叠加验收后的静态前端；所有旧镜像层完整保留，服务端、运行时与依赖均未替换。当前前端同时包含工作分支上已有的可靠性和性能改进；这些已通过此前浏览器检查、本轮 182 项回归及本轮用户验收。未将本地较新的服务端改动带入 NAS，未变更数据 schema。

使用 Container Station 实际管理的 `docker-compose.yml` 和 `docker-compose.resource.yml`，项目名仍为 `fine-ledger`；备份配置后仅更新应用镜像，执行 `compose up --no-deps --wait fine-ledger`。同步更新宿主 Compose，Caddy 容器 ID 保持不变，既有挂载、64 MB tmpfs、非 root、只读根目录、日志限制和证书保持不变。

恢复点：`/share/Container/fine-ledger/data/pre-upgrade-entry-gesture-760054d8/`。包含 `ledger.sqlite`、`before.json`、`managed-compose.yml`、`managed-compose.resource.yml`、`host-compose.yaml`。SQLite 通过在线 backup API 创建一致性副本，并检查完整性与外键。

升级前后均为 19 个账户、16,313 笔交易，水位 22，数据库版本 1。ledger、account_groups、accounts、categories、projects、entries、splits、reports、versions、commits、revisions 的有序记录哈希全部一致，`integrity_check=ok`、外键问题 0、自动备份仍关闭。见 [before.json](before.json)、[after.json](after.json)。

通过既有根证书验证 HTTPS 主机名与信任链；`/healthz` 正常，API 元数据保持 no-store，首页、worker、发布清单及全部 10 项资源逐字节匹配本地构建。旧发布 `0.14.5-cd952560086e7f5b` 的入口仍可访问。见 [deployment.json](deployment.json)。

仅回退此次前端时，使用已保存配置恢复旧镜像并重建应用服务即可，无需还原数据库。部署后如已有新记账，不应直接覆盖为升级前 SQLite 副本。
