# FoxText

**本地优先的 Markdown 编辑器。** 渲染层手写（无 marked / markdown-it / highlight.js / CDN / 网络字体），一份代码跑在三种宿主上。

> 官网与下载：**https://text.foxnan.com**

| 形态 | 体积 | 原理 |
| :--- | :--- | :--- |
| **FoxText Lite**（推荐） | **12 MB**，单文件 exe 免安装 | Python + pywebview 复用系统 WebView2 |
| 浏览器 | 0 | 直接打开 `index.html` |
| Electron 桌面版 | ~300 MB | 自带 Chromium，原生菜单 + 文件对话框 |

## 特性

- **零依赖渲染层**：原生 HTML/CSS/JS，断网完全可用；CSP `connect-src 'none'`，页面发不出任何请求
- **自研 Markdown 引擎**（`assets/js/markdown.js`）：解析 + TOC + 大纲，100K 字符 13.6ms，净化三段式（转义 → 白名单 → 兜底）
- **三语**（简体中文 / English / 日本語）与亮暗主题，偏好本地持久化
- **应用内菜单条**：浏览器与 Lite 共用，Electron 用原生菜单（同一份命令模型）
- **匿名统计可选**：默认开启、可一键关闭，只上报随机 UUID / 版本 / 平台 / 语言，由宿主进程发起（渲染层发不出请求）
- **Windows 兼容预检**：版本门槛（Win10 1809+）、WebView2 三重探测、缺失时引导安装、Per-Monitor V2 DPI 感知

## 目录结构

```
foxtext-app/    # 渲染层（index.html + assets/，三种宿主共用，禁止 fork）+ Electron 壳
foxtext-lite/   # Lite 宿主（app.py）+ PyInstaller spec + 渲染层副本
foxtext-site/   # 官网（纯静态，含部署说明）
```

## 构建

**浏览器 / Electron**

```bash
cd foxtext-app
npm install
npm start          # Electron 窗口
# 或直接双击 index.html（file:// 下即完整功能）
```

**FoxText Lite**（Windows 10 1809+ / Windows 11，需 WebView2 Runtime）

```bash
cd foxtext-lite
python -m venv .venv && .venv/Scripts/pip install pywebview pythonnet pyinstaller
.venv/Scripts/python -m PyInstaller FoxTextLite.spec --noconfirm --clean
# 产物：dist/FoxTextLite.exe
```

> 注意 `FoxTextLite.spec` 内的 excludes 与注释：`libssl/libcrypto` 绝不能排除（https 匿名上报依赖），改完打包务必做行为验证（启动后确认服务端收到心跳），不要只看文件是否在包里。

**官网**

纯静态，见 `foxtext-site/README.md`。

## 许可证

[MIT](LICENSE)
