# 当前实现规则与维护边界

核对日期：2026-11-06。本文整理当前源码行为，替代早期设计中已经过时的实现描述；它不代表新增成本分配或对账产品需求。阶段状态仍见[实施计划](implementation-plan.md)。

## 折算与原币

- 原币账目和跨币转账两端实际金额独立保存；金额使用最小单位整数与精确比例，参考价不改写本金。
- Frankfurter v2 提供无密钥参考价；实现位于 `src/domain/reference-rates.ts`、`src/reports/reference-rate-cache.ts` 和 `src/reports/useReferenceRates.ts`。
- `reporting.ts` 的 `flowRate`：外币收入优先使用交易日参考价；其他流量优先使用非暂定的转入区间依据，没有该依据时用参考价，再回退至暂定区间。主币汇率恒为 1。
- 净值按各账户时点原币余额折算，优先采用该时点可用参考价，再回退至区间依据。报表取期末，首页取当前时点。来源不足保留缺失/暂定状态，不能把缺价当零值。
- 报价记录分别保留请求截止日、实际最新报价日与获取时间。近期和空结果缓存 1 小时，封闭历史区间缓存 30 天；近期刷新重抓最近 7 天，失败保留旧数据并退避。休市日不要求有当天报价。

这部分澄清早期“不联网报价”的失效条款，没有改变本次修复前的报表定价优先级。缓存回归覆盖见 `test/reference-rate-cache.test.mjs`，折算规则见 `test/reporting.test.mjs` 等领域测试。

## 不可变快照与业务提交

- React、同步模型中的 `Book` 是不可变快照。`applyChanges` 只复制变动集合，输入变更值仍深拷贝；不得直接修改返回快照中共享的旧对象。
- `repository.mutate` 在独立意图副本上执行可变业务命令，再在一个 IndexedDB 事务内核对最新实体及其依赖、验证合并账本、写 book/revisions/outbox。失败不落任何部分结果，并由表单保留输入。
- `validateBook(candidate, previous)` 的 `previous` 必须是已校验且未被修改的快照。只有对象和所有业务引用都相同的交易才跳过重复逐笔校验；外部文件、服务快照与初始化仍执行完整校验。增加交易依赖时，必须同时更新 `sync/edit-dependencies.ts` 和 `sync/protocol.ts`。
- 初始化基线来自该次初始化回执对应的 cursor/changes，不得用较新的远端 snapshot 直接替代；随后通过正常拉取与三方合并处理其他设备的修改。
- UI 与协议共用 `domain/account-policy.ts` 的账户改币规则；存在非零期初余额或任意交易历史时禁止改币。

## UI 计算与缓存

`domain/transaction-view.ts` 管理路由范围、筛选、排序；`domain/account-view.ts` 管理当前余额；`domain/description-view.ts` 管理描述建议。缓存依赖不可变对象，用 WeakMap 随快照回收；交易筛选每本最多 24 项，排序最多 8 项。相对日期筛选按账本本地日期失效；余额在下个未来端点生效或时钟回拨时重算。

交易列表首次打开时渲染 40 行，滚动接近列表底部时自动追加下一批 40 行。总笔数、筛选、报表和账户逐笔余额始终基于完整数据。路由类型在 `navigation/routes.ts`，领域模块不导入 React Context。

## 更新、历史与诊断

- Service Worker 只在客户端明确回答 `safe:true` 后自动导航；无回复或超时保留页面。带发布指纹的旧资源只查询对应版本缓存；仅回收没有客户端引用的旧版，未知客户端会阻止回收。
- 已确认本机账本与远端基线一致、无在途操作/冲突时，整理超出保留窗口的本机修改历史。默认 30 天且至少保留最近 1,000 次，可选 90 天、一年、全部保留。待同步项与交易记录不受删除策略影响。
- “完整备份”保留历史；“当前账本备份”省略 revisions 和旧恢复/源副本，保留当前账本、未同步状态、草稿和冲突。备份大小/解压限制继续生效；该功能不保证任意规模都小于 64 MiB。离线未同步历史、服务端变更日志尚无自动压缩。
- `server/diagnostics.ts` 仅记录操作名、请求 ID、路由模板、允许的错误码和源码帧；不记录请求体、令牌、账目内容、原始错误消息或 SQL。

## 验证入口

`npm run check`、`npm test`、`npm run build` 由 `.github/workflows/verify.yml` 在 push/PR 触发。CI 本次仅新增配置，尚未推送执行。性能和 Chrome 验证按[本次证据与复现说明](evidence/2026-11-06-reliability-performance/README.md)运行；禁止对生产账本运行种子脚本。
