# 稳定性修复、性能与 Chrome 回归

日期：2026-11-06。工作分支：`codex/reliability-performance-20261106`。原始审查见[风险报告](../../reviews/2026-11-06-code-review.md)。本次操作均为本地提交和隔离合成账本测试，没有部署 NAS、访问生产账本或推送远端。

## 修复分组

| 本地提交 | 内容 | 原风险 |
| --- | --- | --- |
| `5788494` | 本机编辑依赖、最终合并校验、统一账户改币规则；初始化以回执水位建立基线 | R1、R2、R5 |
| `7abafd0` | 只接受明确安全的更新握手；旧客户端静态资源可离线读取，按引用回收缓存 | R3、R4 |
| `385923f` | 报价实际日期与请求日期分离，近期/历史 TTL，近期重抓与退避 | R6 |
| `5a695eb` | 请求异常及备份故障的允许字段诊断，不记录金融载荷、凭证和 SQL | R9 |
| `a83df51` | 已确认历史保留窗口、存储设置、当前账本轻量备份 | R8 的本机缓解 |
| `b2ec4a4` | 直接结构比较、结构共享、受影响关系校验、SQL 摘要与空轮询；UI 筛选/排序/描述/余额缓存和首屏行数 | R7 |

维护性另补当前实现规则索引、CI 和复现脚本。原有 `icons.tsx` 及 Settings 类目图标修改没有纳入这些提交。R8 未宣称彻底解决：离线未同步历史不能安全删除，服务端日志压缩和超大备份格式仍需后续方案。

浏览器验证结束后，三份已跟踪的 `public/index.html`、`public/release.json`、`public/sw.js` 已按事前补丁逐字恢复到任务开始时的未提交状态，避免把生成结果混入原有工作；重新预览本分支请执行 `npm run build` 或 `npm start`。本次临时 Chrome 与两个静态测试服务器均已关闭。

## 验证结果

- `npm run check` 通过；最终 `npm test` **177/177 通过**，包含并发编辑/初始化、延迟更新握手、旧缓存、报价、备份恢复、留存和新缓存等价性/跨日失效测试。详见 [tests.txt](tests.txt)。测试使用独立 SQLite / IndexedDB，不是生产数据。
- `npm run build` 通过，保留主 bundle 超过 800 kB 及 Lucide `use client` 提示；没有把这些提示隐藏。详见 [build.txt](build.txt)。优化版指纹 `0.14.5-8413444f85937b22`。
- 审查阶段经授权的 npm 官方审计返回 0 项已知漏洞（130 个依赖），本次未改变依赖。它不代表业务逻辑、容器镜像或未知漏洞均安全。
- 独立 Google Chrome 156.0.8078.80 headless，390 × 844 视口，4 倍 CPU 限速；日历固定为 `2026-11-06T04:00:00Z`，`performance.now()` 保持真实计时。对照版为原工作区 `1812a3d` 加原有图标改动，指纹 `0.14.5-cd952560086e7f5b`。
- 合成数据：19 个 CNY 账户、8 个项目、20,000 笔历史收支、646 笔待入账。按同一顺序从 UI 操作，没有直接调用业务函数写交易；仅初始化种子时替换隔离源的 IndexedDB。

两版均通过 13 项浏览器断言：新增支出、搜索、关联退款、拆分类目、同币转账、状态切换、删除消费保留退款、恢复、整数净值核对、分类报表金额核对、分页、断网刷新、离线报表 Worker。结果均为 20,004 笔、revision 7；净值 **1,010,196.19 CNY**；近 30 天支出 **595.66**、退款 **2.34**、净支出 **593.32**。两次均未捕获应用 `Runtime.exceptionThrown`。明细：[修改前](baseline-business.json)、[修改后](optimized-business.json)、[离线报表截图](optimized-business.png)。

浏览器测试覆盖上述 CNY 路径；跨币结算、冲突和后台挂起的组合由自动化领域/协议/VM 测试覆盖，未宣称本次已在真实 iPhone 上测试。

## 性能对照

页面切换计时从点击到目标 UI 出现后两个 animation frame，各 3 轮取中位数。保存计时包含提交、持久化、返回页面及渲染反馈；支出、退款、拆分、转账各 1 次，取 4 次中位数。测试串行执行，最终切页采样时没有运行单元测试。原始数据保留，样本数有限，结果不是生产 p95，也不等价于 iPhone 帧率。

