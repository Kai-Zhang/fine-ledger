# 厘序自托管服务

本服务可运行在支持 Node.js / Docker 的服务器上，不依赖 NAS 品牌、设备名、固定 IP、特定域名或 QNAP 组件。网页和 API 必须由同一个 HTTPS 来源提供，部署在来源根路径；可由反向代理负责 TLS，也可配置证书由应用直接提供 HTTPS。默认容器提供 HTTP 上游。

本轮已接通本机账本自动同步：冻结请求幂等上传、完整提交批次增量应用、前台重试、多标签租约、认证过期保留、实体级冲突核对，以及服务恢复代次变化后的安全暂停。界面区分“已保存到本机”和“已同步”；网络错误不会阻止本机保存。NAS 实机部署与完整设备验收状态见 [0.12.0 验证记录](sync-review-v0.12.0.md)。

## 接入方式

1. 部署服务，配置稳定 HTTPS 来源和受设备信任的证书。
2. Safari 访问该来源，页面提供新建本机账本与连接服务入口。
3. 使用 Safari 的分享菜单添加到主屏幕，从新增图标打开应用。
4. 主屏幕应用是独立的本地存储环境，需要在该环境重新登录/初始化。不能假设 Safari 的 IndexedDB 会复制过去。选择“连接已有账本”，验证口令后预览并下载远端副本，即可在该环境离线记账。

账本服务固定使用网页当前来源，不再提供地址输入。更换部署来源需访问新入口，并在该来源重新连接、下载；本机存储不会跨来源搬迁。已有本机账本可从设置明确确认替换：先校验快照摘要、账本身份、恢复代次及实体版本，再在同一 IndexedDB 事务保存工作副本和远端基线、水位，清理旧活动操作、草稿和修订；替换前保留一份本机副本，可随完整备份导出。预览后本机保存或草稿变化时拒绝覆盖。离线已保存的账本不因服务未连接而失效。

## 部署参数

| 环境变量 | 默认值与用途 |
| --- | --- |
| `FINE_LEDGER_PUBLIC_ORIGIN` | 本机开发为 `http://localhost:4181`；真实部署必须显式指定 `https://实际域名[:端口]`，无路径、查询或凭据 |
| `FINE_LEDGER_HOST` / `FINE_LEDGER_PORT` | `127.0.0.1` / `4181`；容器监听 `0.0.0.0` |
| `FINE_LEDGER_DATA_DIR` | `.local/service`；容器 `/data`，数据库必须位于服务本地持久卷，不能放到跨主机 SMB/NFS 挂载 |
| `FINE_LEDGER_BACKUP_DIR` | 数据目录下 `backups`；备份目标为部署者可写的本地目录/挂载卷 |
| `FINE_LEDGER_STATIC_DIR` | `public`；预构建网页资源目录 |
| `FINE_LEDGER_TLS_CERT_FILE` / `FINE_LEDGER_TLS_KEY_FILE` | 默认空；直接提供 HTTPS 时同时指定 PEM 证书链和私钥文件，来源必须为 HTTPS；私钥限服务用户读取 |
| `FINE_LEDGER_PASSWORD_FILE` | 初次启动必需；保存至少 12 个字符的应用访问密码，可有一个末尾换行；不是 SSH 密码 |
| `FINE_LEDGER_TRUSTED_PROXIES` | 默认空，不信任转发头；确有代理时填逗号分隔的可信代理 IP/CIDR，避免错误归属登录限流地址 |
| `FINE_LEDGER_SESSION_DAYS` | `30`，范围 1–365，设备会话有效期 |
| `FINE_LEDGER_SERVICE_NAME` | 首次初始化运行设置的默认服务名称 |
| `FINE_LEDGER_AUTO_BACKUP` | 首次初始化默认 `false`；只有字面 `true` 才启用 |
| `FINE_LEDGER_BACKUP_INTERVAL_MINUTES` | 首次初始化默认 15 分钟，范围 5–1440 |

监听地址、来源、证书及文件目录属于部署配置，修改后按部署流程重启应用；App 不能凭界面修改主机网络和挂载。服务名称、自动备份开关、间隔和保留数量属于数据库中的运行设置，可在登录后的“同步与设备”修改，保存即生效。运行设置一旦建立，后续环境变量不覆盖用户已保存值。

