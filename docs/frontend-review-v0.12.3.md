# 0.12.3 备份列表的内容与操作分离

日期：2026-10-31。发布：`0.12.3-11a892ab2499496c`。

上一版将整行做成按钮，省略号只是同一按钮内的图形，导致内容、空白和“更多”都触发滑出删除。左滑删除本身有平台对应模式，但这种点按复用并非此前引用的 Apple 滑动操作文档推荐，应当单独修正。

## 官方依据与设计选择

- [Apple Pull-down buttons](https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons)：此类按钮打开与其目的相关的菜单；只有一两项时，建议考虑更直接的按钮或开关。“更多”会影响操作的可发现性。本页目前只有删除，不需要省略号菜单。
- [Apple EditButton](https://developer.apple.com/documentation/swiftui/editbutton)与 [Introduction to SwiftUI](https://developer.apple.com/videos/play/wwdc2020/10119/?time=1300)：列表可以通过 Edit/Done 切换删除控件；除了滑动删除，也提供明确的编辑入口。

以上支持本轮选择，并不表示 Apple 禁止所有列表行的点按行为。此页没有备份详情导航，故将资料设为只读，不保留会暗示更多行为的箭头、菜单图标或整行按钮。

## 结果

| 入口 | 行为 |
| --- | --- |
| 普通模式点按日期、类型或空白 | 不展开删除，不改变数据 |
| 左滑条目 | 只露出该条的删除按钮，不直接删除 |
| 页头“编辑” | 明确进入编辑状态，显示各条删除按钮 |
| 页头“完成” | 收起删除控件，恢复只读资料 |
| 点按红色“删除” | 删除该份备份并提供撤销 |

内容区由 button 改为 div，不进入键盘按钮序列。编辑入口和删除按钮可使用键盘；内容没有因操作控件而被整体平移，320px 编辑模式下日期/时间可换行，保留完整资料。空列表不提供无效果的编辑按钮。保留 0.12.2 的后台局部更新、边缘返回/前进、删除撤销与 24 小时清理策略。

## 验证

[9 项浏览器交互检查](evidence/2026-10-31-backup-editing/interaction-checks.json)全部通过：内容与空白点按不展开、编辑显示删除、编辑中点按内容不改变模式、完成收起、左滑只展开一条、点按已展开条目收起、键盘删除与撤销，以及 320px 无页面横向溢出。资料行实际为无按钮角色、tabIndex=-1 的 div。

[类型检查](evidence/2026-10-31-backup-editing/checks.log)、[构建](evidence/2026-10-31-backup-editing/build.log)通过；[107 项现有回归测试](evidence/2026-10-31-backup-editing/tests.log)通过。本次没有为呈现标签添加重复实现的单元测试。浏览器验证使用隔离模拟账本，尚未重新进行 iPhone 真机复验。

前端原位更新至 8445，未重启服务或修改备份接口。[12 项 HTTPS 资源](evidence/2026-10-31-backup-editing/https-resources.json)通过原 CA/域名校验，逐字节匹配本次构建。

![普通模式](evidence/2026-10-31-backup-editing/normal-390.jpg)

[编辑模式](evidence/2026-10-31-backup-editing/editing-390.jpg)、[320px 编辑模式](evidence/2026-10-31-backup-editing/editing-320.jpg)、[左滑单行](evidence/2026-10-31-backup-editing/swipe-390.jpg)。
