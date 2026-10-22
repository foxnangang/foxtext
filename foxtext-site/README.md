# FoxText — 官网单页

FoxText 的官网落地页：纯静态 HTML + CSS + JavaScript，**无构建工具、无 npm、无外部 CDN 依赖**，离线双击 `index.html` 即可完整运行。

## 目录结构

```
foxtext-site/
├── index.html               页面结构（语义化 HTML5，文案全部由 data-i18n 驱动）
├── assets/
│   ├── css/
│   │   └── style.css        设计令牌 + 全部样式（含响应式与动效降级）
│   └── js/
│       ├── i18n.js          三语文案字典（zh-CN / en / ja）与语言运行时
│       └── main.js          交互：导航、Tab、复制、回顶、滚动渐显、Toast
└── README.md
```

## 本地预览

方式一：直接双击 `index.html`（`file://` 协议下同样可用，复制按钮带 `execCommand` 降级）。

方式二：起一个静态服务器（推荐，避免个别浏览器对 `file://` 的限制）：

```bash
# Python 3
python -m http.server 5173

# 或 Node.js
npx serve .
```

然后访问 http://localhost:5173 。

## 部署

把整个目录原样上传到任意静态托管即可（Nginx、GitHub Pages、Cloudflare Pages、对象存储静态网站）。
无需任何构建步骤，也无需 Node 运行时。

Nginx 参考：

```nginx
server {
    listen 80;
    server_name foxtext.example.com;
    root /var/www/foxtext-site;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源长缓存
    location ~* \.(css|js|svg|png|jpg|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }
}
```

## 多语言

- 支持 `zh-CN`（默认）/ `en` / `ja`，通过 `assets/js/i18n.js` 中的 `DICT` 维护。
- 首次访问按 `localStorage['foxtext-lang']` → `navigator.languages` → `zh-CN` 的顺序判定。
- 手动切换后写入 `localStorage('foxtext-lang')`，并同步更新 `<html lang>`、`<title>` 与 `meta[name=description]`。
- 切换不刷新页面、不出现 `undefined`：缺失键会依次回退到 `zh-CN`、`en`。

### 新增文案

1. 在 HTML 中给元素加 `data-i18n="your.key"`（属性类文案用 `data-i18n-aria="your.key"`）。
2. 在 `i18n.js` 的 `zh-CN` / `en` / `ja` 三个字典中补齐同名 key。

已有的 `data-i18n` 元素初始文本为空，语言包在脚本加载后立即注入，因此**不要**在 HTML 中硬编码可见文案。

## 设计规范

| 项 | 值 |
| --- | --- |
| 背景层次 | `#0B0C0E` / `#0E1013` / `#111318` |
| 强调色 | `#3DDC97`（单一强调色，克制使用） |
| 正文 | `#EDEEF0`，次级 `#A6ACB8`，弱化 `#6E7684` |
| 边框 | `rgba(255,255,255,.08)` |
| 圆角 | 按钮 10px / 卡片 14px |
| 字号阶梯 | 12 / 14 / 16 / 20 / 28 / 40 / 56 / 64 |
| 区块间距 | ≥ 88px（桌面 120px） |

字体全部使用系统字体栈（`-apple-system` / `Segoe UI` / `Inter` 回退），代码与标签使用等宽栈，不加载任何网络字体。

## 可访问性

- 语义化区块 + `<main>` / `<header>` / `<footer>` / `<nav>`。
- Tab 组件含 `role="tablist"`、`aria-selected`、`aria-controls`，支持方向键 / Home / End 切换。
- 所有图标 `aria-hidden="true"`，纯图标按钮通过 `data-i18n-aria` 提供随语言变化的 `aria-label`。
- `:focus-visible` 可见焦点环；`prefers-reduced-motion` 下关闭位移与滚动动效。
- 顶部提供 skip-link。

## 响应式断点

`1200px` / `1080px` / `1024px` / `900px` / `768px` / `480px`，覆盖 1440 / 1024 / 768 / 375 四档验收宽度；375px 下无横向滚动，导航折叠为抽屉菜单。

## 部署

- 纯静态站点：更新方式为直接覆盖 `index.html` 与 `assets/`，无需构建。
- 部署目标（任意支持 PHP 的 Nginx/Apache 主机即可）：
  - 站点根目录放 `index.html` 与 `assets/`
  - `/download/` 放桌面版安装包（Windows 卡片按版本号指向对应文件）
  - `/stats/` 与 `/api/` 为配套的统计后台与上报端点（PHP + SQLite），**不在本仓库内**——服务器地址、部署凭据等运维信息不随开源仓库分发

```bash
# 示例：覆盖到自己的主机
scp -r index.html assets/ user@your-server:/var/www/text.example.com/
```

### 下载区

Windows 卡片指向服务器上的真实安装包
`/download/FoxText-2.6.0-lite-win-x64.exe`（12.0 MB，免安装，复用系统 WebView2）。
macOS / Linux 尚未出包，按钮置灰并标注「即将推出」。

### 运营数据后台

- 地址：`https://text.foxnan.com/stats/`（凭 token 访问，token 不公开）
- 数据来自桌面端的匿名上报 `POST /api/beat.php`，落在 SQLite（`/data/stats.db`），
  Nginx 已 `deny all` 掉 `/data/`。
- 展示：累计 / 今日 / 近 7 日 / 近 30 日活跃用户、今日新增、启动次数、30 日柱状图、
  平台 / 版本 / 语言分布、最近 25 条记录。

> 注意：`/stats/` 依赖 Nginx 的 `index index.php` 与一条 `location /stats/` 的
> `try_files` 回落；改 vhost 配置时别把这两处删掉，否则会 403。

## 说明

下载区除 Windows 外仍为占位内容，首页的统计数字也是演示数据。
