# P0 可靠性实验室使用说明

本轮使用独立合成账本。测试报告见 [P0 测试报告](reliability-p0-report.md)，原始结果在 `docs/test-evidence/`。最终 Node 22/22、桌面 14/14、iPhone 主屏幕独立应用 14/14 均通过；iPhone 暴露的连接占用与测试页超时及修复过程已保留在报告中。

## 环境隔离

| 环境 | 地址 / 存储 | 用途 |
| --- | --- | --- |
| 原 iPhone 体验 | HTTPS 8443；`.local/iphone/iphone-demo.sqlite` | 保持原服务运行，不参与故障注入或清空测试 |
| iPhone P0 | HTTPS 8444；`.local/reliability-iphone/iphone-demo.sqlite` | 合成样例、主屏幕和本机清空恢复 |
| 桌面浏览器 P0 | `http://127.0.0.1:4177/reliability.html`；`.local/reliability-browser/` | 真实 IndexedDB 事务测试 |
| Node 自动化 | 系统临时目录 `fine-ledger-reliability-*` | SQLite、杀进程、丢响应和灾难恢复；结束后清理 |

实验室页面使用 `fine-ledger-reliability-p0-v1` IndexedDB，和普通应用的 `fine-ledger-demo-v1` 分开。页面的清空按钮只删除实验室数据库，不操作缓存、普通账本、浏览器其他来源或系统存储。

故障控制接口和实验室页面只有 `LEDGER_RELIABILITY_TEST=1` 时开放，并要求数据库路径包含 `reliability`。它们继承同源检查和连接口令认证。不要在真实账本服务上启用此环境变量。

## 运行测试

```sh
npm run check
npm test
npm run test:reliability
```

桌面实验室可手动启动：

```sh
HOST=127.0.0.1 PORT=4177 LEDGER_DB=.local/reliability-browser/live.sqlite LEDGER_RECOVERY_DIR=.local/reliability-browser/archive LEDGER_RELIABILITY_TEST=1 node server.mjs
```

打开 `/reliability.html`，连接后点「运行 P0 自动验证」。无需安装测试依赖，运行的是实际 IndexedDB，未使用 IndexedDB 模拟库。当前自动测试有 14 项，包括并发打开和真实 blocked 等待。若提示等待其他页面关闭数据库，请关闭其他实验室标签，保留当前页面；不要清网站数据，删除请求会在释放后继续完成。

测试会主动删除实验室中的一个“只有本机副本”的反例；该反例无法恢复是预期边界，不应被描述成零丢失保证。

## 快照与完整增量恢复

服务启动时建立不可变的 `genesis.json` 基线，此后每个有新操作的同步批次生成一个独立日志文件。默认恢复目录为 `${LEDGER_DB}.recovery`，也可设置 `LEDGER_RECOVERY_DIR`。文件包含原操作 ID、完整变更载荷、接收时间、前序哈希、结果状态哈希及游标；逻辑删除和关联数据一并保留。

提交顺序为：校验业务聚合 → SQLite 事务内暂存 → 写日志临时文件并 fsync → rename 并 fsync 目录 → SQLite FULL 提交 → 返回回执。日志已经持久化而 SQLite 尚未提交时崩溃，启动会按日志重放后才提供 API。出现不确定的日志写入错误时停止服务，避免继续写入形成分叉。普通日志写入失败不发成功回执；客户端保留操作重试。

启动检查同批次数据库和日志内容是否一致。数据库落后于日志时重建；日志缺段、内容损坏、恢复链分叉、已建账本的恢复目录缺失时拒绝启动。恢复后重试旧操作仍使用原操作 ID，内容相同只返回原确认，内容不同拒绝接受。

生成一份一致性的应用快照：

```sh
node scripts/recovery.mjs snapshot .local/reliability-browser/archive .local/reliability-browser/old-snapshot.json
```

在旧快照之后继续记账并同步，然后恢复到一个**不存在**的新数据库：

```sh
node scripts/recovery.mjs restore .local/reliability-browser/archive .local/reliability-browser/old-snapshot.json .local/reliability-browser/recovered.sqlite
```

该命令验证整个日志链，载入旧快照，再重放快照后的全部操作，恢复业务状态、操作回执、游标和服务端修订。已有目标文件会拒绝覆盖。恢复不依赖仍然在线的旧数据库。启动恢复后的服务时显式指定同一恢复目录：

```sh
HOST=127.0.0.1 PORT=4178 LEDGER_DB=.local/reliability-browser/recovered.sqlite LEDGER_RECOVERY_DIR=.local/reliability-browser/archive node server.mjs
```

不要同时把同一恢复目录用于两个不同账本实例。此 demo 保留完整基线与全部日志，尚未实现安全裁剪或自动轮换。日志文件和快照必须与原始凭据一样妥善保护；SHA-256 链用于发现缺段和内容损坏，不替代访问控制或加密。

**独立目录仍在同一台 Mac / 同一介质，不能抵抗整机或磁盘丢失。** 只有把基线、快照及完整日志复制到另一故障介质并完成恢复演练，才可确认跨介质保护。本轮没有配置远端备份或对外网开放同步入口。

## iPhone 配合步骤

```sh
npm run reliability:iphone:start
node scripts/reliability-demo.mjs status
npm run reliability:iphone:stop
```

脚本复用原来已信任的测试 CA，生成独立口令，使用 8444 / 8181 / 4176 端口和独立数据库；不会停止或修改 8443 账本。口令在 `.local/reliability-iphone/connection.txt`，不要把它贴进报告。

1. 同一家庭 Wi-Fi，在 Safari 打开 `https://zhangkaidemac-mini.local:8444/reliability.html`，填写实验室口令连接。
2. 点「准备 iPhone 样例并同步」。全字段基准会保存到服务端，避免本机清空后丢失验证依据。
3. 分享 → 添加到主屏幕「厘序 P0」，从图标打开。Safari 与主屏幕实例可能需要分别输入同一口令。
4. 点「核验完整字段」，然后划掉重开，再核验。
5. 点「清空实验室本机并从服务恢复」，应仍逐字段匹配。该步骤是真实删除 IndexedDB 并重新初始化，不能代替系统删除 / 自动回收验证。
6. 后续测试删除**厘序 P0**图标、重新安装、设备重启时，记录实际系统选项和结果；是否真正清除了存储以重新初始化或数据库状态证据为准，不能只看图标消失。

**暂勿在 iOS 设置中按域名清除网站数据。** 设置界面可能按主机聚合站点，8444 与 8443 只差端口，误清理可能连带影响原体验账本。需要测系统级网站数据清理时，先用独立主机来源（例如经核对证书的 IP 站点）重新准备实验样例和外部基准，明确系统清理范围后再操作。实验室不同来源的本机数据不共用，未同步时不可切换来源。

完全离线或 NAS 不可达时，已提交但未上传的数据只有本机一份，删除本机后无法从 NAS 还原。草稿和本机短期历史也不是 NAS 业务快照中的恢复对象；未提交输入不属于“已同步账目”的保证范围。原始票据二进制附件目前尚未实现，本轮验证的是结构化账目与保存在备注中的原始票据文字。
