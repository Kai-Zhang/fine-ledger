# 0.8.0 纸白松绿视觉统一

日期：2026-10-30。范围依据：用户选定纸白松绿，要求统一图标、页面、字体、间距、按钮和深色模式，并保持现有交互、信息密度和固定访问方式。

## 交付

全局采用纸白背景、松绿操作与独立的收支语义色，深色使用暗绿灰分层表面。保留“账簿＋硬币”安装图标，用同一品牌标识连接侧栏、设置、建账与启动界面；Lucide 图标统一 1.75 线宽。原安装图标源图已符合本方案，无需更换安装入口或重新添加主屏幕图标。

本地系统字体；页面标题 24/32，列表名称与金额 16/22，类目和时间至少 12/16，净值 32/40，录入金额 36/44。手机边距 16，面板/主按钮圆角 12，输入 10，主按钮至少 48 高，页头操作 44 触区。日期分隔和组头紧凑排列，操作图标保留含义与位置。SVG 图表标签补偿缩放后的字号。

新建账本使用协调的类目预设颜色。已有类别的颜色与图标保留，编辑器仍能选择原颜色；深色只改变呈现亮度，不回写历史数据。支出/负值用陶红，收入/退款用正向绿，转账金额用中性色并保留方向符号。

实现入口：[视觉基线](../design/frontend-direction.md)、[主题样式](../src/ui/pine-theme.css)。原始三套方案仍见[比较文档](../design/visual-system-proposals.md)。

## 验证

- `npm run check` 通过；`npm test` 43/43；`npm run build` 通过。构建沿用已有 Lucide `use client` 提示，无新增失败。
- 同一浏览器账本、同一账户、390×844：此前行高 49、描述 13；本版行高 50、描述 16、元信息 12；调整前后均完整显示 10 笔。账户行从 63 调整为 60。[调整前](evidence/frontend-v0.8.0/density-before.json)、[调整后](evidence/frontend-v0.8.0/density-after.json)。
- 检查账户、管理、记账拆分、交易详情、设置、报表目录、净值曲线和双层支出环图；账户、记账和分类报表覆盖浅深色。验证表单返回仍弹一次确认，放弃测试输入后原账本不增加交易。
- 320px 下账户、流水、拆分类目及日期时间无横向溢出；1280×900 桌面继续使用侧栏和 940 内容区。390×844 的明暗首页、记账和报表截图见下。
- 从页面实际计算样式提取变量，检查正文、次要文字、动作、收支、提示色相对页面/面板，以及按钮前景，共 30 组，最低 5.20:1。[颜色记录](evidence/frontend-v0.8.0/theme-tokens.json)、[对比度](evidence/frontend-v0.8.0/contrast.json)。图表和任意历史自定义颜色不属于这 30 组文字检查。
- 外观可选浅色、深色、跟随系统；切换后 `theme-color` 随页面底色更新，系统模式在应用打开期间监听系统变化。验证完成后浏览器恢复原来的“跟随系统”和默认窗口尺寸。

本轮为桌面浏览器及移动视口检查，没有连接 iPhone；原生键盘、系统状态栏和长时间离线运行的真机验证不能由这些截图代替。导航、手势、拖拽、分配金额、时区和存储机制未重构，原有回归测试仍覆盖其逻辑。

## 发布

沿用 **https://zhangkaidemac-mini.local:8445/**、原证书、应用身份、路径和无参数访问方式。原位发布完整资源包，保留原有录入保护与离线更新机制，不清数据。完整版本及对原入口的资源字节核对见 [HTTPS 验证](evidence/frontend-v0.8.0/https-verification.json)；证书校验通过，12 项资源与本地发布完全一致。

本轮不调整阶段范围，不提前加入备份回导或云端同步。

## 实际页面

| 页面 | 浅色 | 深色 |
| --- | --- | --- |
| 账户 | [截图](evidence/frontend-v0.8.0/accounts-light.png) | [截图](evidence/frontend-v0.8.0/accounts-dark.png) |
| 记账拆分 | [截图](evidence/frontend-v0.8.0/entry-light.png) | [截图](evidence/frontend-v0.8.0/entry-dark.png) |
| 分类报表 | [截图](evidence/frontend-v0.8.0/expense-light.png) | [截图](evidence/frontend-v0.8.0/expense-dark.png) |

[紧凑流水](evidence/frontend-v0.8.0/transactions-light.png)、[交易详情](evidence/frontend-v0.8.0/detail-light.png)、[桌面深色](evidence/frontend-v0.8.0/accounts-desktop-dark.png)。图中的交易均为原本的隔离开发账本内容。
