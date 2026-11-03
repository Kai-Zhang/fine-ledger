# 0.12.4 备份操作图标

日期：2026-10-31。发布：`0.12.4-e0025c9d4a4ec9d7`。

按用户的图标优先风格，将备份编辑/完成改为铅笔/勾选，将删除改为垃圾桶，不再显示这些操作的文字标签。保留编辑入口作为非滑动操作方式；普通资料区仍只读。

编辑模式采用透明背景的红色垃圾桶，44×64px 触区，减少连续红色块和横向占位；320px 下日期与类型完整显示，页面无横向溢出。左滑露出时保留 80px 红色操作面，只有垃圾桶图形。页头操作为 44×44px。图标均保留 aria-label，页头保留 title；删除按钮也提供含备份日期的可访问名称和 title。

[交互验证](evidence/2026-10-31-backup-icons/checks.json)覆盖图标删除、撤销、勾选退出与左滑展开。另核对 390/320px 编辑模式和普通模式。类型检查、构建通过；[12 项 HTTPS 资源](evidence/2026-10-31-backup-icons/https-resources.json)通过原 CA 校验并与最终构建一致。仅原位更新前端，无服务重启或账本变更。本轮没有重跑全部业务测试，也没有重新做 iPhone 真机复验。

![编辑模式](evidence/2026-10-31-backup-icons/editing-320.jpg)

[普通模式](evidence/2026-10-31-backup-icons/normal-390.jpg)、[390px 编辑模式](evidence/2026-10-31-backup-icons/editing-390.jpg)、[左滑操作](evidence/2026-10-31-backup-icons/swipe-390.jpg)。