| Chrome 操作 | 修改前 | 修改后 | 耗时缩短 |
| --- | ---: | ---: | ---: |
| 保存反馈，中位数 | 1,329.2 ms | 516.4 ms | 61% |
| 交易页切换，中位数 | 68.5 ms | 48.4 ms | 29% |
| 账户页切换，中位数 | 60.8 ms | 31.2 ms | 49% |
| 报表目录切换，中位数 | 31.3 ms | 31.1 ms | 基本持平 |
| 第一次进入交易页 | 101.7 ms | 78.0 ms | 23% |

原始切页记录：[修改前](baseline-browser.json)、[修改后](optimized-browser.json)。首次交易页仍有 **57 ms** 长任务（此前 69 ms）；后续两轮未记录 ≥50 ms 长任务。初次渲染从 80 行改为 40 行，用户可以继续加载，业务总额和完整筛选范围没有截断；这是收益的一部分，不应把全部收益归因于缓存。

Node 24.13.0 单次合成实验（16k/32k 交易，单账户；不加 CPU 限速）补充观察服务端和同步模型。修改前来自原始审查，修改后原始记录见 [node-after.json](node-after.json)：

| 操作 | 16k 修改前 → 后 | 32k 修改前 → 后 |
| --- | ---: | ---: |
| 单笔 diff | 97.4 → 21.6 ms | 194.4 → 37.5 ms |
| 生成同步命令 | 162.9 → 27.9 ms | 343.5 → 47.9 ms |
| 服务端 push | 87.6 → 26.2 ms | 163.9 → 37.9 ms |
| 空 pull | 13.2 → 0.2 ms | 27.8 → 0.1 ms |
| 完整未共享快照校验 | 64.9 → 66.4 ms | 111.9 → 104.8 ms |

完整校验没有明显加速，安全边界仍保留。保存依然需整账 IndexedDB 读写和业务意图克隆，因此不能声称已消除所有大账本卡顿。

## 复现

先安装当前锁定依赖并运行检查。Node 基准会创建并清理自己的临时 SQLite：

```sh
npm run check
npm test
npm run build
node scripts/review/benchmark.mjs
```

Chrome 脚本仅适用于 **专用的临时 Chrome 配置**：会关闭该调试实例的页面，并清空测试源下的账本。不要连接日常浏览器或生产服务。先分别准备修改前后的静态构建目录；本次基线包含任务开始时尚未提交的图标变更，单独 checkout `1812a3d` 的 bundle 指纹会不同。脚本不自动 checkout，也不会修改主分支。

以下命令分别在独立终端运行（`BASELINE_PUBLIC` 须为基线 public 的绝对路径）：

```sh
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless=new \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9337 \
  --user-data-dir=/tmp/fine-ledger-isolated-chrome-review \
  --no-first-run --no-default-browser-check about:blank
node scripts/review/browser-server.mjs "$BASELINE_PUBLIC" 4195
node scripts/review/browser-server.mjs "$PWD/public" 4196
```

随后依次运行，不要与构建/单元测试并行。默认报告目录 `/tmp/fine-ledger-browser-review`，可用 `REVIEW_OUTPUT` 覆盖：

```sh
node scripts/review/browser-baseline.mjs 4195 baseline
node scripts/review/browser-baseline.mjs 4196 optimized
node scripts/review/browser-business.mjs 4195 baseline
node scripts/review/browser-business.mjs 4196 optimized
```

合成账本日期固定，CDP 驱动同时冻结日历时钟，确保以后重跑仍得到相同报表窗口。`REVIEW_TIME` 可调整时钟，但改变日期后需同步更新固定报表断言。脚本初始化 IDB 及修改均只发生在本机 4195/4196 测试源。

## 剩余边界

- 首屏 bundle 仍大、初始化与导入仍执行完整校验，万级保存仍有约半秒的限速浏览器等待；更大规模应评估实体化 IndexedDB、命令级增量和 Worker，不在缺乏新基准时直接重写存储。
- 尚未测真实 iPhone Safari 的后台恢复、内存峰值或 50k/100k 的交互延迟。本次结果支持“主要路径明显改善”，不支持“所有设备不再卡顿”。
- 自动留存只整理安全确认的本机历史；64 MiB 备份限制、服务端长期日志和离线唯一副本的存储压力仍需监控。
- CI 配置已加入，本地等价命令通过；未推送，因此没有远端 Actions 执行结果。NAS 部署与真机升级需要后续单独进行。
