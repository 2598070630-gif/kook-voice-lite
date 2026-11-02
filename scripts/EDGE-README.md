# Edge 语音配置提取 v2

1. 双击 `copy-edge-extractor.cmd`，复制脚本代码。
2. 在 Edge 登录自己的 KOOK 网页版 https://www.kookapp.cn/app/ 。
3. 先刷新 KOOK 页面清除旧版脚本，再按 F12 打开 Console（控制台），粘贴新版代码并回车。右上角应显示「语音配置提取 v2」。若浏览器阻止粘贴，按浏览器显示的验证提示手动操作。
4. 如果已在语音频道内，手动退出语音，再重新加入目标频道。只点击当前频道可能不会发出新请求。脚本自动下载 `kook-voice-频道ID.json`；未自动下载时点击页面右上角的「下载配置」。
5. 用新版 KOOK Voice Lite 的「导入配置」按钮导入该文件，再点击「加入语音」。

## Playwright 自动提取（可复用登录状态）

发行包内置 Playwright 提取脚本、Node 运行时和 playwright-core。在 KOOK Voice Lite 主窗口点击「使用playwright调用」即可启动。主程序会显示进度，提取成功后自动填入三个连接字段并返回连接页，再点击「加入语音」即可；不会自动加入频道。超时或关闭 Edge 会显示具体原因，按钮恢复后可以重试。它直接驱动本机已安装的 Microsoft Edge，不嵌入 Tauri 语音 SDK。

发行包使用本机已安装的 Microsoft Edge，不另行下载 Chromium。开发环境可在项目根目录运行：

```powershell
npm run extract:playwright -- --channel-id 目标频道ID
```


第一次运行会打开 Edge，请在窗口内手动登录 KOOK，并手动进入或重新加入目标语音频道。后续运行会复用程序目录下的：

```text
程序目录\playwright-profile
```

配置和诊断默认写入程序目录下的：

```text
程序目录\captures
```

如果程序目录位于 `C:\Program Files` 等受保护位置，Windows 可能禁止写入；便携包请放在有写入权限的目录，或使用 `--profile` 和 `--output` 指定可写目录。

无需安装扩展、开启远程调试或重启浏览器。Playwright 通过浏览器本身复用专用 profile 的登录状态，只监听本页语音响应，不上传文件，不读取普通 Edge profile，也不主动加入或离开频道。提取完成或三分钟超时后停止监听。

导出文件包含语音凭证，请勿分享，用完可删除。凭证可能过期或与原网页会话绑定；是否可在关闭网页后独立复用，需要真实频道验证。网页字段改版或语音后端没有 WebRTC gateway_url 时无法提取，不保证所有频道均可使用。

重新捕获时再次点击主程序中的「使用playwright调用」，随后在 Edge 中重新加入频道。脚本不自动填写密码，也不替你处理权限提示。

## 提取不成功时

v2 从网页的 `reduxStore.global.userInfo.id` 或本页正常发出的 `/api/v3/user/me` 响应读取用户 ID，不再要求先出现 `g_client`。支持 KOOK 主域和备用域发出的语音响应，以及 `data` 是 JSON 字符串的响应。

- 「没有捕获到语音请求」：请确认先执行脚本，再退出并重新加入频道。
- 「没有 WebRTC 网关字段」或「网关格式不符合要求」：不能直接生成当前轻量客户端的凭证，需要根据实际响应适配；不会把不兼容配置标成成功。
- 「已捕获语音凭证，正在读取当前用户 ID」：当前网页状态布局可能不同。
- HTTP 或 API 错误：先确认原网页能正常加入该频道。

持续失败时点击「下载诊断」，把 `kook-voice-diagnostic.json` 发来。诊断仅含步骤、HTTP/API 状态、响应字段名和是否识别到用户等布尔值，不含 ID、网关地址、Token 值或登录凭证。不要发送实际语音配置 JSON。
