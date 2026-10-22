# FoxText

**A local-first Markdown editor.** The renderer is hand-written — no `marked`,
no `markdown-it`, no `highlight.js`, no CDN, no web fonts. Nothing leaves your
device.

Two ways to run the exact same codebase:

| Mode | How | Notes |
| :--- | :--- | :--- |
| **Browser** | Double-click `index.html` | Works straight from `file://`, zero install |
| **Desktop** | `npm install && npm start` | Electron window + native file dialogs |

---

## 1. File structure

```
foxtext-app/
├── index.html              # app shell (inline SVG icon sprite, CSP)
├── assets/
│   ├── css/app.css         # design tokens (dark + light), layout, typography
│   └── js/
│       ├── markdown.js     # the Markdown engine (FoxMarkdown, UMD-ish)
│       ├── i18n.js         # zh-CN / en / ja dictionaries
│       └── app.js          # UI controller
├── electron/
│   ├── main.js             # window, native menu, IPC file dialogs
│   └── preload.js          # contextBridge: exactly 4 methods
├── package.json            # only devDependency: electron
└── README.md
```

No build step. No bundler. No runtime dependencies.

---

## 2. The engine (`assets/js/markdown.js`)

```js
FoxMarkdown.parse(src, opts) // -> html string   (opts.sanitize defaults to true)
FoxMarkdown.toc(src)         // -> [{ level, text, id }]
FoxMarkdown.outline(src)     // -> [{ level, text, id, line }]  (extension used by the editor)
```

It also exports under CommonJS, so it can be unit-tested in plain Node:

```bash
node -e "console.log(require('./assets/js/markdown.js').parse('# hi'))"
```

### Supported

| # | Syntax | Notes |
| :- | :--- | :--- |
| 1 | ATX headings `#`…`######` | `<h1 id="slug">`; slug = lowercase, punctuation stripped, spaces → `-`, CJK kept; duplicates get `-1`, `-2` |
| 2 | Paragraphs | soft line break → space; two trailing spaces or a trailing `\` → `<br>` |
| 3 | `**bold**` `*italic*` `***both***` `~~strike~~` | `_` / `__` / `___` forms too; intra-word `_` is not emphasis (snake_case safe) |
| 4 | `` `inline code` `` | content escaped, never parsed |
| 5 | Fenced code ` ``` ` / `~~~` | info string → `class="language-xxx"`, HTML escaped, unclosed fence closes at EOF |
| 6 | `>` quotes, `>>` nested | may contain any block content (lists, headings, code) |
| 7 | Lists `-` `*` `+` `1.` `1)` | nested by 2 or 4 space indent; `- [ ]` / `- [x]` task lists with disabled checkboxes |
| 8 | GFM tables | `:---`, `:---:`, `---:` alignments; `\|` escapes a pipe; ragged rows are padded |
| 9 | Thematic break `---` `***` `___` | a `---` line under text becomes an `<hr>` |
| 10 | Links `[t](u "title")`, `<https://x>`, bare `https://…` | trailing punctuation trimmed from bare URLs |
| 11 | Images `![alt](src "title")` | `javascript:` / `data:text/html` sources are **dropped** (alt text only) |
| 12 | Backslash escapes | `\*`, `` \` ``, `\_`, `\[`, … |
| 13 | Inline HTML | a tiny allow-list (`b i em strong code del ins mark kbd sub sup u s small span abbr br`), **all attributes dropped**; every other tag is escaped and shown as text |
| 14 | Sanitising | `sanitize: true` (default) strips `<script> <style> <iframe> <object> <embed> <link> <meta> <base> <form> <svg> <math> <template>`, all `on*=` attributes, and `javascript:` / `data:text/html` URLs |

### Not supported (deliberate)

- **setext headings** (`Title` + `====`) — a `---` underline is a rule instead
- **indented 4-space code blocks** — indentation belongs to lists instead
- reference-style links (`[x][ref]`), footnotes, raw HTML blocks, tables of
  contents generation from the engine (the editor builds it from `toc()`)
- syntax highlighting (a product decision: tiny, offline, fast)

### Performance

Single-pass block parse with `Array#join` accumulation (no repeated string
concatenation). Measured on this machine: **79 KB document → ~24 ms** in Node,
comfortably inside the 150 ms budget for 100 KB.

---

## 3. Editor features

- **Three view modes** — Write / Split / Read, remembered in `localStorage`.
- **Draggable splitter** (6 px, accent on hover), ratio clamped to 20 %–80 % and
  remembered; double-click resets to 50 %.
- **Line-number gutter** synced to the editor scroll, plus a current-line
  highlight (no wrapping, so line geometry is exact).
- **Tab / Shift+Tab** indent / outdent (multi-line selections too); Tab never
  leaves the editor.
- **Live preview** with a 120 ms debounce and proportional two-way scroll sync.
- **Outline panel** — `toc()` headings, H1–H3 indented by level, H4–H6 folded
  into the H3 depth (they stay in the document, just not in the sidebar); click
  jumps both the preview and the caret; the active section is highlighted while
  you scroll.
- **File I/O with three tiers**
  1. Electron → `window.foxtext.openFile/saveFile/saveFileAs` (native dialogs)
  2. Browser → `showOpenFilePicker` / `showSaveFilePicker` (re-save in place)
  3. Fallback → `<input type="file">` + `Blob` download
- **Export** — standalone printable HTML (inlined CSS), plain text, `.md`.
- **Autosave draft** to `localStorage` 800 ms after typing; on the next launch a
  banner offers Restore / Discard.