HTTP 只允许本机回环开发来源；生产来源配置为 HTTPS 后使用 Secure、HttpOnly、SameSite=Strict 会话 Cookie。反向代理必须保留 Cookie、Origin 和 `X-CSRF-Token`，API 不缓存，不重写为登录 HTML。首次服务配置需同时确定外部来源，不能以任意请求 Host 动态信任调用方。

## 本机运行

要求 Node.js 24.13.0 或更高、支持 `node:sqlite` 的版本。本轮在 Node 24.13.0 验证，SQLite 模块会产生实验特性提示。SQLite 使用外键、WAL、`synchronous=FULL`；单数据目录通过独立 SQLite 文件锁保证只运行一个服务或管理命令，异常退出后由操作系统释放锁。

```sh
npm ci
npm run build
# 先在仓库外准备仅当前用户可读的应用访问密码文件，再设置其绝对路径。
export FINE_LEDGER_PASSWORD_FILE=/absolute/path/to/access-password
npm run service:start
```

开发网页为 `http://localhost:4181/`。`npm start` 仍为静态资源服务。另提供 `npm run service:review:start`，复用本机 P0 证书在 8445 启动独立的合成账本评审服务；同端口的旧静态服务须先停止。此脚本专用于本机验收，证书目录中的主机配置不构成通用服务的部署默认值。操作与预期结果见 [8445 验收清单](server-validation-8445.md)。

## Docker Compose

仓库提供 `Dockerfile` 与 `compose.yaml`。示例仅把应用端口绑定到宿主回环，通常由同机反向代理访问。若反向代理位于另一台主机或容器网络，部署者按实际网络修改绑定或使用内部网络；不是由应用假定宿主拓扑。

```sh
export FINE_LEDGER_PUBLIC_ORIGIN=https://your-ledger-domain.example
export FINE_LEDGER_PASSWORD_SOURCE=/absolute/path/to/access-password
npm run container -- build
npm run container -- up -d
```

版本唯一来源是 `package.json.version`。`npm run container -- …` 将该版本传给 Compose，默认镜像为 `fine-ledger:<当前版本>`；两个容器烟测也读取同一来源，分别执行 `npm run container:test` 和 `npm run container:test:tls`。升级版本使用 `npm version patch --no-git-tag-version`（或指定目标版本），同步维护 npm 标准的 lock 文件；随后构建，不能仅修改旧镜像标签来冒充新构建。

