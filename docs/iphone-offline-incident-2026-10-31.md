# 2026-10-31 新建主屏幕 App 无法启动

## 已确认结果

用户在蜂窝/5G 网络下从 Safari 重新添加本地评审服务到主屏幕，图标为灰底“厘”，打开白屏。切回与 Mac 连通的家庭 Wi-Fi 后，用户确认现有主屏幕 App 正常，无需删除图标、清空数据或修改代码。

本次 8445 服务没有互联网入口。此网络条件下，手机无法访问家庭 Mac 的内网服务；Safari 原有缓存仍能显示页面，不能作为服务在线证据。实际主屏幕 App 检查器读取到的是系统错误页：

```json
{"url":"data:text/html,","title":"无法打开页面","text":"Safari浏览器打不开该页面，因为无法连接服务器。","standalone":true,"ready":"complete","resources":[]}
```

Safari 的 `/api/v1/meta` 当时显示 `Offline resource unavailable`，由同源 Service Worker 的网络失败分支生成，并非 API 的正常响应。正常应返回含 `fine-ledger-sync-v1` 的 JSON。

## 只读核验

- Mac 服务始终监听 `192.168.0.241:8445`。页面、Worker、manifest、启动资源与图标共 12 个响应均为 200，逐字节匹配发布 `0.9.0-53ab72bcbdbb0d31` 的文件。
- 从路由器经只读 SSH 发起请求，域名（固定解析到 Mac IPv4）及直接 IP 的 `/api/v1/meta` 均通过原 CA 验证，TLS 1.3，返回 200。CA 通过标准输入提供，未写路由器文件。
- 当前证书 SAN 含 `DNS:zhangkaidemac-mini.local`、`DNS:localhost`、`IP Address:192.168.0.241`、`IP Address:127.0.0.1`，直接 IP 的证书匹配成功。
- 没有修改证书信任、路由器/NAS 配置或重启服务，也未清理手机数据。

## 剩余边界

用户报告切回 Wi-Fi 后主屏幕 App 正常，但 IP 地址访问仍白屏；尚未取得该次 IP 请求的手机端失败原因，不能将它解释为证书缺少 IP。当前正式评审入口仍为域名，服务配置的公开来源也为该域名；直接 IP 是不同来源，不能据元信息 GET 成功推定其登录写入流程受支持。

灰底图标与安装时网络不可达相符，但尚未确认切回 Wi-Fi 后图标是否恢复。此次不是对新安装离线首次启动、互联网访问或全部 iPhone 生命周期的验收。先联网完成启动资源准备，再执行既定离线冷启动检查。

技术明细保存在 Git 排除的 `.local/diagnostics/iphone-white-screen-2026-10-31/`。
