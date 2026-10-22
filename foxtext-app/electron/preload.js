/* =============================================================================
 * FoxText — electron/preload.js
 * -----------------------------------------------------------------------------
 * The only bridge between the sandboxed renderer and the main process.
 * Exactly six methods are exposed on `window.foxtext`; `ipcRenderer` itself is
 * never leaked. Menu commands arrive as a DOM CustomEvent ("foxtext:menu") so
 * that no extra API surface is required.
 * ========================================================================== */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Open a file through the native dialog.
 * @return {Promise<{path: string, content: string}|null>} null when cancelled
 */
function openFile() {
  return ipcRenderer.invoke('dialog:open');
}

/**
 * Save content. When `filePath` is empty the user is asked for a location.
 * @param {string} content
 * @param {string} [filePath]
 * @return {Promise<{canceled: boolean, path: string}>}
 */
function saveFile(content, filePath) {
  return ipcRenderer.invoke('dialog:save', {
    content: typeof content === 'string' ? content : '',
    path: typeof filePath === 'string' ? filePath : ''
  });
}

/**
 * Always show the native "save as" dialog.
 * @param {string} content
 * @param {string} [suggestedName]
 * @return {Promise<{canceled: boolean, path: string}>}
 */
function saveFileAs(content, suggestedName) {
  return ipcRenderer.invoke('dialog:saveAs', {
    content: typeof content === 'string' ? content : '',
    suggestedName: typeof suggestedName === 'string' && suggestedName ? suggestedName : 'untitled.md'
  });
}

/**
 * Application version from package.json.
 * @return {Promise<string>}
 */
function version() {
  return ipcRenderer.invoke('app:version');
}

/**
 * Report the renderer's UI language so the native menu follows it.
 * @param {string} lang one of "zh-CN" | "en" | "ja"
 * @return {Promise<string>} the language the menu actually uses
 */
function setLang(lang) {
  return ipcRenderer.invoke('app:setLang', typeof lang === 'string' ? lang : '');
}

/**
 * Anonymous launch beacon.
 *
 * The renderer itself cannot reach the network (its CSP sets
 * `connect-src 'none'`), so the request is made by the main process. Only the
 * five fields below ever leave the machine — never document content, file
 * names or paths. Returns false when offline or blocked; never throws.
 *
 * @param {{id?: string, v?: string, p?: string, l?: string, k?: string}} payload
 * @return {Promise<boolean>}
 */
function beat(payload) {
  return ipcRenderer.invoke('app:beat', payload && typeof payload === 'object' ? payload : {});
}

/* Host marker, readable *synchronously* by the renderer at boot time.
   Electron already ships a real native menu bar, so the renderer's optional
   in-app menu bar must stay hidden here — only the Lite host (a bare WebView2
   window without any native menu) needs it. Exposed through the bridge
   because contextIsolation is on: a plain `window.__foxtextHost = ...` in
   this file would only land in the isolated world. */
try {
  contextBridge.exposeInMainWorld('__foxtextHost', 'electron');
} catch (err) {
  /* Defensive: a failure here must never take the rest of the bridge with it.
     With contextIsolation off this plain assignment reaches the renderer. */
  try {
    window.__foxtextHost = 'electron';
  } catch (inner) { /* the menu bar simply stays hidden */ }
}

contextBridge.exposeInMainWorld('foxtext', Object.freeze({
  openFile,
  saveFile,
  saveFileAs,
  version,
  setLang,
  beat
}));

/* Forward native menu commands to the renderer as DOM events. */
ipcRenderer.on('foxtext:menu', (_event, command) => {
  try {
    window.dispatchEvent(new CustomEvent('foxtext:menu', { detail: String(command || '') }));
  } catch (err) {
    /* the renderer simply misses a menu command — never break the window */
  }
});
