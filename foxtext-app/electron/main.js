/* =============================================================================
 * FoxText — electron/main.js
 * -----------------------------------------------------------------------------
 * Desktop shell only: window lifecycle, native file dialogs, native menu.
 * All editor behaviour lives in the renderer (index.html + assets/), so the
 * exact same code runs when index.html is opened directly in a browser.
 * ========================================================================== */
'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 820;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 620;
const BACKGROUND_COLOR = '#0B0C0E';
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/* Anonymous usage beacon. The renderer is sealed off from the network by its
   own CSP (`connect-src 'none'`), so this request can only ever be made here,
   in the main process, and only with the four fields listed below. */
const BEACON_URL = 'https://text.foxnan.com/api/beat.php';
const BEACON_TIMEOUT_MS = 4000;

const FILE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
  { name: 'All files', extensions: ['*'] }
];

/** @type {BrowserWindow|null} */
let mainWindow = null;

/* -------------------------------------------------------------------------- */
/* Window                                                                     */
/* -------------------------------------------------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: BACKGROUND_COLOR,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 18 } : undefined,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  /* external links open in the user's browser, never inside the app window */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  buildMenu();
}

/* -------------------------------------------------------------------------- */
/* Native menu — every item just forwards a command to the renderer           */
/* -------------------------------------------------------------------------- */

/**
 * Send a menu command to the renderer. The renderer owns all business logic,
 * the menu never duplicates it.
 * @param {string} command
 */
function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('foxtext:menu', command);
  }
}

/* Native menu text, localised to match the renderer's UI language. */
const MENU_TEXT = {
  'zh-CN': {
    file: '文件', new: '新建', open: '打开…', save: '保存', saveAs: '另存为…',
    exportHtml: '导出为 HTML…', quit: '退出', close: '关闭窗口',
    edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制',
    paste: '粘贴', selectAll: '全选',
    view: '视图', reload: '重新加载', forceReload: '强制重新加载', devTools: '开发者工具',
    toggleTheme: '切换主题', toggleOutline: '显示 / 隐藏大纲',
    resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullscreen: '进入 / 退出全屏',
    help: '帮助', about: '关于 FoxText',
    aboutTitle: '关于 FoxText', aboutOk: '好',
    aboutDetail:
      '本地优先的 Markdown 编辑器。\n' +
      '手写渲染引擎，零运行时依赖，完全离线可用。\n' +
      '你的文字永远不会离开这台设备。'
  },
  en: {
    file: 'File', new: 'New', open: 'Open…', save: 'Save', saveAs: 'Save As…',
    exportHtml: 'Export as HTML…', quit: 'Quit', close: 'Close Window',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy',
    paste: 'Paste', selectAll: 'Select All',
    view: 'View', reload: 'Reload', forceReload: 'Force Reload', devTools: 'Toggle Developer Tools',
    toggleTheme: 'Toggle Theme', toggleOutline: 'Toggle Outline',
    resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Fullscreen',
    help: 'Help', about: 'About FoxText',
    aboutTitle: 'About FoxText', aboutOk: 'OK',
    aboutDetail:
      'A local-first Markdown editor.\n' +
      'Hand-written renderer, zero runtime dependencies, works fully offline.\n' +
      'Your writing never leaves this device.'
  },
  ja: {
    file: 'ファイル', new: '新規作成', open: '開く…', save: '保存', saveAs: '名前を付けて保存…',
    exportHtml: 'HTML として書き出す…', quit: '終了', close: 'ウインドウを閉じる',
    edit: '編集', undo: '元に戻す', redo: 'やり直す', cut: '切り取り', copy: 'コピー',
    paste: '貼り付け', selectAll: 'すべて選択',
    view: '表示', reload: '再読み込み', forceReload: '強制再読み込み', devTools: '開発者ツール',
    toggleTheme: 'テーマを切り替え', toggleOutline: 'アウトラインの表示 / 非表示',
    resetZoom: '実際のサイズ', zoomIn: '拡大', zoomOut: '縮小', fullscreen: 'フルスクリーン',
    help: 'ヘルプ', about: 'FoxText について',
    aboutTitle: 'FoxText について', aboutOk: 'OK',
    aboutDetail:
      'ローカルファーストの Markdown エディタ。\n' +
      'レンダラは手書きで、実行時依存ゼロ、完全オフラインで動作します。\n' +
      '書いた内容がこの端末の外に出ることはありません。'
  }
};

/** Active menu language; replaced whenever the renderer reports a change. */
let menuLang = (() => {
  const l = (app.getLocale() || '').toLowerCase();
  if (l.indexOf('zh') === 0) return 'zh-CN';
  if (l.indexOf('ja') === 0) return 'ja';
  return 'en';
})();

function showAbout() {
  const T = MENU_TEXT[menuLang] || MENU_TEXT.en;
  const options = {
    type: 'info',
    title: T.aboutTitle,
    message: `FoxText ${app.getVersion()}`,
    detail: T.aboutDetail,
    buttons: [T.aboutOk],
    noLink: true
  };
  if (mainWindow) dialog.showMessageBox(mainWindow, options);
  else dialog.showMessageBox(options);
}