发布时建议保留明确版本标签，可另给同一镜像增加 `latest` 别名用于尝新；生产部署和回滚记录具体版本，要求精确重现时记录镜像 digest。`latest` 是可移动标签，不表示已自动升级，也不能消除版本不一致。不要将 Node 基础镜像改为 `latest`。[Docker 标签说明](https://www.docker.com/blog/docker-best-practices-using-tags-and-labels-to-manage-docker-image-sprawl/)、[固定 digest 的构建建议](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)。

要指定其他仓库、回滚版本、`latest` 或 digest，可先 `export FINE_LEDGER_IMAGE=仓库/镜像:标签`（或 `仓库/镜像@sha256:摘要`）。此显式环境变量优先于默认版本，烟测也会使用它；烟测的位置参数可再覆盖镜像。直接在没有 Node 的 NAS 上运行 `docker compose` 时，必须显式设置 `FINE_LEDGER_IMAGE`，否则配置检查会提示缺失，不会默默使用陈旧标签。构建和测试在交付机器执行，NAS 只运行已交付镜像。

Compose Secret 挂载的密码文件必须能被容器应用用户（默认 UID/GID 1000）读取；本地 bind 类型 Secret 的 uid/gid/mode 不一定会被 Compose 重映射，请在部署环境核对权限。可按宿主用户调整镜像/Compose 的运行用户，持久卷也必须由该用户可写。不要复用 NAS/SSH 管理员密码。

默认使用独立命名卷。若需要指定宿主路径，将 `ledger-data:/data` 换成实际本地持久目录挂载，并设置正确的权限。已有服务和数据库不能通过增加第二个副本实现扩容；本版本是单实例写入。

每个服务实例/数据目录目前只托管一本账本，已有账本不能通过初始化接口覆盖。本机从文件恢复不会改写远端，恢复后关闭自动同步；不同账本 ID 不能直接合并。评审脚本预置的演示账本也遵守相同规则，没有固定 ID 的特殊分支。正式迁移需选定空的数据目录/新实例，或明确处理已有库的替换；这不是同一实例内的多账本切换。

`FINE_LEDGER_PUBLISHED_PORT`、`FINE_LEDGER_BIND_ADDRESS` 可调整宿主暴露端口和绑定地址。容器镜像使用非 root 用户、只读根文件系统和独立可写数据卷，不需要 Docker socket、特权模式或宿主网络。

## 首次账本与协议

访问密码由首次部署的密码文件建立，数据库只保存独立盐的 scrypt 校验值；不是任何人可调用的公开初始化接口。现有数据库再次启动不读取文件重置密码。

登录后可以选择当前厘序的 `fine-ledger-backup` v3 JSON 文件，预览名称、主币、账户与交易数量，明确确认后初始化空服务。不会自动读取浏览器账本，不重放文件里的旧 outbox，不覆盖已有服务账本。此入口不是 MoneyWiz 转换器，也不是客户端恢复入口。

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/meta` | 非敏感协议、服务名称与恢复代次 |
| `POST/GET/DELETE /api/v1/session` | 登录、读取会话与 CSRF、断开当前设备 |
| `GET /api/v1/devices`；`PATCH/DELETE /api/v1/devices/:id` | 设备列表（含有效会话状态）、更名、撤销 |
| `POST /api/v1/ledger/initialize` | `{book,operationId,serverEpoch}`，只初始化空服务，重复同 ID 同负载返回原回执 |
| `GET /api/v1/snapshot` | 固定水位完整账本、实体版本与 SHA-256 校验值 |
| `POST /api/v1/sync/push` | `{protocol,commands}`，有序处理业务命令；每个命令独立事务 |
| `GET /api/v1/sync/pull` | `ledgerId,serverEpoch,after,limit`，按完整提交批次分页 |
| `GET/PATCH /api/v1/settings` | 运行设置；修改必须提供读取时的 revision |
| `GET/POST /api/v1/backups` | 备份清单、手动一致性备份 |
| `DELETE /api/v1/backups/:id` | 将一份备份移出清单，返回 `undoUntil`；可重试 |
| `POST /api/v1/backups/:id/undo-delete` | 24 小时内撤销删除；不会恢复或替换当前账本 |
| `GET /healthz` | 不含账本内容的数据库探活 |

所有变更请求要求与配置匹配的 `Origin` 和 JSON Content-Type，登录之外还要求当前会话的 `X-CSRF-Token`。只允许同源，无任意跨域 CORS。登录尝试有持久化的每地址和全局限额，不记录请求负载或凭据。

一条命令包含 `operationId,ledgerId,serverEpoch,expected,dependsOn,changes`。`expected` 为 `{collection,id,version}` 数组；`changes` 为 `{collection,id,value}` 数组。集合是 `book,groups,accounts,categories,projects,entries,reports`。交易还需声明所引用账户、类目、项目和退款来源的版本。版本来源是服务快照/提交回执，不能使用客户端墙钟或整本本地 revision 代替。

同 ID 改负载返回 `OPERATION_ID_REUSED`；实体并发返回 `conflict` 和当前远端值；违反金额/关系规则返回 `rejected`；依赖尚未提交返回 `blocked`。冲突/拒绝请求不能换版本原样强推，解决时创建新 ID。服务成功提交才返回 `committed`；上传回执游标不等于客户端已完成拉取的游标。删除交易使用 `deletedAt` 墓碑，不能物理删除；其他实体删除须通过关联校验。

服务端保留实体修订、回执和提交历史。金额始终为最小单位整数字符串。SQLite 保存关键关系和拆分外键，JSON payload 用于保留业务字段，余额/报表不作为独立账务来源。

## 备份和停服恢复

自动任务默认关闭。打开后，每 30 秒检查一次调度：有已提交变化且到达间隔才生成一致性快照。默认保留最近 24 小时的近期版本、14 天日版本、4 周周版本，以及最近 10 份手动/恢复前备份。无变化不重复备份。备份失败保留已有成功版本并更新错误状态。

备份使用 SQLite Online Backup API，完成后检查数据库和外键，再原子发布带 SHA-256、版本、代次和水位的清单。不能用直接复制活跃主数据库替代。当前目标仅本地磁盘，不代表已具备独立介质保护。

备份列表的内容区只读，不使用省略号菜单或整行点按来展开删除。可以从右向左滑出一条备份的删除按钮，也可以通过页头“编辑／完成”显示或收起删除控件。滑动本身不删除；点击删除后显示 10 秒撤销入口。服务端通过同目录的 `.deleted.json` 标记立即隐藏备份，原文件保留 24 小时，到期后由服务的周期任务清理（即使自动备份关闭）。删除标记跨重启保留；删除、撤销、创建与保留清理串行执行。删除中的备份不能直接用于 CLI 恢复，需先撤销删除。对备份的操作不更改账本、同步水位或恢复代次。

恢复只能在服务停止后，通过管理命令执行；文件锁阻止对正在运行的服务恢复。先验证目标快照、保留恢复前数据库备份，再替换数据库。恢复后生成新 `serverEpoch`，撤销会话并使用管理端指定的新访问密码；旧客户端收到 `EPOCH_CHANGED` 必须保留本机数据并停上传。

```sh
# 先通过实际进程/容器管理方式停止应用。
# 使用与服务相同的数据目录、备份目录及密码文件配置。
npm run service:restore -- backup-实际备份ID
# 或仅重置访问密码并撤销全部会话：
npm run service:reset-password
```

Compose 可在停服后运行同配置的一次性管理容器：

```sh
npm run container -- stop fine-ledger
npm run container -- run --rm --no-deps fine-ledger node server/main.ts restore backup-实际备份ID
npm run container -- up -d
```

仅回退镜像不保证数据库可降级。超过支持 schema 的数据库会拒绝打开。恢复数据库不能直接替换客户端副本；较新的已确认本机数据也可能晚于备份，后续恢复核对界面需同时比较它们与 outbox。

## 验证及尚未完成的门槛

服务端故障与并发测试位于 `test/server.test.mjs`，使用隔离的临时目录和合成账本。`node scripts/test-service-container.mjs` 可对已构建镜像执行一次隔离容器验收，并自动清理测试容器和卷。覆盖同源/CSRF、会话撤销、初始化重试、幂等回执跨进程保留、冲突、整批拉取、转账回滚、退款合计、归档并发、备份校验/恢复代次和单实例锁。

本轮不连接真实个人账本或在 NAS 上自动部署；不能据此标记 NAS 持久卷重启、实际断电、双设备最终一致、iPhone 主屏幕登录与离线升级、真实恢复或 P2 整阶段通过。完整客户端同步、通用版本化 ZIP 交换格式、MoneyWiz 转换及正式迁移分别按后续交付验收；互联网组网不在本轮范围。


## 客户端同步与文件恢复

账本下载后建立远端基线、实体版本和拉取水位。前台会在保存后、重新联网、返回页面时同步，并定期检查远端。记录仍先在 IndexedDB 原子保存；上传失败保留待同步内容。设备外观不上传，常用报表参与同步。

请求首次发送前冻结操作 ID、依赖、版本条件和业务内容；响应丢失后重试原请求，不生成第二笔交易。上传回执不直接推进拉取水位，必须完整应用提交批次。本机与远端各自修改不同实体时自动合并；同一实体或关联校验冲突则暂停上传，在“处理同步差异”逐项选择。拒绝操作保留内容等待处理，不反复提交无效请求。

恢复服务备份会更换 server_epoch 并使原会话失效。重新连接后先比较本机与恢复后的远端，保留较新的已确认记录和待上传内容；确认前不重发旧请求。核对时远端再变化会刷新比较并要求重新确认。

设置支持完整 ZIP 备份与原 version 3 JSON 文件回导。ZIP 包含 manifest.json 与 ledger.json，记录文件长度和 SHA-256；读入时校验格式、大小、金额和实体关系。完整备份包含本机工作副本、待同步操作、修订、草稿及恢复副本，不包含口令和会话 Cookie。回导前预览并保留当前副本；回导后的旧冻结请求仅作为历史保留，不自动重发。重新连接远端必须先核对，跨来源搬迁也遵循此流程。ZIP 是完整恢复格式，不是 MoneyWiz 转换器；后者仍在后续迁移阶段。


### 容器健康检查

健康探针按实际直连 TLS 配置选择 HTTP 或 HTTPS；不通过公开 DNS 回流访问本机端口。直连 HTTPS 使用部署的证书链和公开域名完成 TLS 验证（[Node.js TLS 选项](https://nodejs.org/download/release/v24.20.0/docs/api/tls.html)）；证书域名不匹配会使探针失败。`npm run container:test:tls` 使用临时合成证书验证无反向代理启动、健康探针和同源登录，结束后清理一次性容器、卷及凭据。实际 NAS 的证书和挂载权限仍需部署时验证。
