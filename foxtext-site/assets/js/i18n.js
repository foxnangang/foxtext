/* =============================================================
   FoxText — i18n dictionary & runtime
   Languages: zh-CN (default) / en / ja
   All page copy lives here. HTML carries only `data-i18n` keys.
   ============================================================= */
(function (window, document) {
  'use strict';

  var STORAGE_KEY = 'foxtext-lang';
  var DEFAULT_LANG = 'zh-CN';
  var SUPPORTED = ['zh-CN', 'en', 'ja'];

  /* ---------------------------------------------------------------
     Dictionaries
     --------------------------------------------------------------- */
  var DICT = {
    'zh-CN': {
      'meta.title': 'FoxText — 把 Markdown 写到极致',
      'meta.description': 'FoxText 是一款免费开源的跨平台 Markdown 编辑器：实时双栏预览、KaTeX 数学公式、Mermaid 图表、语法高亮、专注写作与 PDF / HTML / Word 导出。支持 Windows、macOS、Linux，安装包仅 12.8 MB。',

      'nav.navLabel': '主导航',
      'nav.features': '功能',
      'nav.screenshots': '截图',
      'nav.download': '下载',
      'nav.docs': '文档',
      'nav.github': 'GitHub',
      'nav.langLabel': '切换界面语言',
      'nav.cta': '下载',
      'nav.menuLabel': '打开导航菜单',
      'a11y.skip': '跳到主要内容',

      'hero.badge': 'v2.6.0 已发布',
      'hero.title1': '把 Markdown',
      'hero.title2': '写到极致',
      'hero.subtitle': '一款轻量、开源、免费的跨平台 Markdown 编辑器。实时双栏预览、公式与图表、本地工作区，12.8 MB 即刻启动 —— 不打扰你的写作。',
      'hero.ctaPrimary': '免费下载',
      'hero.ctaSecondary': 'GitHub 源码',
      'hero.win.live': '实时',
      'hero.win.explorer': '文件',
      'hero.win.preview': '预览',
      'hero.win.saved': '已自动保存',

      'stats.stars': 'GitHub Stars',
      'stats.downloads': '累计下载',
      'stats.contributors': '贡献者',
      'stats.size': '安装包体积',

      'features.eyebrow': '核心能力',
      'features.title': '为长时间写作而设计',
      'features.subtitle': '在保留 Markdown 纯粹文本的前提下，把预览、公式、图表和导出放到手边。没有任何一个功能会抢走你的光标。',
      'features.preview.title': '实时双栏预览',
      'features.preview.desc': '左写右看，滚动联动。渲染零延迟，长文档依旧跟手。',
      'features.math.title': '数学公式',
      'features.math.desc': '内置 KaTeX，行内与块级公式即时渲染，论文与技术笔记都不将就。',
      'features.speed.title': '极速启动',
      'features.speed.desc': '原生内核，冷启动 0.3 秒。安装包仅 12.8 MB，没有臃肿的运行时。',
      'features.code.title': '代码块与语法高亮',
      'features.code.desc': '180+ 语言高亮、行号、可换等宽字体，代码块一键复制。',
      'features.focus.title': '专注写作',
      'features.focus.desc': '专注模式、打字机滚动、大纲导航，加上 Vim / Emacs 键位，让手不离键盘。',
      'features.export.title': '多格式导出',
      'features.export.desc': 'PDF、HTML、Word、PNG 一键导出，样式主题可复用。',

      'demo.eyebrow': '上手体验',
      'demo.title': '三种场景，一眼看懂',
      'demo.subtitle': '以下为界面示意图，真实体验请下载桌面端。',
      'demo.tablistLabel': '功能演示',
      'demo.tab1': '写作',
      'demo.tab2': '公式与图表',
      'demo.tab3': '导出',
      'demo.p1.title': '纯粹的双栏写作',
      'demo.p1.desc': '编辑器保留行号、折叠与大纲；预览区严格跟随滚动位置，语法与最终排版始终一一对应。',
      'demo.p2.title': '公式与流程图就地渲染',
      'demo.p2.desc': '粘贴 LaTeX 或 Mermaid 代码块即可预览，不用切换窗口，也不用等构建。',
      'demo.p3.title': '一次导出，多种格式',
      'demo.p3.desc': '按文档选择 PDF / HTML / DOCX / PNG，可复用主题与页边距预设，批量任务在后台排队执行。',

      'lang.eyebrow': '多语言',
      'lang.title': '界面说你的语言',
      'lang.subtitle': '软件界面内置简体中文、English、日本語，切换即时生效；这个官网同样支持三语切换。',
      'lang.c1': '菜单、对话框、工具提示与快捷键提示完整中文化，文档链接与相关说明一并翻译；术语遵循中文技术写作习惯，并适配中英混排的标点与断行。',
      'lang.c2': '菜单、对话框、工具提示、快捷键与文档链接全部提供英文版本，采用英文排版默认值（空格、大小写与断词），术语沿用开发者社区的通用表达。',
      'lang.c3': '菜单、对话框、工具提示与快捷键提示均已日文化，文档链接同步提供日文版本；适配日语组版的禁则处理，混排英文技术名词时保留半角写法。',
      'lang.note': '首次启动会跟随系统语言自动选择，之后也可以随时手动切换。你的选择保存在本地，下次打开依旧生效。',

      'dl.eyebrow': '下载',
      'dl.title': '选择你的平台',
      'dl.subtitle': '免费、开源、无需注册。便携版免安装，下载即用。',
      'dl.win.arch': 'Windows 10 / 11 · x64 · 复用系统 WebView2',
      'dl.win.aria': '下载 FoxText Windows 轻量版（17 MB，.exe，绿色免安装）',
      'dl.mac.arch': 'macOS 12+ · Universal（Intel 与 Apple Silicon）',
      'dl.mac.aria': '下载 FoxText macOS 版磁盘映像（.dmg）',
      'dl.linux.arch': 'Linux · AppImage · .deb · x86_64 / arm64',
      'dl.linux.aria': '下载 FoxText Linux 版 AppImage',
      'dl.btn': '下载',
      'dl.soon': '即将推出',
      'dl.soonSize': '敬请期待',
      'dl.pkgTitle': '或使用包管理器',
      'dl.copy': '复制命令',

      'dl.reqTitle': '系统要求',
      'dl.reqOs': 'Windows 10 版本 1809（Build 17763）或更高，或 Windows 11；64 位（x64）',
      'dl.reqWebView2': '需要 Microsoft Edge WebView2 运行库 —— Windows 11 与较新的 Windows 10 已内置，老机器首次启动时会引导安装',
      'dl.reqWebView2Link': '官方下载',
      'dl.reqPortable': '便携版免安装，下载后双击即可使用',

      'oss.eyebrow': '开源',
      'oss.title': 'MIT 协议，代码全公开',
      'oss.desc': 'FoxText 的全部源码托管在 GitHub，以 MIT 协议发布。你可以自由使用、修改、分发，也可以把它嵌进自己的工具链。',
      'oss.p1': '核心编辑器、渲染引擎与插件 API 全部开源，没有闭源模块。',
      'oss.p2': '贡献流程透明：Issue 提出提案，Pull Request 公开评审，每周发布预览版。',
      'oss.p3': '构建只需要 Node.js 与 pnpm，一条命令即可跑起开发环境。',
      'oss.repo': '查看仓库',
      'oss.contributing': '贡献指南',
      'oss.copy': '复制构建命令',
      'oss.license': 'MIT License · 允许商用、修改与再分发',

      'footer.tagline': '一款轻量、开源、跨平台的 Markdown 编辑器，为长时间写作而设计。',
      'footer.col1': '产品',
      'footer.p1': '功能',
      'footer.p2': '下载',
      'footer.p3': '界面预览',
      'footer.p4': '更新日志',
      'footer.col2': '资源',
      'footer.r1': '文档',
      'footer.r2': '键盘快捷键',
      'footer.r3': '主题与插件',
      'footer.r4': '构建指南',
      'footer.col3': '社区',
      'footer.c1': 'GitHub 仓库',
      'footer.c2': '讨论区',
      'footer.c3': '贡献指南',
      'footer.c4': '行为准则',
      'footer.col4': '法律',
      'footer.g1': '隐私政策',
      'footer.g2': '服务条款',
      'footer.g3': 'MIT 协议',
      'footer.g4': '商标说明',
      'footer.copyright': '© 2026 FoxText Contributors · MIT License',
      'footer.demo': '本站为演示站点，下载链接与数据均为示意。',

      'misc.toTop': '回到顶部',
      'misc.copied': '已复制到剪贴板',
      'misc.copyFailed': '复制失败，请手动选择文本'
    },

    en: {
      'meta.title': 'FoxText — Markdown, written beautifully',
      'meta.description': 'FoxText is a free, open-source Markdown editor for Windows, macOS and Linux: live split preview, KaTeX math, Mermaid diagrams, syntax highlighting, focus mode and PDF / HTML / Word export — all in 12.8 MB.',

      'nav.navLabel': 'Main',
      'nav.features': 'Features',
      'nav.screenshots': 'Screenshots',
      'nav.download': 'Download',
      'nav.docs': 'Docs',
      'nav.github': 'GitHub',
      'nav.langLabel': 'Switch interface language',
      'nav.cta': 'Download',
      'nav.menuLabel': 'Open navigation menu',
      'a11y.skip': 'Skip to main content',

      'hero.badge': 'v2.6.0 is out',
      'hero.title1': 'Write Markdown',
      'hero.title2': 'at its finest',
      'hero.subtitle': 'A lightweight, open-source Markdown editor for every desktop. Live split preview, math and diagrams, local workspaces — 12.8 MB, instant to start, and never in your way.',
      'hero.ctaPrimary': 'Download free',
      'hero.ctaSecondary': 'Source on GitHub',
      'hero.win.live': 'live',
      'hero.win.explorer': 'Files',
      'hero.win.preview': 'Preview',
      'hero.win.saved': 'autosaved',

      'stats.stars': 'GitHub stars',
      'stats.downloads': 'Downloads',
      'stats.contributors': 'Contributors',
      'stats.size': 'Installer size',

      'features.eyebrow': 'Capabilities',
      'features.title': 'Built for long writing sessions',
      'features.subtitle': 'Your Markdown stays plain text — preview, math, diagrams and export simply sit within reach. Nothing here steals the cursor.',
      'features.preview.title': 'Live split preview',
      'features.preview.desc': 'Write on the left, read on the right. Scroll-synced, rendered with no perceptible delay.',
      'features.math.title': 'Math formulas',
      'features.math.desc': 'KaTeX built in. Inline and block equations render as you type, for papers and technical notes alike.',
      'features.speed.title': 'Instant startup',
      'features.speed.desc': 'A native core that cold-starts in 0.3 s. Just 12.8 MB, with no heavyweight runtime inside.',
      'features.code.title': 'Code blocks, properly lit',
      'features.code.desc': '180+ languages, line numbers, switchable monospace and one-click copy on every block.',
      'features.focus.title': 'Focus that holds',
      'features.focus.desc': 'Focus mode, typewriter scrolling, outline navigation and Vim / Emacs keybindings keep your hands on the keys.',
      'features.export.title': 'Export anywhere',
      'features.export.desc': 'PDF, HTML, Word and PNG in one click, with reusable style themes.',

      'demo.eyebrow': 'The flow',
      'demo.title': 'Three moments, one glance',
      'demo.subtitle': 'The panels below are UI mockups — download the desktop app for the real feel.',
      'demo.tablistLabel': 'Feature demos',
      'demo.tab1': 'Writing',
      'demo.tab2': 'Math & diagrams',
      'demo.tab3': 'Export',
      'demo.p1.title': 'Pure two-pane writing',
      'demo.p1.desc': 'The editor keeps line numbers, folding and an outline; the preview follows your scroll position, so source and layout never drift apart.',
      'demo.p2.title': 'Equations and flowcharts, in place',
      'demo.p2.desc': 'Paste a LaTeX expression or a Mermaid block and see the result immediately — no extra window, no build step.',
      'demo.p3.title': 'One document, many formats',
      'demo.p3.desc': 'Pick PDF, HTML, DOCX or PNG per document, reuse theme and margin presets, and queue batches in the background.',

      'lang.eyebrow': 'Languages',
      'lang.title': 'An interface that speaks yours',
      'lang.subtitle': 'The app ships with 简体中文, English and 日本語, switching instantly. This website supports the same three languages.',
      'lang.c1': 'Menus, dialogs and shortcut hints are fully localised, with documentation links and tooltips translated too; terminology follows Chinese technical-writing conventions and mixed CJK/Latin punctuation rules.',
      'lang.c2': 'Menus, dialogs, tooltips, shortcut hints and documentation links all ship in English, using English typographic defaults — spacing, capitalisation and hyphenation — so nothing reads like a translation.',
      'lang.c3': 'Menus, dialogs, tooltips and shortcut hints are localised into Japanese, with documentation links translated as well; Japanese line-breaking (kinsoku) rules apply, and Latin technical terms stay half-width.',
      'lang.note': 'FoxText follows your system language on first run, and you can switch whenever you like. Your choice is stored locally and remembered next time.',

      'dl.eyebrow': 'Download',
      'dl.title': 'Choose your platform',
      'dl.subtitle': 'Free, open source, no account required. Portable edition — no installer needed.',
      'dl.win.arch': 'Windows 10 / 11 · x64 · uses the system WebView2',
      'dl.win.aria': 'Download FoxText Lite for Windows (17 MB, .exe, portable)',
      'dl.mac.arch': 'macOS 12+ · Universal (Intel and Apple Silicon)',
      'dl.mac.aria': 'Download FoxText for macOS (.dmg disk image)',
      'dl.linux.arch': 'Linux · AppImage · .deb · x86_64 / arm64',
      'dl.linux.aria': 'Download FoxText for Linux (AppImage)',
      'dl.btn': 'Download',
      'dl.soon': 'Coming soon',
      'dl.soonSize': 'stay tuned',
      'dl.pkgTitle': 'Or use a package manager',
      'dl.copy': 'Copy command',

      'dl.reqTitle': 'System requirements',
      'dl.reqOs': 'Windows 10 version 1809 (build 17763) or later, or Windows 11; 64-bit (x64)',
      'dl.reqWebView2': 'Requires the Microsoft Edge WebView2 Runtime — bundled with Windows 11 and recent Windows 10; older machines are prompted to install it on first launch',
      'dl.reqWebView2Link': 'Official download',
      'dl.reqPortable': 'Portable — no installer needed. Download and double-click to run.',

      'oss.eyebrow': 'Open source',
      'oss.title': 'MIT licensed, source in the open',
      'oss.desc': 'All of FoxText lives on GitHub under the MIT license. Use it, modify it, redistribute it, or embed it in your own toolchain.',
      'oss.p1': 'Editor core, rendering engine and plugin API are all open — no closed modules.',
      'oss.p2': 'A transparent contribution flow: issues for proposals, public pull-request review, weekly preview builds.',
      'oss.p3': 'Building takes only Node.js and pnpm — a single command spins up a dev environment.',
      'oss.repo': 'View repository',
      'oss.contributing': 'Contributing guide',
      'oss.copy': 'Copy build commands',
      'oss.license': 'MIT License · commercial use, modification and redistribution allowed',

      'footer.tagline': 'A lightweight, open-source, cross-platform Markdown editor — built for long writing sessions.',
      'footer.col1': 'Product',
      'footer.p1': 'Features',
      'footer.p2': 'Download',
      'footer.p3': 'Interface preview',
      'footer.p4': 'Changelog',
      'footer.col2': 'Resources',
      'footer.r1': 'Documentation',
      'footer.r2': 'Keyboard shortcuts',
      'footer.r3': 'Themes & plugins',
      'footer.r4': 'Build guide',
      'footer.col3': 'Community',
      'footer.c1': 'GitHub repository',
      'footer.c2': 'Discussions',
      'footer.c3': 'Contributing guide',
      'footer.c4': 'Code of conduct',
      'footer.col4': 'Legal',
      'footer.g1': 'Privacy policy',
      'footer.g2': 'Terms of service',
      'footer.g3': 'MIT license',
      'footer.g4': 'Trademark notice',
      'footer.copyright': '© 2026 FoxText Contributors · MIT License',
      'footer.demo': 'This is a demo site — download links and figures are placeholders.',

      'misc.toTop': 'Back to top',
      'misc.copied': 'Copied to clipboard',
      'misc.copyFailed': 'Copy failed — please select the text and copy it manually'
    },

    ja: {
      'meta.title': 'FoxText — Markdownを、極める',
      'meta.description': 'FoxText は Windows・macOS・Linux に対応した無料のオープンソース Markdown エディタです。リアルタイム分割プレビュー、KaTeX 数式、Mermaid ダイアグラム、シンタックスハイライト、集中モード、PDF / HTML / Word 書き出しを 12.8 MB に収めました。',

      'nav.navLabel': 'メインナビゲーション',
      'nav.features': '機能',
      'nav.screenshots': 'スクリーンショット',
      'nav.download': 'ダウンロード',
      'nav.docs': 'ドキュメント',
      'nav.github': 'GitHub',
      'nav.langLabel': '表示言語を切り替える',
      'nav.cta': 'ダウンロード',
      'nav.menuLabel': 'ナビゲーションメニューを開く',
      'a11y.skip': 'メインコンテンツへスキップ',

      'hero.badge': 'v2.6.0 公開',
      'hero.title1': 'Markdownを、',
      'hero.title2': '極める。',
      'hero.subtitle': '軽量・オープンソース・無料のクロスプラットフォーム Markdown エディタ。分割プレビュー、数式とダイアグラム、ローカルワークスペース。12.8 MB で瞬時に起動し、書く邪魔をしません。',
      'hero.ctaPrimary': '無料ダウンロード',
      'hero.ctaSecondary': 'GitHub でソースを見る',
      'hero.win.live': 'ライブ',
      'hero.win.explorer': 'ファイル',
      'hero.win.preview': 'プレビュー',
      'hero.win.saved': '自動保存済み',

      'stats.stars': 'GitHub スター',
      'stats.downloads': '累計ダウンロード',
      'stats.contributors': 'コントリビューター',
      'stats.size': 'インストーラサイズ',

      'features.eyebrow': '主な機能',
      'features.title': '長時間の執筆のために',
      'features.subtitle': 'Markdown はあくまでプレーンテキストのまま。プレビュー、数式、ダイアグラム、書き出しは手の届く場所に。カーソルを奪う機能はひとつもありません。',
      'features.preview.title': 'リアルタイム分割プレビュー',
      'features.preview.desc': '左で書き、右で読む。スクロールは連動し、長い原稿でも描画の遅れを感じさせません。',
      'features.math.title': '数式',
      'features.math.desc': 'KaTeX を内蔵。インラインもブロックもその場で描画するので、論文も技術メモも妥協なし。',
      'features.speed.title': '瞬時の起動',
      'features.speed.desc': 'ネイティブ実装でコールドスタートは 0.3 秒。12.8 MB のみ、重いランタイムは載せていません。',
      'features.code.title': 'コードブロックとハイライト',
      'features.code.desc': '180 以上の言語に対応。行番号、等幅フォントの切り替え、ワンクリックのコピーまで。',
      'features.focus.title': '集中を途切れさせない',
      'features.focus.desc': '集中モード、タイプライタスクロール、アウトライン、Vim / Emacs キーバインドで手をキーから離しません。',
      'features.export.title': '多彩な書き出し',
      'features.export.desc': 'PDF・HTML・Word・PNG をワンクリックで。テーマは再利用できます。',

      'demo.eyebrow': '操作感',
      'demo.title': '3つの場面を、ひと目で',
      'demo.subtitle': '以下はインターフェースのイメージです。実際の操作感はデスクトップ版でご確認ください。',
      'demo.tablistLabel': '機能デモ',
      'demo.tab1': '執筆',
      'demo.tab2': '数式とダイアグラム',
      'demo.tab3': '書き出し',
      'demo.p1.title': '二画面の、素直な執筆',
      'demo.p1.desc': 'エディタは行番号・折りたたみ・アウトラインを保持し、プレビューはスクロールに追従。ソースと組版がずれることはありません。',
      'demo.p2.title': '数式もフローチャートもその場で',
      'demo.p2.desc': 'LaTeX や Mermaid のブロックを貼れば即座に描画。別ウィンドウもビルド待ちも要りません。',
      'demo.p3.title': 'ひとつの原稿から、複数の形式へ',
      'demo.p3.desc': '原稿ごとに PDF / HTML / DOCX / PNG を選択。テーマと余白のプリセットを再利用し、バッチ処理はバックグラウンドで実行します。',

      'lang.eyebrow': '多言語',
      'lang.title': 'あなたの言語で使える UI',
      'lang.subtitle': 'アプリの表示言語は 简体中文・English・日本語 に対応し、切り替えは即時反映。このサイトも同じ三言語に対応しています。',
      'lang.c1': 'メニュー・ダイアログ・ショートカット表記を中国語化し、ドキュメントへのリンクとツールチップも翻訳済み。中国語の技術文書の慣習に沿った訳語を採用し、中国語と英数字が混在する際の約物・改行にも対応しています。',
      'lang.c2': 'メニュー・ダイアログ・ツールチップ・ショートカット表記を英語化し、ドキュメントへのリンクも英語版を用意。英語組版の既定値（字間・ハイフネーション）を適用し、直訳調を避けて開発者に通じる表現を用いています。',
      'lang.c3': 'メニュー・ダイアログ・ツールチップ・ショートカット表記を日本語化し、ドキュメントへのリンクも日本語版を用意。日本語組版の禁則処理に対応し、英字の技術用語は半角のまま、和欧混植時の字間と改行も調整しています。',
      'lang.note': '初回起動時はシステム言語を自動で選択し、いつでも手動で切り替えられます。選択内容はローカルに保存され、次回以降も引き継がれます。',

      'dl.eyebrow': 'ダウンロード',
      'dl.title': 'お使いのプラットフォームを選択',
      'dl.subtitle': '無料・オープンソース・アカウント登録不要。ポータブル版のためインストール不要、ダウンロードするだけです。',
      'dl.win.arch': 'Windows 10 / 11 · x64 · システムの WebView2 を利用',
      'dl.win.aria': 'Windows 版 FoxText Lite（17 MB、.exe、インストール不要）をダウンロード',
      'dl.mac.arch': 'macOS 12+ · Universal（Intel / Apple Silicon）',
      'dl.mac.aria': 'macOS 版 FoxText のディスクイメージ（.dmg）をダウンロード',
      'dl.linux.arch': 'Linux · AppImage · .deb · x86_64 / arm64',
      'dl.linux.aria': 'Linux 版 FoxText の AppImage をダウンロード',
      'dl.btn': 'ダウンロード',
      'dl.soon': '近日公開',
      'dl.soonSize': 'お楽しみに',
      'dl.pkgTitle': 'パッケージマネージャから導入する',
      'dl.copy': 'コマンドをコピー',

      'dl.reqTitle': 'システム要件',
      'dl.reqOs': 'Windows 10 バージョン 1809（ビルド 17763）以降、または Windows 11。64 ビット（x64）',
      'dl.reqWebView2': 'Microsoft Edge WebView2 ランタイムが必要です —— Windows 11 と新しい Windows 10 には同梱されています。未搭載の環境では初回起動時にインストールを案内します',
      'dl.reqWebView2Link': '公式ダウンロード',
      'dl.reqPortable': 'ポータブル版のためインストール不要。ダウンロードしてダブルクリックするだけです。',

      'oss.eyebrow': 'オープンソース',
      'oss.title': 'MIT ライセンス、コードはすべて公開',
      'oss.desc': 'FoxText のソースコードはすべて GitHub 上にあり、MIT ライセンスで公開されています。自由に利用・改変・再配布でき、自社ツールへの組み込みも可能です。',
      'oss.p1': 'エディタ本体、レンダリングエンジン、プラグイン API はすべて公開。非公開モジュールはありません。',
      'oss.p2': 'コントリビューションの流れも透明：Issue での提案、Pull Request の公開レビュー、毎週のプレビュービルド。',
      'oss.p3': 'ビルドに必要なのは Node.js と pnpm だけ。コマンドひとつで開発環境が起動します。',
      'oss.repo': 'リポジトリを見る',
      'oss.contributing': 'コントリビューションガイド',
      'oss.copy': 'ビルドコマンドをコピー',
      'oss.license': 'MIT License · 商用利用・改変・再配布が可能',

      'footer.tagline': '軽量・オープンソース・クロスプラットフォームの Markdown エディタ。長時間の執筆のために。',
      'footer.col1': '製品',
      'footer.p1': '機能',
      'footer.p2': 'ダウンロード',
      'footer.p3': '画面プレビュー',
      'footer.p4': '変更履歴',
      'footer.col2': 'リソース',
      'footer.r1': 'ドキュメント',
      'footer.r2': 'キーボードショートカット',
      'footer.r3': 'テーマとプラグイン',
      'footer.r4': 'ビルドガイド',
      'footer.col3': 'コミュニティ',
      'footer.c1': 'GitHub リポジトリ',
      'footer.c2': 'ディスカッション',
      'footer.c3': 'コントリビューションガイド',
      'footer.c4': '行動規範',
      'footer.col4': '法的事項',
      'footer.g1': 'プライバシーポリシー',
      'footer.g2': '利用規約',
      'footer.g3': 'MIT ライセンス',
      'footer.g4': '商標について',
      'footer.copyright': '© 2026 FoxText Contributors · MIT License',
      'footer.demo': '本サイトはデモ用です。ダウンロードリンクと数値はすべてサンプルです。',

      'misc.toTop': 'ページ上部へ戻る',
      'misc.copied': 'クリップボードにコピーしました',
      'misc.copyFailed': 'コピーできませんでした。テキストを選択して手動でコピーしてください'
    }
  };

  /* ---------------------------------------------------------------
     State & helpers
     --------------------------------------------------------------- */
  var currentLang = DEFAULT_LANG;
  var listeners = [];

  /** Normalise a locale tag such as "zh-CN", "zh-Hans-CN", "ja-JP". */
  function normalise(tag) {
    if (!tag || typeof tag !== 'string') {
      return null;
    }
    var lower = tag.toLowerCase();
    if (lower.indexOf('zh') === 0) {
      return 'zh-CN';
    }
    if (lower.indexOf('ja') === 0) {
      return 'ja';
    }
    if (lower.indexOf('en') === 0) {
      return 'en';
    }
    return null;
  }

  /** Read a stored preference, ignoring anything corrupted. */
  function readStored() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.indexOf(stored) !== -1 ? stored : null;
    } catch (err) {
      return null;
    }
  }

  function writeStored(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      /* storage can be blocked (private mode / file:// restrictions) — ignore */
    }
  }

  /** Detect the best initial language: stored → browser → default. */
  function detect() {
    var stored = readStored();
    if (stored) {
      return stored;
    }
    var candidates = [];
    if (navigator.languages && navigator.languages.length) {
      candidates = candidates.concat(navigator.languages);
    }
    if (navigator.language) {
      candidates.push(navigator.language);
    }
    for (var i = 0; i < candidates.length; i += 1) {
      var match = normalise(candidates[i]);
      if (match) {
        return match;
      }
    }
    return DEFAULT_LANG;
  }

  /** Translate a key for the active language, falling back gracefully. */
  function t(key) {
    var table = DICT[currentLang] || DICT[DEFAULT_LANG];
    if (table && Object.prototype.hasOwnProperty.call(table, key)) {
      return table[key];
    }
    var fallback = DICT[DEFAULT_LANG];
    if (fallback && Object.prototype.hasOwnProperty.call(fallback, key)) {
      return fallback[key];
    }
    if (DICT.en && Object.prototype.hasOwnProperty.call(DICT.en, key)) {
      return DICT.en[key];
    }
    return '';
  }

  /* ---------------------------------------------------------------
     DOM application
     --------------------------------------------------------------- */
  function applyText() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var key = node.getAttribute('data-i18n');
      if (!key) {
        continue;
      }
      var value = t(key);
      if (value !== '') {
        node.textContent = value;
      }
    }

    var ariaNodes = document.querySelectorAll('[data-i18n-aria]');
    for (var a = 0; a < ariaNodes.length; a += 1) {
      var ariaKey = ariaNodes[a].getAttribute('data-i18n-aria');
      if (!ariaKey) {
        continue;
      }
      var ariaValue = t(ariaKey);
      if (ariaValue !== '') {
        ariaNodes[a].setAttribute('aria-label', ariaValue);
      }
    }
  }

  function applyDocumentMeta() {
    document.documentElement.setAttribute('lang', currentLang);

    var title = t('meta.title');
    if (title) {
      document.title = title;
    }

    var description = t('meta.description');
    var metaNode = document.getElementById('metaDescription');
    if (metaNode && description) {
      metaNode.setAttribute('content', description);
    }
  }

  function applySwitchers() {
    var buttons = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      var isActive = btn.getAttribute('data-lang') === currentLang;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }

  function notify() {
    for (var i = 0; i < listeners.length; i += 1) {
      try {
        listeners[i](currentLang);
      } catch (err) {
        /* a listener must never break the switch */
      }
    }
    try {
      var event = document.createEvent('Event');
      event.initEvent('foxtext:langchange', true, true);
      document.dispatchEvent(event);
    } catch (err) {
      /* older engines — non fatal */
    }
  }

  /**
   * Apply a language to the whole document.
   * @param {string} lang One of SUPPORTED.
   * @param {boolean} [persist] Write the choice to localStorage.
   */
  function setLang(lang, persist) {
    var next = SUPPORTED.indexOf(lang) !== -1 ? lang : DEFAULT_LANG;
    currentLang = next;
    if (persist !== false) {
      writeStored(next);
    }
    applyDocumentMeta();
    applyText();
    applySwitchers();
    notify();
    return next;
  }

  function getLang() {
    return currentLang;
  }

  function onChange(fn) {
    if (typeof fn === 'function') {
      listeners.push(fn);
    }
  }

  /* ---------------------------------------------------------------
     Bootstrap
     --------------------------------------------------------------- */
  function bindSwitchers() {
    var buttons = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', function (event) {
        event.preventDefault();
        setLang(this.getAttribute('data-lang'), true);
      });
    }
  }

  function init() {
    bindSwitchers();
    setLang(detect(), false);
  }

  window.FoxTextI18n = {
    init: init,
    setLang: setLang,
    getLang: getLang,
    t: t,
    onChange: onChange,
    supported: SUPPORTED.slice(),
    storageKey: STORAGE_KEY
  };

  init();
})(window, document);
