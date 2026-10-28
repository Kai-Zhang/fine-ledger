# 厘序 · fine-ledger

当前版本 **0.4.1**。按[产品设计 0.8](docs/product-design.md)、[交互线框 v2](docs/wireframe-review-v2.md) 和 [MoneyWiz iOS 实机调研](docs/research-moneywiz-ios-2026-10-29.md) 重写的首版产品前端，采用纸白、松绿和本地线性图标，支持浅色与深色外观。

账户首页、记账、交易详情和报表已经连通本机数据。初版交付见 [0.4.0 评审说明](docs/frontend-review-v0.4.0.md)；0.4.1 修复旧类目图标、压紧交易列表、增加空分组删除、移除示例入口。本轮反馈与待讨论的导航/筛选/报表方案见 [0.4.1 反馈处理](docs/frontend-feedback-v0.4.1.md)。导航重构尚未交付。

## 运行与 iPhone 访问

需要 Node.js 24+。

```sh
npm ci
npm start
```

打开 [本地页面](http://127.0.0.1:4180/)。启动时自动构建；运行中的服务更新源码后，执行 `npm run build` 原位发布。

```sh
npm run iphone:start
npm run iphone:status
```

沿用原证书及固定地址 **[iPhone HTTPS 入口](https://zhangkaidemac-mini.local:8445/)**。端口、路径、主屏幕图标的访问方式保持不变，不需要添加参数、清除数据或重新安装。`.local/iphone/` 的原证书和旧 8443/8444 服务保持原状；`iphone:stop` 只停止 8445。详见[安装说明](docs/p0-iphone-review.md)。

页面在线检查更新，录入中的内容会保护到保存或退出表单后再切换。已完整缓存的版本可离线启动和本地记账。`npm run dev:vite` 提供独立热更新开发环境；该环境不注册离线应用壳。

## 本版能力

- 分组账户、总净值、新增账户与分组、跟手排序、移组和归档。
- 收支、双金额跨币种转账、必填描述及类目、最近/包含匹配候选、多类目拆分、项目和备注。
- 默认入账；点击列表图标切换未入账；交易编辑、退款、独立删除/恢复；账户菜单调整余额。
- 净值曲线、两层分类环图、时间与账户/类目筛选、拆分金额下钻及返回状态保留、保存报表。
- 主币规则、固定账本时区、类目图标与维护、深浅外观、本机完整备份导出。

新用户从空账本创建，正式页面不提供示例账本切换。合成夹具仅用于隔离开发测试。已有旧版浏览器记录会兼容升级并保留升级前原始副本。实际旧 MoneyWiz 全量迁移、银行正式入账成本分配、对账、云端同步与跨设备恢复仍按后续阶段验收。同步页面不会伪装成已经连接服务。

## 工程与验证

```sh
npm run check
npm test
npm run build
```

`src/` 为 React + TypeScript 源码，`domain/` 使用最小单位整数和精确比率，`storage/` 用 Dexie 在同一 IndexedDB 事务中保存账本与变更日志。Vite 生成带内容指纹的完整发布，`server.mjs` 提供静态资源；图标与字体不依赖外部网络。测试覆盖金额、拆分、入账、归档、退款、汇率区间、时间精度/时区、兼容升级、事务回滚及缓存更新。

本机个人库保持 `fine-ledger-p0-review-v1`，开发测试夹具隔离使用 `fine-ledger-example-v1`；JSON 备份包含账本、变更日志及恢复修订。本版还未提供备份回导界面。原 `data/`、`.local/` 和运行证书不进入 Git。

旧的 ES module 评审界面与其测试移至 [0.3 界面归档](archive/p0-review-2026-10-29/README.md)；更早的验证代码见[技术 demo 归档](archive/README.md)。

- [产品设计](docs/product-design.md)
- [首版需求](docs/requirements.md)
- [技术设计](docs/technical-design.md)
- [实施计划](docs/implementation-plan.md)
- [视觉与交互基线](design/frontend-direction.md)
- [分期付款的后续提案](docs/installment-design.md)
