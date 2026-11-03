# KOOK Voice Lite

面向 Windows x64 的轻量语音客户端原型，使用 Tauri 2、系统 WebView2 和 KOOK 官方 `@kookapp/voice-web-sdk`。本项目为第三方实验项目，与 KOOK 官方无隶属关系。

## 下载和运行

在本仓库 **Releases** 页面下载 `kook-voice-lite-portable-win64.zip`，解压到有写入权限的目录，运行 `kook_voice_lite.exe`。也可下载 `KOOK-Voice-Lite-portable.exe`，它是只负责解压的 7-Zip 自解压便携包。

GitHub 自动生成的 **Source code** 压缩包是源码，不是可直接运行的发行包。

- 保持 `kook_voice_lite.exe`、`WebView2Loader.dll`、`README.txt` 和 `resources/` 目录在一起。
- 运行不需要自行安装 Rust、MinGW、Node.js 或开发服务器；便携包已带 Node 和 Playwright Core，使用本机 Microsoft Edge。
- 需要已安装 WebView2 Evergreen Runtime；程序不自动安装它，也不捆绑固定版 Runtime。GPU 加速保持开启。
- 不创建安装登记、卸载项、开机启动或开始菜单快捷方式。删除解压目录即可移除程序文件。

## 功能和使用

1. 点击「使用playwright调用」，在打开的 Edge 中登录自己的 KOOK 账号，手动进入或重新加入目标语音频道。
2. 提取成功后，程序自动填入频道 ID、用户 ID 和语音凭证，再点击「加入语音」。也支持手动填写字段或导入配置 JSON。
3. 加入成功后窗口隐藏到系统托盘；关闭窗口也会隐藏。语音传输和 WASAPI 音频在原生辅助进程中运行，托盘时释放 WebView，显示窗口时再重建。
4. 托盘菜单只保留显示窗口、语音连接、麦克风静音、耳机静音、断开语音和退出；音频设备、连接日志和 Playwright 提取在主窗口中打开。窗口尺寸和最大化状态在隐藏或退出时保存。

也可以使用 `scripts/copy-edge-extractor.cmd`，在自己已登录的 KOOK 网页控制台中运行提取脚本并导出配置。步骤、参数和失败排查见 [Edge 提取说明](scripts/EDGE-README.md)。

运行时会在程序目录产生：

| 路径 | 内容 |
| --- | --- |
| `playwright-profile/` | 专用 Edge 登录状态 |
| `captures/` | 语音配置、提取进度、诊断和日志 |
| `window-state.json` | 窗口状态 |

这些文件不属于源码或发行包。导出的配置包含语音凭证，请勿公开上传或分享。脚本不读取普通 Edge profile，不主动加入或离开频道，不上传导出文件。

## 源码与发行包

源码仓库仅保存前端和 Rust 源码、图标、配置、npm/Cargo 锁文件、提取脚本及构建文档。不保存 `node_modules/`、`dist/`、`src-tauri/target/`、`build-deps/`、本地验证资料、备份、浏览器 profile、捕获配置或二进制成品。

Windows 发行包放在 GitHub Releases，包含运行所需的 exe、DLL、Node、Playwright Core 和第三方许可文件。Rust/MinGW 构建工具链不随发行包提供。

## 从源码构建

### 标准 Windows 环境

需要 Windows x64、Node.js 22.12+（或满足 Vite 7 要求的新版本）、Rust stable、Visual Studio C++ Build Tools（含 Windows SDK）以及 WebView2 Runtime。

在克隆后的项目根目录运行：

```powershell
npm ci
.\scripts\prepare-runtime.ps1
npm run tauri -- build --no-bundle --features custom-protocol
```

`prepare-runtime.ps1` 将当前 Windows x64 Node 和锁定的 Playwright Core 复制到 `src-tauri/resources/`，并下载该 Node 版本的许可文件。生成的二进制和依赖目录受 `.gitignore` 排除。Rust 依赖使用已提交的 `src-tauri/Cargo.lock`。

整理为便携目录后打包：

```powershell
New-Item -ItemType Directory -Force portable | Out-Null
Copy-Item src-tauri\target\release\kook_voice_lite.exe portable\
Copy-Item src-tauri\target\release\WebView2Loader.dll portable\
Copy-Item src-tauri\resources portable\resources -Recurse -Force
Copy-Item docs\PORTABLE-README.txt portable\README.txt
.\package-portable.ps1
```

打包需要 7-Zip。默认从 PATH 或 Program Files 查找，也可以指定路径：

```powershell
.\package-portable.ps1 -SevenZip 'C:\Program Files\7-Zip\7z.exe'
```

脚本仅打包指定的运行文件，不打包整个 `portable/` 目录，因此不会带入浏览器登录状态、导出凭证或窗口配置。输出到 `releases/`，同时检查 ZIP 和自解压包完整性。

### 已有本地 GNU 工具链

如果本地已经准备了 `build-deps/`（含 `rust/`、`mingw/` 和 `cargo/`），可以运行 `npm ci` 后执行 `./build-portable.ps1`。请把项目放在全英文路径中；本地 GNU 链接器无法处理中文路径。该脚本使用本地离线 Rust 工具链构建，并生成 `portable/`；运行时准备步骤需要联网下载 Node 许可文件。工具链目录不上传源码仓库，也不在首次发布中提供。

### 前端开发和独立提取

```powershell
npm ci
npm run dev
npm run build
npm run extract:playwright -- --channel-id <频道ID>
```

开发页面使用 localhost；生产 exe 内嵌前端，不需要本地 HTTP 服务。独立提取使用本机 Edge，需要手动登录和加入频道。

## 验证范围和限制

- 本地已进行前端构建、Rust 发布编译、程序启动及托盘交互验证。历史模拟提取测试覆盖成功、超时、浏览器关闭和启动失败等场景；测试文件已从本次源码发布中移除。
- 真实频道中的凭证独立复用、语音收发、设备切换和 CPU/内存对比尚未完成验证，首次发布标记为预发布。
- 提取逻辑依赖 KOOK 网页当前的响应字段与 WebRTC gateway；网页改版、凭证过期或不同语音后端可能导致无法连接。
- 未实现聊天、屏幕分享、AI 降噪、自启动和自动更新。隐藏窗口不代表 WebView2 或 WebRTC 内存被释放。

## 第三方组件

项目依赖 KOOK Voice Web SDK、Tauri、Node.js、Playwright Core 及其依赖。各组件许可保留在对应依赖或发行包的 `resources/licenses/` 和 `resources/node_modules/playwright-core/` 中。