function buildMenu() {
  const T = MENU_TEXT[menuLang] || MENU_TEXT.en;
  const template = [
    {
      label: T.file,
      submenu: [
        { label: T.new, accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new') },
        { label: T.open, accelerator: 'CmdOrCtrl+O', click: () => sendCommand('open') },
        { type: 'separator' },
        { label: T.save, accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: T.saveAs, accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('saveAs') },
        { type: 'separator' },
        { label: T.exportHtml, click: () => sendCommand('exportHtml') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close', label: T.close } : { role: 'quit', label: T.quit }
      ]
    },
    {
      label: T.edit,
      submenu: [
        { role: 'undo', label: T.undo },
        { role: 'redo', label: T.redo },
        { type: 'separator' },
        { role: 'cut', label: T.cut },
        { role: 'copy', label: T.copy },
        { role: 'paste', label: T.paste },
        { role: 'selectAll', label: T.selectAll }
      ]
    },
    {
      label: T.view,
      submenu: [
        { role: 'reload', label: T.reload },
        { role: 'forceReload', label: T.forceReload },
        { role: 'toggleDevTools', label: T.devTools },
        { type: 'separator' },
        { label: T.toggleTheme, accelerator: 'CmdOrCtrl+Shift+L', click: () => sendCommand('toggle-theme') },
        { label: T.toggleOutline, accelerator: 'CmdOrCtrl+\\', click: () => sendCommand('toggle-sidebar') },
        { type: 'separator' },
        { role: 'resetZoom', label: T.resetZoom },
        { role: 'zoomIn', label: T.zoomIn },
        { role: 'zoomOut', label: T.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: T.fullscreen }
      ]
    },
    {
      label: T.help,
      submenu: [
        { label: T.about, click: showAbout }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu' });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* -------------------------------------------------------------------------- */
/* IPC: file dialogs                                                          */
/* -------------------------------------------------------------------------- */

async function readMarkdownFile(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error('File is larger than 8 MB');
  }
  const content = await fs.readFile(filePath, 'utf8');
  return { path: filePath, content };
}

async function askSavePath(suggestedName) {
  const options = {
    title: 'Save Markdown',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'untitled.md'),
    filters: FILE_FILTERS,
    properties: ['createDirectory', 'showOverwriteConfirmation']
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

async function writeMarkdownFile(content, targetPath) {
  await fs.writeFile(targetPath, content, 'utf8');
  return { canceled: false, path: targetPath };
}

/* -------------------------------------------------------------------------- */
/* Anonymous usage beacon                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Trim and clamp a beacon field so a broken client cannot send junk.
 * @param {*} value
 * @param {number} max
 * @return {string}
 */
function beaconField(value, max) {
  if (typeof value !== 'string') return '';
  /* eslint-disable-next-line no-control-regex */
  return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}

/**
 * POST the anonymous launch beacon. Never throws — statistics are optional
 * and must not influence the editor in any way.
 * @param {object} payload {id, v, p, l, k}
 * @return {Promise<boolean>} whether the server acknowledged
 */
async function sendBeacon(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const body = JSON.stringify({
    id: beaconField(data.id, 64),
    v: beaconField(data.v, 24),
    p: beaconField(data.p, 16),
    l: beaconField(data.l, 16),
    k: beaconField(data.k, 16) || 'start'
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BEACON_TIMEOUT_MS);
  try {
    const response = await net.fetch(BEACON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal
    });
    return response.ok;
  } catch (err) {
    /* offline, DNS blocked, server down — all equally irrelevant to editing */
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ipcMain.handle registrations.
 * Channels: dialog:open, dialog:save, dialog:saveAs, app:version, app:setLang,
 *           app:beat
 */
function registerIpc() {
  ipcMain.handle('dialog:open', async () => {
    const options = {
      title: 'Open Markdown',
      filters: FILE_FILTERS,
      properties: ['openFile']
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return null;
    return readMarkdownFile(result.filePaths[0]);
  });

  ipcMain.handle('dialog:save', async (_event, payload) => {
    const data = payload || {};
    const content = typeof data.content === 'string' ? data.content : '';
    const targetPath = typeof data.path === 'string' ? data.path : '';
    if (!targetPath) {
      const chosen = await askSavePath(data.suggestedName || 'untitled.md');
      if (!chosen) return { canceled: true, path: '' };
      return writeMarkdownFile(content, chosen);
    }
    return writeMarkdownFile(content, targetPath);
  });

  ipcMain.handle('dialog:saveAs', async (_event, payload) => {
    const data = payload || {};
    const content = typeof data.content === 'string' ? data.content : '';
    const chosen = await askSavePath(data.suggestedName || 'untitled.md');
    if (!chosen) return { canceled: true, path: '' };
    return writeMarkdownFile(content, chosen);
  });

  ipcMain.handle('app:version', () => app.getVersion());
  /* Renderer reports its UI language so the native menu can follow it. */
  ipcMain.handle('app:setLang', (_event, lang) => {
    if (typeof lang === 'string' && Object.prototype.hasOwnProperty.call(MENU_TEXT, lang)) {
      if (menuLang !== lang) {
        menuLang = lang;
        buildMenu();
      }
    }
    return menuLang;
  });
  /* Anonymous launch beacon; the renderer asks for it, we decide if it flies. */
  ipcMain.handle('app:beat', (_event, payload) => sendBeacon(payload));
}

/* -------------------------------------------------------------------------- */
/* App lifecycle                                                              */
/* -------------------------------------------------------------------------- */

nativeTheme.themeSource = 'dark';

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
