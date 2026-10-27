# 厘序 · fine-ledger

当前优先评审 [面向使用者的产品设计 0.3](docs/product-design.md)：账户与交易管理、返回导航、同步配置、主币种及两类核心报表。本轮已确认同步认证、主币锁定及汇率移出 MVP；剩余报表口径见产品设计第 15 节，前端开发保持暂停。

当前版本 0.3.1。启动时自动构建完整发布；运行中的服务更新源码后执行 `npm run build` 发布。以紧凑分组账户为起点，评审快速连续记账体验。仅使用合成数据，记录保存在当前浏览器；尚未接入 NAS 或真实账本。

```sh
npm start
```

需要 Node.js 24+，无需安装依赖。打开 [本地原型](http://127.0.0.1:4180/)。固定地址联网打开或刷新即获取最新入口；旧缓存自动接管，录入中的新版页面在退出表单后切换。无需增加参数、清除数据或重装。手机安装需要受信任 HTTPS，普通局域网 HTTP 无法验证完整 PWA。

已有 HTTPS 配置的 iPhone review：`npm run iphone:start`。复用 `.local/iphone/` 原证书，新入口为 [iPhone HTTPS 原型](https://zhangkaidemac-mini.local:8445/)，与旧 8443/8444 来源隔离。通过 `npm run iphone:status` 查看状态，`npm run iphone:stop` 仅停止新版。详见 [安装与真机 review](docs/p0-iphone-review.md)。

```sh
npm run check
npm test
```

先 review：[0.3 交互修订](docs/interaction-review-v0.3.md)；缓存更新修复见 [0.3.1 固定入口更新](docs/update-delivery-v0.3.1.md)。账户 → 交易记录 → 记一笔；点击描述候选自动带入类目，保存后可连续记账。退款从原支出详情发起；余额调整从具体账户右上角“更多”进入。旅游项目、备注默认折叠，开发者信息默认关闭。

- [产品设计与交互流程](docs/product-design.md)
- [2026-10-28 六项反馈、确认结论与数据核验](docs/product-feedback-2026-10-28.md)
- [MoneyWiz 时间精度与退款关系聚合审计](docs/evidence/2026-10-28-moneywiz-audit/README.md)
- [首版需求](docs/requirements.md)
- [技术设计](docs/technical-design.md)
- [实施计划与当前阶段](docs/implementation-plan.md)
- [P0 评审路线、设计依据与验证边界](docs/p0-review.md)
- [旧技术 demo 归档](archive/README.md)

`public/` 是全新的 ES module PWA 界面、领域计算和 IndexedDB 保存；`server.mjs` 仅提供静态资源；`test/` 验证金额、候选排序、类目与退款等规则。这是 P0 临时实现，正式 TypeScript / React 等工程化按技术设计在 P1 前落实。

新原型默认端口 **4180**、本机库 **fine-ledger-p0-review-v1**，与旧 demo 的来源隔离。原 `data/`、`.local/` 原地保留且不进 Git。导出功能包含全部本机账目、操作意图与草稿；本版没有导入恢复入口。不要将它作为真实账本的唯一副本。
