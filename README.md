# 厘序 · fine-ledger

第一版 P0 产品交互原型。以账户为起点，评审快速连续记账体验。仅使用合成数据，记录保存在当前浏览器；尚未接入 NAS 或真实账本。

```sh
npm start
```

需要 Node.js 24+，无需安装依赖。打开 [本地原型](http://127.0.0.1:4180/)。修改代码后需关闭该来源的所有页面再重新打开，让新离线缓存接管；录入中不会强制刷新。手机安装需要受信任 HTTPS，普通局域网 HTTP 无法验证完整 PWA。

```sh
npm run check
npm test
```

先 review：账户 → 交易记录 → 记一笔；点击描述候选自动带入类目，保存后可连续记账。退款从原支出详情发起；余额调整从具体账户右上角“更多”进入。旅游项目、备注默认折叠，开发者信息默认关闭。

- [首版需求](docs/requirements.md)
- [技术设计](docs/technical-design.md)
- [实施计划与当前阶段](docs/implementation-plan.md)
- [P0 评审路线、设计依据与验证边界](docs/p0-review.md)
- [旧技术 demo 归档](archive/README.md)

`public/` 是全新的 ES module PWA 界面、领域计算和 IndexedDB 保存；`server.mjs` 仅提供静态资源；`test/` 验证金额、候选排序、类目与退款等规则。这是 P0 临时实现，正式 TypeScript / React 等工程化按技术设计在 P1 前落实。

新原型默认端口 **4180**、本机库 **fine-ledger-p0-review-v1**，与旧 demo 的来源隔离。原 `data/`、`.local/` 原地保留且不进 Git。导出功能包含全部本机账目、操作意图与草稿；本版没有导入恢复入口。不要将它作为真实账本的唯一副本。
