# FoxText Lite — 轻量版 Windows 桌面端

和 `foxtext-app`（Electron 便携版，约 300 MB）功能完全一致，但体积只有 12 MB。

## 它是怎么做到小的

| 版本 | 体积 | 原理 |
| :--- | :--- | :--- |
| Electron 便携版 | ~300 MB | 软件自带一整份 Chromium |
| **FoxText Lite** | 12 MB（2.6.0 实测）| 复用系统已装的 **WebView2**（Windows 10/11 自带） + Python 运行时 |

渲染层是同一份 `index.html` + `assets/`，Lite 只是换了一个宿主窗口，编辑器本身一行没改。

## 目录结构

```
foxtext-lite/
  app.py              Python 宿主：本地 HTTP 服务 + WebView2 窗口 + 文件对话框桥接
  app/                渲染层副本（打包时用 --add-data 塞进 exe，运行时不会直接改这里）
    index.html
    assets/
  build.spec / dist/  PyInstaller 产物
  FoxTextLite.spec    PyInstaller 配置
```

## 为什么用本地 HTTP 而不是 file://

Chromium 把 `file://` 当作不可信的 opaque origin，**localStorage 会失效**。
草稿自动保存、界面语言、主题偏好全都存在 localStorage，所以这里起一个
只监听 `127.0.0.1` 的随机端口静态服务，再把 `http://127.0.0.1:<port>/index.html`
交给 WebView2。首页在返回时动态插入一段桥接脚本，把 `window.pywebview.api`
映射成渲染层认识的 `window.foxtext`，**渲染层源码因此保持单一来源，无需分叉**。

## 原生能力对照

| 能力 | Electron 版 | Lite 版 |
| :--- | :--- | :--- |
| 打开 / 保存 / 另存为（系统对话框） | ✅ | ✅ |
| 未保存提示 | ✅ | ✅（浏览器层 beforeunload） |
| Ctrl+N / O / S / Shift+S | ✅（原生菜单 accelerator） | ✅（窗口加载后注入的快捷键） |
| Ctrl+B / I / K 格式化 | ✅ | ✅（渲染层自带） |
| 原生菜单栏 | ✅ | ➖ 改为**应用内菜单条**（见下） |
| 关于窗口 | ✅ | ✅（应用内自定义对话框） |
| 导出 HTML / 纯文本 / Markdown | ✅ | ✅（Blob 下载，存到下载目录） |
| 匿名使用统计上报 | ✅（Electron 主进程） | ✅（`FoxTextApi.beat`，后台线程发送） |

## 应用内菜单条

WebView2 窗口没有原生菜单栏，所以 Lite 由**渲染层自己画一条菜单条**（34px，融进深色/浅色
双主题）。它只在 Lite 里出现：

| 宿主 | `window.__foxtextHost` | 菜单条 |
| :--- | :--- | :--- |
| FoxText Lite | `'lite'`（`<head>` 里的桥接脚本同步写入） | ✅ 显示 |
| Electron | `'electron'`（preload 通过 contextBridge 注入） | ❌ 已有原生菜单，不重复 |
| 浏览器直接打开 | `undefined` | ❌ 不需要 |

菜单项与 Electron 原生菜单一一对应：

- **文件**：新建 `Ctrl+N` / 打开 `Ctrl+O` / 保存 `Ctrl+S` / 另存为 `Ctrl+Shift+S` / 导出 HTML / 退出
- **编辑**：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选（`execCommand`，与编辑器的 undo 栈一致）
- **视图**：切换主题 / 显示·隐藏大纲 / ~~实际大小、放大、缩小~~（**禁用**：Lite 没有缩放 API）
- **帮助**：关于 FoxText（自定义对话框，不是 `alert()`）

键盘可达：菜单按钮能 Tab 到、Enter/Space 展开、`Esc` 关闭并把焦点还给触发按钮。
切换界面语言时菜单文案实时跟着变。

> **为什么缩放是禁用的**：Electron 用 `webContents.setZoomFactor()` 实现缩放，
> pywebview / WebView2 没有暴露等价接口。与其点了没反应，不如明确置灰并在 tooltip 里说明。

## 启动自检（preflight）

`main()` 里在创建窗口**之前**会跑一遍 `preflight()`，避免「下载下来双击是白屏」：

1. **高 DPI**：`SetProcessDpiAwarenessContext(-4)`（Per-Monitor V2）→ 失败回退
   `shcore.SetProcessDpiAwareness(2)` → 再失败回退 `SetProcessDPIAware()` → 都没有就静默跳过。
2. **Windows 版本**：低于 Windows 10 1809（build 17763）→ 弹原生 Win32 提示框并优雅退出
   （退出码 0，不抛 traceback）。Win7 / 8 / 8.1 明确拒绝，因为 WebView2 根本不存在。
3. **WebView2 Runtime**：三重探测，任一命中即放行
   - 注册表 `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…}`（64 位视图）
   - 注册表 `HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-…}`（32 位视图，`KEY_WOW64_32KEY`）
   - 目录探测 `%ProgramFiles(x86)%` / `%ProgramFiles%` / `%LOCALAPPDATA%` 下的
     `Microsoft\EdgeWebView\Application\msedgewebview2.exe`
4. **缺失时的引导**：`ctypes.windll.user32.MessageBoxW` 弹中文提示（不引入 tkinter），
   点「是」用 `webbrowser.open()` 打开微软 Evergreen Bootstrapper（约 1.8 MB 在线安装器）。
5. **兜底**：`import webview` / `create_window` / `webview.start` 任一抛异常，都会弹可读的
   错误框，而不是白屏或静默退出。

所有探测都包在 `try/except` 里 —— **任何异常都不会阻塞启动**。

## 桥接的时序问题（重要）

pywebview 的 `window.pywebview.api` 是在 **DOMContentLoaded 之后**才挂上的，
比 Electron 的 preload 晚。因此注入脚本在把 `pywebview.api` 映射成
`window.foxtext` 之后，会额外派发一个 `foxtext:ready` 事件；渲染层监听它，
用于「启动时就要用桥接」的逻辑（目前是匿名统计上报）。以后加任何开机即用的
桥接能力，都要走这个事件，不能假定 `window.foxtext` 在 `boot()` 时已存在。

## 自己打包

```powershell
& "C:\Users\Foxgang\.workbuddy\binaries\python\envs\default\Scripts\python.exe" -m PyInstaller `
   FoxTextLite.spec --noconfirm --clean
```

产物在 `dist/FoxTextLite.exe`，单文件、免安装、双击即用。

## 运行要求

- **Windows 10 1809（build 17763）或更高 / Windows 11**（Win7 / 8 / 8.1 会被启动自检拦下）
- **Microsoft Edge WebView2 Runtime**（Win10 1809+ 与 Win11 一般自带；
  精简版 / LTSC 可能没有，启动时会弹框引导去微软官网装 Evergreen Runtime，约 1.8 MB 在线安装器）

> 注意：Lite 版依赖 WebView2 渲染，若你机器上有非标准的安全策略或组策略禁用 WebView2，
> 请改用 Electron 版或直接用浏览器打开 `index.html`。
