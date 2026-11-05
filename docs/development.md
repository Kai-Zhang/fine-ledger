# 开发与验证

## 本机开发

使用 Node.js 24.13.0 或更新版本。安装依赖后，`npm start` 构建并启动静态应用，默认地址为 `http://127.0.0.1:4180/`。修改源码后可执行 `npm run build` 更新静态发布。需要热更新时使用 `npm run dev:vite`，该入口不注册离线应用壳。

```sh
npm ci
npm run check
npm test
npm run build
```

- `src/` 是 React 和 TypeScript 前端。金额逻辑在 `src/domain/`，使用最小货币单位和精确比率。
- `src/storage/` 通过 Dexie 管理 IndexedDB，本机账本与变更日志在同一事务中写入。
- `server.mjs` 提供静态页面，`server/` 是可选的 Fastify / SQLite 同步服务。部署与服务验证见[服务部署说明](server-deployment.md)。
- `package.json` 的 `version` 是网页构建与容器工具的版本来源。

## iPhone 与离线验证

- [iPhone 本机评审流程](p0-iphone-review.md)记录了 `npm run iphone:start`、`npm run iphone:status` 和 `npm run iphone:stop` 的使用方式及证书配置。
- [同步服务评审清单](server-validation-8445.md)适用于本机 HTTPS 服务验证。
- [离线启动事件记录](iphone-offline-incident-2026-10-29.md)保留了缓存核对与冷启动验证。Safari 与主屏幕 Web App 使用独立的本机存储，切换环境前可导出完整备份或核对远端账本。

## 示例与迁移

开发和测试可使用 `src/domain/example.ts` 的合成账本。首页截图用当前前端在独立 Chrome 配置中采集，视口为 390 × 844。正式入口从空账本开始，也支持从完整备份恢复。

MoneyWiz 转换工具独立维护，迁移流程和格式见[迁移记录](moneywiz-trial-migration.md)。

## 设计与交付记录

- [实施计划](implementation-plan.md)与[早期阶段记录](implementation-plan-v0.13-history.md)
- [视觉与交互基线](../design/frontend-direction.md)
- [品牌图标](icon-review-v0.7.2.md)与[纸白松绿视觉实施](frontend-review-v0.8.0.md)
- [离线同步与备份](sync-review-v0.12.0.md)、[原币记录与入账](p3-review-v0.13.2.md)、[报表实现](report-review-v0.14.0.md)
- [分期付款提案](installment-design.md)
- [早期实现归档](../archive/README.md)

## 当前维护规则与性能回归

旧设计与已交付代码出现差异时，先查[当前实现规则](current-implementation.md)，尤其是参考汇率优先级、不可变快照、修改历史保留与 PWA 更新握手。新增关系字段需要同时检查本机编辑依赖和增量校验条件。

仓库增加 `.github/workflows/verify.yml`，对 push/PR 执行类型检查、全套测试和构建。性能基准入口为 `node scripts/review/benchmark.mjs`；Chrome 业务及页面切换脚本、隔离合成数据和执行方式见[2026-11-06 验证记录](evidence/2026-11-06-reliability-performance/README.md)。浏览器回归会替换测试源下的 IndexedDB，必须使用独立 Chrome 临时配置和合成静态服务。
