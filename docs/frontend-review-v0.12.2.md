# 0.12.2 同步局部更新与备份行操作

日期：2026-10-31。最终发布：`0.12.2-bae2764d0bb8f195`。

## 同步与页面返回

保留 React 的局部 DOM 更新。已验证的连接、设置、设备及备份清单在内存中保存快照；返回页面或手动刷新时先显示已有内容，再后台读取。首次没有快照时仍显示加载提示，网络失败保留内容并明确显示连接状态。401 和主动断开会清除快照，缓存不代替 Cookie 授权。

边缘手势的底层预览只读快照，不发起连接请求、不修改同步开关、不触发同步。去掉页面刷新对强制同步的重复调用；稳定编辑状态回调，只在真正结束编辑时请求续传，避免渲染清理回调反复触发同步。登录成功仍主动请求同步。

缓存设置与编辑表单使用独立副本。慢速后台读取返回时，如果已经开始输入，就保留未保存内容与原始修订条件。后台校验只更新对应的状态文字，不将已有分组换成整页加载提示。

## 备份条目

- 左滑露出 80px 红色删除动作；滑动只展开，完整滑动也不会直接删除。
- 点按条目或使用键盘 Enter 同样可展开；Escape、点按外部、纵向滚动或右滑可收起。一次展开一条。
- 页面左右 24px 边缘继续保留原返回/前进手势；条目拖动从内部开始，纵向动作交还页面滚动。
- 点击删除后移除该条，显示 10 秒“撤销”。服务端保留文件 24 小时，随后清理；并非额外新增回收站页面。操作均验证会话、Origin 和 CSRF，且不会修改当前账本。

交互参考 [Apple 列表滑动操作](https://developer.apple.com/documentation/SwiftUI/View/swipeActions%28edge%3AallowsFullSwipe%3Acontent%3A%29)：尾侧提供删除动作，破坏性操作使用明确语义。关闭全滑直接执行、提供点按入口及撤销，是本应用的具体选择；Web 实现没有引入 jQuery 或原生 SwiftUI 依赖。

## 验证

- [最终稳定性记录](evidence/2026-10-31-sync-interactions/final-stability.json)：237 个采样动画帧，4 轮同步状态切换，概览空白帧 0，当前概览分组节点替换 0，预览期间请求 0。包含 3 次主动同步、后台校验、输入保留及边缘返回。测试将会话和设置等 GET 人为延迟 350ms，放大冷加载与返回时的空白风险。
- [双向边缘记录](evidence/2026-10-31-sync-interactions/sync-and-edge-navigation.json)：334 个采样动画帧，备份页返回、前进再返回；概览空白帧 0、节点替换 0、预览请求 0。[较长记录](evidence/2026-10-31-sync-interactions/background-and-refresh.json)另外覆盖定时同步和页头刷新，3197 个采样帧中仍未发现概览空白。
- 浏览器真实指针拖动验证左滑展开、纵向拖动不展开、右侧行操作与页面边缘导航分开。键盘 Enter、Escape、点按外部收起和单条展开通过。320px 时页面宽度仍为 320，删除按钮为 80×64；390px 和深色另有截图。
- 实际删除一份隔离服务备份后，条目消失，点击撤销恢复。手动创建新备份、两条备份操作互斥通过。慢速设置页输入在响应返回后仍为用户输入值，[截图](evidence/2026-10-31-sync-interactions/draft-preserved.jpg)。
- [107 项回归测试](evidence/2026-10-31-sync-interactions/tests.log)全部通过。新增覆盖删除/撤销鉴权、CSRF、ID 校验、重试、文件字节保留、账本不变、重启后撤销、到期清理、备份操作并发串行、缓存副本隔离和手势方向判定。[类型检查](evidence/2026-10-31-sync-interactions/checks.log)、[构建](evidence/2026-10-31-sync-interactions/build.log)通过。
- 原 8445 服务短暂重启以加载新接口，沿用原 P0 证书和数据目录，账本 ID、5 个账户与 29 笔交易保留。[部署记录](evidence/2026-10-31-sync-interactions/deployment.json)；[12 项 HTTPS 页面与资源](evidence/2026-10-31-sync-interactions/https-resources.json)通过 CA/域名校验且与最终构建逐字节一致。

交互测试在本机隔离模拟账本完成。浏览器帧采样能检测加载分支清空内容和节点替换，不能证明 iPhone 合成器从无闪动；本轮没有重新操作 iPhone，也没有修改 NAS 或路由器。

![左滑展开删除](evidence/2026-10-31-sync-interactions/backup-swipe-390.jpg)

[320px](evidence/2026-10-31-sync-interactions/backup-swipe-320.jpg)、[深色](evidence/2026-10-31-sync-interactions/backup-swipe-dark.jpg)、[撤销后](evidence/2026-10-31-sync-interactions/backup-restored.jpg)、[概览](evidence/2026-10-31-sync-interactions/overview.jpg)。