- **Stats** — cursor line:col, word count (CJK counted per character, Latin per
  word), characters with/without spaces, line count, reading time
  (300 CJK chars/min, 200 English words/min).
- **Theme** dark (default) / light, plus a genuinely separate light token set
  (not an inversion): body text contrast ≥ 4.5:1, code blocks keep their own tint.
- **i18n** zh-CN / en / ja — every string, including toasts, confirms and
  `aria-label`s, comes from `i18n.js`; switching is instant, updates
  `<html lang>` and the window title.
- **Focus mode** hides the outline and status bar (top bar fades until hovered).
- **Toasts** for save/export/copy, auto-dismiss after 2 s.

### Keyboard

| Shortcut | Action |
| :--- | :--- |
| `Ctrl/Cmd + S` / `Shift+S` | Save / Save as |
| `Ctrl/Cmd + O` / `N` | Open / New |
| `Ctrl/Cmd + B` / `I` | Bold / Italic (wraps selection, or inserts a pair with the caret inside) |
| `Ctrl/Cmd + K` | Insert link (URL part pre-selected) |
| `` Ctrl/Cmd + ` `` | Inline code |
| `Tab` / `Shift+Tab` | Indent / outdent |
| `Esc` | Close the export menu / close the outline drawer / leave focus mode; when none of those is open it blurs the editor so keyboard focus can move on |
| `←` `→` on the splitter | Move the divider by 2 % (`Shift` = 10 %), `Home` / `End` = 20 % / 80 % |

All formatting commands go through the browser's native editing pipeline
(`execCommand('insertText')`), so `Ctrl/Cmd + Z` undoes a formatting action
exactly like it undoes typing.

---

## 4. Responsive degradation

- **≤ 900 px** — the outline becomes an overlay drawer (only visible when
  toggled), Split stacks editor above preview, and the drag splitter is hidden
  (a percentage split is meaningless in a column layout).
- **≤ 768 px** — paddings and type scale shrink; the line gutter narrows; the
  line-count and reading-time status items hide.
- **≤ 560 px** — the top bar wraps onto two rows (brand + file name, then the
  view switcher and the button groups) instead of overflowing: no button leaves
  the viewport and no horizontal scrollbar appears.
- **≤ 520 px** — the character counter hides, keeping the cursor position and
  save state visible.

### Keyboard & focus

The editor is **not** auto-focused on load, so the first `Tab` lands on the
toolbar and only later reaches the text area; `Esc` blurs the text area again
(overlays such as the export menu or the outline drawer close first). WCAG 2.1.2
"no keyboard trap" therefore holds: there is always a way out of the editor.

---

## 5. Desktop shell

`electron/main.js`

- 1280×820 (min 900×620), `show: false` + `ready-to-show` (no white flash),
  `backgroundColor: '#0B0C0E'`, `nativeTheme.themeSource = 'dark'`,
  hidden-inset title bar on macOS.
- `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload }`
- IPC (`ipcMain.handle`): `dialog:open`, `dialog:save`, `dialog:saveAs`, `app:version`
- Native menu: File / Edit / View / Help. Menu items never reimplement logic —
  they `webContents.send('foxtext:menu', command)` and the renderer executes it.
- External links open in the system browser; in-app navigation is blocked.

`electron/preload.js` exposes **only** `openFile`, `saveFile`, `saveFileAs`,
`version` on `window.foxtext`. `ipcRenderer` itself is never exposed. Menu
commands reach the renderer as a DOM `CustomEvent('foxtext:menu')`, which needs
no extra bridge surface.

### Packaging (optional)

The repo deliberately has no `build` script so `npm start` never depends on
electron-builder. When you want installers:

```bash
npm i -D electron-builder
npx electron-builder --dir          # unpacked app
npx electron-builder --win nsis     # Windows installer
npx electron-builder --mac dmg      # macOS disk image
```

Add to `package.json` before packaging:

```json
"build": {
  "appId": "com.foxtext.app",
  "files": ["index.html", "assets/**/*", "electron/**/*", "package.json"],
  "directories": { "output": "dist" }
}
```

---

## 6. Privacy / offline

- No network requests from the renderer. The page ships a CSP of
  `default-src 'none'; script-src 'self'; img-src 'self' data: blob:; connect-src 'none'`
  so a stray CDN reference could not load even if one were added, and no script
  inside the page can reach the internet at all.
- Documents, drafts and preferences live in memory and `localStorage` only.
- Exported HTML is a single self-contained file (inlined CSS, no scripts).

### 匿名使用统计（可关闭）

桌面宿主每次启动会上报一条**匿名**心跳，用来统计有多少人在用 FoxText：

```
POST https://text.foxnan.com/api/beat.php
{ id, v, p, l, k }        // 随机 ID / 版本 / 系统 / 界面语言 / 事件类型
```

- **不含**文档内容、文件名、路径、邮箱或任何可识别个人的信息；IP 在服务端只做
  「当日盐值哈希」后短期留存，用于去重，不能反推。
- 渲染层因为 CSP 无法联网，请求只能由**宿主进程**发出：
  Electron 走 `app:beat` → 主进程 `net.fetch`；Lite 走 Python `urllib`。
  直接用浏览器打开 `index.html` 时没有宿主桥接，**一条都不会发**。
- 开关在工具栏齿轮 → 「匿名使用统计」，状态存 `localStorage`(`foxtext-stats`)；
  关掉后立刻停止上报，也不会补发历史事件。
- 服务端只写入 `/data/stats.db`（SQLite），Nginx 已禁止外部访问 `/data/`。
- 想彻底禁用：把 `electron/main.js` 的 `BEACON_URL` 改为空字符串即可。
