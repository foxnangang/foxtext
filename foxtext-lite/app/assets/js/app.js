/* =============================================================================
 * FoxText — app.js
 * -----------------------------------------------------------------------------
 * UI controller: view modes, editor behaviour, live preview, outline, stats,
 * file I/O (Electron -> File System Access API -> input/Blob fallback),
 * export, i18n, theme, draft autosave, toasts.
 *
 * Depends on: window.FoxMarkdown (assets/js/markdown.js)
 *             window.FoxI18N     (assets/js/i18n.js)
 * ========================================================================== */
(function () {
  'use strict';

  var MD = window.FoxMarkdown;
  var I18N = window.FoxI18N;

  var LS = {
    theme: 'foxtext-theme',
    lang: 'foxtext-lang',
    view: 'foxtext-view',
    split: 'foxtext-split',
    sidebar: 'foxtext-sidebar',
    draft: 'foxtext-draft',
    anon: 'foxtext-anon',
    stats: 'foxtext-stats',
    updateDismissed: 'foxtext-update-dismissed'
  };

  /* Anonymous usage beacon — see sendStats() below. */
  var BEACON_KINDS = ['start'];

  var MAX_FILE_BYTES = 8 * 1024 * 1024;
  var RENDER_DEBOUNCE = 120;
  var DRAFT_DEBOUNCE = 800;
  var SYNC_LOCK_MS = 120;
  var MIN_RATIO = 0.2;
  var MAX_RATIO = 0.8;
  var READING_CJK_PER_MIN = 300;
  var READING_WORD_PER_MIN = 200;
  var CJK_ALL = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */

  var state = {
    lang: 'zh-CN',
    theme: 'dark',
    view: 'split',
    ratio: 0.5,
    sidebarOpen: true,
    focus: false,
    fileName: '',
    filePath: '',
    fileHandle: null,
    dirty: false,
    isSample: true,
    lastSaved: ''
  };

  var els = {};
  var renderTimer = 0;
  var draftTimer = 0;
  var syncSource = null;
  var syncTimer = 0;
  var lineHeight = 24;
  var editorPadTop = 14;
  var gutterLineCount = -1;
  var outlineItems = [];
  var lastSaveRequestedAt = 0;
  var narrowMedia = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 900px)')
    : null;
  var sidebarPref = true;

  /* ------------------------------------------------------------------ */
  /* Utilities                                                          */
  /* ------------------------------------------------------------------ */

  function byId(id) {
    return document.getElementById(id);
  }

  function readLS(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* private mode / quota — silently ignore, feature degrades gracefully */
    }
  }

  function removeLS(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      /* ignore */
    }
  }

  /** Translate a key, interpolating {placeholders}. */
  function t(key, vars) {
    var table = I18N.dict[state.lang] || I18N.dict['en'];
    var text = table[key];
    if (text == null) text = I18N.dict['en'][key];
    if (text == null) return key;
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, function (match, name) {
      return vars[name] == null ? match : String(vars[name]);
    });
  }

  function localeTag() {
    return state.lang === 'zh-CN' ? 'zh-CN' : state.lang;
  }

  function formatNumber(value) {
    try {
      return Number(value).toLocaleString(localeTag());
    } catch (err) {
      return String(value);
    }
  }

  function baseName(filePath) {
    var parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || '';
  }

  function stripExtension(name) {
    return String(name || '').replace(/\.[^.\\/]+$/, '');
  }

  function isAbort(err) {
    return !!err && (err.name === 'AbortError' || err.name === 'NotAllowedError');
  }

  /* ------------------------------------------------------------------ */
  /* Anonymous usage statistics (opt-out, host-mediated)                */
  /* ------------------------------------------------------------------ */

  /* The renderer is deliberately sealed off from the network: index.html sets
     `connect-src 'none'` in its CSP, so no script inside the page can ever
     reach the internet. The beacon is therefore handed to the desktop host
     (Electron main process / pywebview Python host) through the very same
     `window.foxtext` bridge used for file dialogs. Opened straight in a
     browser there simply is no bridge — and then nothing is ever sent.

     Payload: a random id, app version, OS family and interface language.
     Never the document, its name, its path or the IP on the client side. */

  var statsSent = false;
  var anonId = '';

  function getAnonId() {
    if (anonId) return anonId;
    anonId = readLS(LS.anon, '');
    if (!anonId) {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          anonId = window.crypto.randomUUID();
        }
      } catch (err) { /* old WebView2 without randomUUID — fall through */ }
      if (!anonId) {
        anonId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      }
      writeLS(LS.anon, anonId);
    }
    return anonId;
  }

  function statsEnabled() {
    return readLS(LS.stats, '1') !== '0';
  }

  function platformTag() {
    var probe = String(navigator.userAgentData && navigator.userAgentData.platform
      ? navigator.userAgentData.platform
      : (navigator.platform || navigator.userAgent || ''));
    if (/win/i.test(probe)) return 'win';
    if (/mac|iphone|ipad/i.test(probe)) return 'mac';
    if (/linux|android|x11/i.test(probe)) return 'linux';
    return 'other';
  }

  /**
   * Fire-and-forget beacon. Silently no-ops when statistics are off, when the
   * host exposes no `beat()` or when the request has already been made.
   * @param {string} [kind] one of BEACON_KINDS
   */
  function sendStats(kind) {
    if (statsSent || !statsEnabled()) return;
    var bridge = window.foxtext;
    if (!bridge || typeof bridge.beat !== 'function') return;
    if (BEACON_KINDS.indexOf(kind) === -1) kind = 'start';
    statsSent = true;

    var fire = function (version) {
      try {
        bridge.beat({
          id: getAnonId(),
          v: String(version || ''),
          p: platformTag(),
          l: state.lang,
          k: kind
        });
      } catch (err) { /* statistics must never break the editor */ }
    };

    if (typeof bridge.version === 'function') {
      bridge.version().then(function (v) { fire(v); }, function () { fire(''); });
    } else {
      fire('');
    }
  }

  function setStats(on) {
    var next = !!on;
    writeLS(LS.stats, next ? '1' : '0');
    els.miStats.setAttribute('aria-checked', next ? 'true' : 'false');
    if (next) {
      statsSent = false;
      sendStats('start');
    }
    toast(t(next ? 'toast.statsOn' : 'toast.statsOff'));
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                             */
  /* ------------------------------------------------------------------ */

  function toast(message) {
    if (!els.toasts || !message) return;
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = message;
    els.toasts.appendChild(node);
    window.setTimeout(function () {
      node.classList.add('is-leaving');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }, 2000);
  }

  /* ------------------------------------------------------------------ */
  /* i18n application                                                   */
  /* ------------------------------------------------------------------ */

  function applyI18n() {
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var titled = document.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < titled.length; j += 1) {
      titled[j].setAttribute('title', t(titled[j].getAttribute('data-i18n-title')));
    }
    var aria = document.querySelectorAll('[data-i18n-aria]');
    for (var k = 0; k < aria.length; k += 1) {
      aria[k].setAttribute('aria-label', t(aria[k].getAttribute('data-i18n-aria')));
    }
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    for (var p = 0; p < placeholders.length; p += 1) {
      placeholders[p].setAttribute('placeholder', t(placeholders[p].getAttribute('data-i18n-placeholder')));
    }
    document.title = t('app.title');
    document.documentElement.setAttribute('lang', state.lang);
    refreshDocTitle();
    refreshStatus();
    renderOutline();
    refreshExportMenuLabels();
    /* dropdown rows are built on demand, so an open menu is rebuilt in place */
    refreshMenubar();
  }

  function refreshExportMenuLabels() {
    var items = document.querySelectorAll('#exportMenu .menu-item');
    for (var i = 0; i < items.length; i += 1) {
      items[i].textContent = t(items[i].getAttribute('data-i18n'));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Theme                                                              */
  /* ------------------------------------------------------------------ */

  function applyTheme(theme, announce) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    writeLS(LS.theme, state.theme);
    var use = byId('themeIcon');
    if (use) use.setAttribute('href', state.theme === 'dark' ? '#i-sun' : '#i-moon');
    var btn = byId('btnTheme');
    if (btn) {
      var key = state.theme === 'dark' ? 'tb.themeToLight' : 'tb.themeToDark';
      btn.setAttribute('title', t(key));
      btn.setAttribute('aria-label', t('tb.theme'));
    }
    refreshStatus();
    if (announce) toast(t(state.theme === 'dark' ? 'toast.themeDark' : 'toast.themeLight'));
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark', true);
  }

  /* ------------------------------------------------------------------ */
  /* Editor metrics / gutter / current line                             */
  /* ------------------------------------------------------------------ */

  function measureLineHeight() {
    if (!els.editor) return;
    var style = window.getComputedStyle(els.editor);
    var parsed = parseFloat(style.lineHeight);
    if (!isNaN(parsed) && parsed > 0) {
      lineHeight = parsed;
    } else {
      lineHeight = parseFloat(style.fontSize || '14') * 1.7;
    }
    var padTop = parseFloat(style.paddingTop);
    if (!isNaN(padTop)) {
      editorPadTop = padTop;
    }
    document.documentElement.style.setProperty('--editor-line-height', lineHeight + 'px');
  }

  function lineCount(text) {
    var count = 1;
    for (var i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) count += 1;
    }
    return count;
  }

  function updateGutter() {
    var total = lineCount(els.editor.value);
    if (total !== gutterLineCount) {
      var parts = new Array(total);
      for (var i = 0; i < total; i += 1) parts[i] = String(i + 1);
      els.gutter.textContent = parts.join('\n');
      gutterLineCount = total;
    }
    els.gutter.scrollTop = els.editor.scrollTop;
    updateCurrentLine();
  }

  function updateCurrentLine() {
    var pos = els.editor.selectionStart;
    var value = els.editor.value;
    var line = lineCount(value.slice(0, pos));
    /* the textarea's own top padding shifts the first line down */
    var top = (line - 1) * lineHeight + editorPadTop - els.editor.scrollTop;
    var height = els.editor.clientHeight;
    if (top < -lineHeight || top > height) {
      els.currentLine.style.opacity = '0';
      return;
    }
    els.currentLine.style.opacity = '1';
    els.currentLine.style.transform = 'translateY(' + top + 'px)';
    els.currentLine.style.height = lineHeight + 'px';
  }

  function cursorPosition() {
    var pos = els.editor.selectionStart;
    var before = els.editor.value.slice(0, pos);
    var line = lineCount(before);
    var lastBreak = before.lastIndexOf('\n');
    var col = pos - lastBreak;
    return { line: line, col: col };
  }

  /* ------------------------------------------------------------------ */
  /* Stats                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Split mixed CJK / Latin text into a word count.
   * CJK characters count individually, Latin runs count as one word each.
   * @param {string} text
   * @return {{cjk: number, latin: number, words: number}}
   */
  function analyzeText(text) {
    if (!text) return { cjk: 0, latin: 0, words: 0 };
    var cjkMatches = text.match(CJK_ALL);
    var cjk = cjkMatches ? cjkMatches.length : 0;
    var latinMatches = text.replace(CJK_ALL, ' ').match(/[A-Za-z0-9_'\u2019\-]+/g);
    var latin = latinMatches ? latinMatches.length : 0;
    return { cjk: cjk, latin: latin, words: cjk + latin };
  }

  function readingMinutes(text) {
    var stats = analyzeText(text);
    if (!stats.words) return 0;
    var minutes = stats.cjk / READING_CJK_PER_MIN + stats.latin / READING_WORD_PER_MIN;
    return Math.max(1, Math.ceil(minutes));
  }

  function updateStats() {
    var text = els.editor.value;
    var chars = text.length;
    var noSpace = text.replace(/\s/g, '').length;
    var stats = analyzeText(text);
    var lines = lineCount(text);
    var minutes = readingMinutes(text);
    els.stWords.textContent = formatNumber(stats.words) + ' ' + t('st.words');
    els.stChars.textContent = formatNumber(chars) + ' ' + t('st.chars') +
      ' (' + formatNumber(noSpace) + ' ' + t('st.charsNoSpace') + ')';
    els.stLines.textContent = formatNumber(lines) + ' ' + t('st.lines');
    els.stReading.textContent = t('st.reading') + ' ' + minutes + ' ' + t('st.minute');
  }

  function refreshStatus() {
    if (!els.stCursor) return;
    var pos = cursorPosition();
    els.stCursor.textContent = t('st.line') + ' ' + pos.line + ', ' + t('st.col') + ' ' + pos.col;
    els.stSave.textContent = state.dirty ? t('st.unsaved') : t('st.saved');
    els.stSave.classList.toggle('is-dirty', state.dirty);
    els.stTheme.textContent = t('st.theme') + ' ' + t(state.theme === 'dark' ? 'st.themeDark' : 'st.themeLight');
    if (els.langSelect) els.langSelect.value = state.lang;
  }

  /* ------------------------------------------------------------------ */
  /* Preview rendering                                                  */
  /* ------------------------------------------------------------------ */

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderNow, RENDER_DEBOUNCE);
  }

  function renderNow() {
    window.clearTimeout(renderTimer);
    var html = MD.parse(els.editor.value, { sanitize: true });
    els.preview.innerHTML = html;
    decorateCodeBlocks();
    updateGutter();
    updateStats();
    renderOutline();
    refreshStatus();
    syncEditorToPreview();
  }

  function decorateCodeBlocks() {
    var blocks = els.preview.querySelectorAll('pre');
    for (var i = 0; i < blocks.length; i += 1) {
      var pre = blocks[i];
      var wrap = document.createElement('div');
      wrap.className = 'code-block';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      var code = pre.querySelector('code');
      var langMatch = code ? /language-([\w+#.\-]+)/.exec(code.className || '') : null;
      if (langMatch) {
        var langTag = document.createElement('span');
        langTag.className = 'code-lang';
        langTag.textContent = langMatch[1];
        wrap.insertBefore(langTag, pre);
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = t('copy.code');
      (function (button, codeNode) {
        button.addEventListener('click', function () {
          copyText(codeNode ? codeNode.textContent : '');
        });
      })(btn, code);
      wrap.appendChild(btn);
    }
  }

  function copyText(text) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      document.body.removeChild(area);
      toast(ok ? t('toast.copied') : t('toast.copyFail'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(t('toast.copied'));
      }, fallback);
    } else {
      fallback();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Outline                                                            */
  /* ------------------------------------------------------------------ */

  function renderOutline() {
    var items;
    try {
      if (typeof MD.outline === 'function') {
        items = MD.outline(els.editor.value);
      } else {
        items = MD.toc(els.editor.value).map(function (entry) {
          return { level: entry.level, text: entry.text, id: entry.id, line: 0 };
        });
      }
    } catch (err) {
      items = [];
    }
    outlineItems = items;
    if (!items.length) {
      els.outline.innerHTML = '<p class="outline-empty">' + escapeText(t('outline.empty')) + '</p>';
      return;
    }
    var html = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      /* H1–H3 are shown with indentation, H4–H6 are folded into H3 depth */
      var depth = Math.min(item.level, 3) - 1;
      html.push(
        '<button type="button" class="outline-item level-' + item.level + '"' +
        ' data-index="' + i + '" style="--depth:' + depth + '"' +
        ' title="' + escapeAttrText(item.text) + '">' +
        escapeText(item.text) + '</button>'
      );
    }
    els.outline.innerHTML = html.join('');
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttrText(value) {
    return escapeText(value).replace(/"/g, '&quot;');
  }

  function onOutlineClick(event) {
    var btn = event.target.closest ? event.target.closest('.outline-item') : null;
    if (!btn) return;
    var index = parseInt(btn.getAttribute('data-index'), 10);
    var item = outlineItems[index];
    if (!item) return;
    jumpToHeading(item, index, true);
  }

  function jumpToHeading(item, index, moveCaret) {
    var target = document.getElementById(item.id);
    if (target) {
      var paneRect = els.previewPane.getBoundingClientRect();
      var targetRect = target.getBoundingClientRect();
      syncSource = 'outline';
      window.clearTimeout(syncTimer);
      els.previewPane.scrollTop = Math.max(
        0,
        els.previewPane.scrollTop + (targetRect.top - paneRect.top) - 12
      );
      syncTimer = window.setTimeout(function () { syncSource = null; }, SYNC_LOCK_MS);
    }
    if (moveCaret && item.line) {
      var lines = els.editor.value.split('\n');
      var lineIndex = Math.min(Math.max(0, item.line - 1), lines.length - 1);
      var offset = 0;
      for (var i = 0; i < lineIndex; i += 1) offset += lines[i].length + 1;
      els.editor.focus();
      els.editor.setSelectionRange(offset, offset + lines[lineIndex].length);
      var visible = els.editor.clientHeight;
      els.editor.scrollTop = Math.max(0, lineIndex * lineHeight - visible / 2 + lineHeight);
      els.gutter.scrollTop = els.editor.scrollTop;
      updateCurrentLine();
    }
    setActiveOutline(index);
  }

  function setActiveOutline(index) {
    var nodes = els.outline.querySelectorAll('.outline-item');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].classList.toggle('is-active', i === index);
    }
  }

  /** Highlight the heading whose section currently sits at the top of the preview. */
  function updateActiveHeading() {
    if (!outlineItems.length) return;
    var pane = els.previewPane;
    var paneRect = pane.getBoundingClientRect();
    var threshold = 72;
    var active = -1;
    for (var i = 0; i < outlineItems.length; i += 1) {
      var node = document.getElementById(outlineItems[i].id);
      if (!node) continue;
      var relativeTop = node.getBoundingClientRect().top - paneRect.top;
      if (relativeTop <= threshold) active = i;
      else break;
    }
    var nodes = els.outline.querySelectorAll('.outline-item');
    for (var j = 0; j < nodes.length; j += 1) {
      nodes[j].classList.toggle('is-active', j === active);
    }
    if (active >= 0 && nodes[active] && nodes[active].scrollIntoView) {
      var bounds = els.outline.getBoundingClientRect();
      var itemBounds = nodes[active].getBoundingClientRect();
      if (itemBounds.top < bounds.top || itemBounds.bottom > bounds.bottom) {
        nodes[active].scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Scroll synchronisation                                             */
  /* ------------------------------------------------------------------ */

  function syncEditorToPreview() {
    if (syncSource === 'preview') return;
    if (!els.editor.clientHeight || !els.previewPane.clientHeight) return;
    var eMax = els.editor.scrollHeight - els.editor.clientHeight;
    var pMax = els.previewPane.scrollHeight - els.previewPane.clientHeight;
    if (eMax <= 0 || pMax <= 0) return;
    syncSource = 'editor';
    window.clearTimeout(syncTimer);
    els.previewPane.scrollTop = (els.editor.scrollTop / eMax) * pMax;
    syncTimer = window.setTimeout(function () { syncSource = null; }, SYNC_LOCK_MS);
  }

  function syncPreviewToEditor() {
    if (syncSource === 'editor') return;
    if (!els.editor.clientHeight || !els.previewPane.clientHeight) {
      updateActiveHeading();
      return;
    }
    var eMax = els.editor.scrollHeight - els.editor.clientHeight;
    var pMax = els.previewPane.scrollHeight - els.previewPane.clientHeight;
    if (eMax <= 0 || pMax <= 0) return;
    syncSource = 'preview';
    window.clearTimeout(syncTimer);
    els.editor.scrollTop = (els.previewPane.scrollTop / pMax) * eMax;
    els.gutter.scrollTop = els.editor.scrollTop;
    syncTimer = window.setTimeout(function () { syncSource = null; }, SYNC_LOCK_MS);
    updateCurrentLine();
  }

  /* ------------------------------------------------------------------ */
  /* Document lifecycle                                                 */
  /* ------------------------------------------------------------------ */

  function setDocument(content, meta) {
    var info = meta || {};
    els.editor.value = content;
    state.fileName = info.fileName || '';
    state.filePath = info.filePath || '';
    state.fileHandle = info.fileHandle || null;
    state.isSample = !!info.isSample;
    state.dirty = !!info.dirty;
    state.lastSaved = info.dirty ? '' : content;
    els.editor.scrollTop = 0;
    els.editor.setSelectionRange(0, 0);
    gutterLineCount = -1;
    renderNow();
    refreshDocTitle();
  }

  function refreshDocTitle() {
    if (!els.docName) return;
    var name = state.fileName || t('doc.untitled');
    els.docName.textContent = name;
    els.docName.setAttribute('title', state.filePath || name);
    els.docDot.hidden = !state.dirty;
    els.docDot.setAttribute('title', t('doc.dirty'));
  }

  function markDirty(isDirty) {
    state.dirty = !!isDirty;
    refreshDocTitle();
    refreshStatus();
  }

  function markSaved(path, name) {
    if (path) state.filePath = path;
    if (name) state.fileName = name;
    state.lastSaved = els.editor.value;
    removeLS(LS.draft);
    markDirty(false);
  }

  function confirmDiscard() {
    if (!state.dirty) return true;
    var name = state.fileName || t('doc.untitled');
    return window.confirm(t('confirm.unsaved', { name: name }));
  }

  function newDocument() {
    if (!confirmDiscard()) return;
    setDocument('', { fileName: '', filePath: '', dirty: false, isSample: false });
    removeLS(LS.draft);
    toast(t('toast.created'));
    els.editor.focus();
  }

  function loadDocument(content, fileName, filePath, fileHandle) {
    setDocument(content, {
      fileName: fileName || '',
      filePath: filePath || '',
      fileHandle: fileHandle || null,
      dirty: false,
      isSample: false
    });
    removeLS(LS.draft);
  }

  /* ------------------------------------------------------------------ */
  /* File input / output                                                */
  /* ------------------------------------------------------------------ */

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > MAX_FILE_BYTES) {
        reject(new Error(t('err.tooLarge')));
        return;
      }
      if (typeof file.text === 'function') {
        file.text().then(resolve, reject);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('read error')); };
      reader.readAsText(file);
    });
  }

  var MD_TYPES = [{
    description: 'Markdown',
    accept: { 'text/markdown': ['.md', '.markdown', '.txt'] }
  }];

  function openWithInput() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) {
        document.body.removeChild(input);
        return;
      }
      readFileText(file).then(function (text) {
        loadDocument(text, file.name, '', null);
        toast(t('toast.opened', { name: file.name }));
      }, function (err) {
        toast(t('toast.openFail', { msg: err && err.message ? err.message : String(err) }));
      }).then(function () {
        if (input.parentNode) input.parentNode.removeChild(input);
      });
    });
    input.click();
  }

  function openDocument() {
    if (!confirmDiscard()) return;
    if (window.foxtext && typeof window.foxtext.openFile === 'function') {
      window.foxtext.openFile().then(function (result) {
        if (!result || result.canceled || typeof result.content !== 'string') return;
        var name = baseName(result.path);
        loadDocument(result.content, name, result.path, null);
        toast(t('toast.opened', { name: name }));
      }, function (err) {
        toast(t('toast.openFail', { msg: err && err.message ? err.message : String(err) }));
      });
      return;
    }
    if (typeof window.showOpenFilePicker === 'function') {
      window.showOpenFilePicker({ multiple: false, types: MD_TYPES }).then(function (handles) {
        var handle = handles && handles[0];
        if (!handle) return null;
        return handle.getFile().then(function (file) {
          return readFileText(file).then(function (text) {
            loadDocument(text, file.name, '', handle);
            toast(t('toast.opened', { name: file.name }));
          });
        });
      }).catch(function (err) {
        if (isAbort(err)) return;
        openWithInput();
      });
      return;
    }
    openWithInput();
  }

  function downloadFile(fileName, content, mime) {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 4000);
  }

  function writeWithHandle(handle, content) {
    return handle.createWritable().then(function (writable) {
      return writable.write(content).then(function () {
        return writable.close();
      });
    });
  }

  function saveDocument(forceSaveAs) {
    var content = els.editor.value;
    var suggested = state.fileName || 'untitled.md';

    /* Guard against a menu accelerator and a keydown both firing for one
       keystroke: a second save request within 200 ms is ignored. */
    var now = Date.now();
    if (now - lastSaveRequestedAt < 200) return Promise.resolve();
    lastSaveRequestedAt = now;

    if (window.foxtext && typeof window.foxtext.saveFile === 'function') {
      var task;
      if (!forceSaveAs && state.filePath) {
        task = window.foxtext.saveFile(content, state.filePath);
      } else {
        task = window.foxtext.saveFileAs(content, suggested);
      }
      return task.then(function (result) {
        if (!result || result.canceled) return;
        markSaved(result.path, baseName(result.path) || state.fileName);
        toast(t('toast.saved', { name: state.fileName || t('doc.untitled') }));
      }, function (err) {
        toast(t('toast.saveFail', { msg: err && err.message ? err.message : String(err) }));
      });
    }

    if (!forceSaveAs && state.fileHandle && state.fileHandle.createWritable) {
      return writeWithHandle(state.fileHandle, content).then(function () {
        markSaved();
        toast(t('toast.saved', { name: state.fileName || t('doc.untitled') }));
      }, function (err) {
        toast(t('toast.saveFail', { msg: err && err.message ? err.message : String(err) }));
      });
    }

    if (typeof window.showSaveFilePicker === 'function') {
      return window.showSaveFilePicker({ suggestedName: suggested, types: MD_TYPES }).then(function (handle) {
        return writeWithHandle(handle, content).then(function () {
          state.fileHandle = handle;
          markSaved('', handle.name || suggested);
          toast(t('toast.saved', { name: state.fileName || t('doc.untitled') }));
        });
      }).catch(function (err) {
        if (isAbort(err)) return;
        downloadFile(suggested, content, 'text/markdown');
        markSaved('', suggested);
        toast(t('toast.saved', { name: suggested }));
      });
    }

    downloadFile(suggested, content, 'text/markdown');
    markSaved('', suggested);
    toast(t('toast.saved', { name: suggested }));
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                             */
  /* ------------------------------------------------------------------ */

  var EXPORT_CSS = [
    ':root{color-scheme:light}',
    '*{box-sizing:border-box}',
    'body{margin:0;padding:56px 24px 96px;background:#ffffff;color:#1a1d21;',
    'font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,',
    '"Noto Sans SC","PingFang SC","Hiragino Sans","Noto Sans JP","Microsoft YaHei",sans-serif}',
    'main{max-width:760px;margin:0 auto}',
    'h1,h2,h3,h4,h5,h6{line-height:1.3;margin:2em 0 .6em;font-weight:650;letter-spacing:-.01em}',
    'h1{font-size:2em;margin-top:0;padding-bottom:.3em;border-bottom:1px solid #e3e6e4}',
    'h2{font-size:1.55em;padding-bottom:.25em;border-bottom:1px solid #eceeed}',
    'h3{font-size:1.25em}h4{font-size:1.05em}h5,h6{font-size:1em;color:#4a5158}',
    'p,ul,ol,blockquote,pre,table{margin:0 0 1.1em}',
    'ul,ol{padding-left:1.5em}li+li{margin-top:.3em}',
    'a{color:#0f8a58;text-decoration:underline;text-underline-offset:2px}',
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;',
    'background:#f1f4f2;border:1px solid #e3e8e5;border-radius:4px;padding:.12em .35em}',
    'pre{background:#f7f9f8;border:1px solid #e3e8e5;border-radius:8px;padding:14px 16px;overflow:auto}',
    'pre code{background:none;border:0;padding:0;font-size:.875em;line-height:1.6}',
    'blockquote{margin-left:0;padding:.2em 0 .2em 1em;border-left:3px solid #cfd8d3;color:#4a5158}',
    'blockquote blockquote{margin-top:.6em}',
    'table{border-collapse:collapse;width:100%;font-size:.95em}',
    'th,td{border:1px solid #e3e8e5;padding:8px 12px;text-align:left}',
    'th{background:#f5f8f6;font-weight:600}',
    'hr{border:0;border-top:1px solid #e3e8e5;margin:2em 0}',
    'img{max-width:100%;height:auto;border-radius:6px}',
    'input[type=checkbox]{margin-right:.4em}',
    '.task-item{display:inline-flex;align-items:baseline;gap:.35em}',
    'del{color:#6b737a}',
    '@media print{body{padding:0}main{max-width:none}a{color:inherit}pre{white-space:pre-wrap}}'
  ].join('');

  function buildHtmlDocument() {
    var body = MD.parse(els.editor.value, { sanitize: true });
    var title = state.fileName ? stripExtension(state.fileName) : t('doc.untitled');
    return [
      '<!DOCTYPE html>',
      '<html lang="' + escapeAttrText(state.lang) + '">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="generator" content="FoxText ' + escapeAttrText(MD.version) + '">',
      '<title>' + escapeText(title) + '</title>',
      '<style>' + EXPORT_CSS + '</style>',
      '</head>',
      '<body>',
      '<main class="markdown-body">',
      body,
      '</main>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  function markdownToPlainText() {
    var holder = document.createElement('div');
    holder.innerHTML = MD.parse(els.editor.value, { sanitize: true });
    /* add line breaks for block boundaries before flattening */
    var blocks = holder.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr,hr');
    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      var text = block.textContent || '';
      block.textContent = text + (block.tagName === 'TR' ? '\n' : '\n\n');
    }
    var plain = holder.textContent || '';
    plain = plain.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return plain + '\n';
  }

  function exportDocument(kind) {
    var base = state.fileName ? stripExtension(state.fileName) : 'untitled';
    try {
      if (kind === 'html') {
        downloadFile(base + '.html', buildHtmlDocument(), 'text/html');
        toast(t('toast.exported', { name: base + '.html' }));
      } else if (kind === 'txt') {
        downloadFile(base + '.txt', markdownToPlainText(), 'text/plain');
        toast(t('toast.exported', { name: base + '.txt' }));
      } else {
        downloadFile(base + '.md', els.editor.value, 'text/markdown');
        toast(t('toast.exported', { name: base + '.md' }));
      }
    } catch (err) {
      toast(t('toast.saveFail', { msg: err && err.message ? err.message : String(err) }));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Draft autosave                                                     */
  /* ------------------------------------------------------------------ */

  function scheduleDraft() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraft, DRAFT_DEBOUNCE);
  }

  function saveDraft() {
    var content = els.editor.value;
    if (!content) {
      removeLS(LS.draft);
      return;
    }
    writeLS(LS.draft, JSON.stringify({
      content: content,
      name: state.fileName || '',
      path: state.filePath || '',
      time: Date.now()
    }));
  }

  function readDraft() {
    var raw = readLS(LS.draft, '');
    if (!raw) return null;
    try {
      var data = JSON.parse(raw);
      if (!data || typeof data.content !== 'string' || !data.content.trim()) return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function showDraftBanner(draft) {
    var when = '';
    try {
      when = new Date(draft.time || Date.now()).toLocaleString(localeTag());
    } catch (err) {
      when = '';
    }
    els.draftMsg.textContent = t('doc.draftQuestion', { time: when });
    els.draftBanner.hidden = false;
  }

  function restoreDraft() {
    var draft = readDraft();
    els.draftBanner.hidden = true;
    if (!draft) return;
    setDocument(draft.content, {
      fileName: draft.name || '',
      filePath: draft.path || '',
      dirty: true,
      isSample: false
    });
    toast(t('toast.draftRestored'));
  }

  function discardDraft() {
    els.draftBanner.hidden = true;
    removeLS(LS.draft);
    toast(t('toast.draftDiscarded'));
  }

  /* ------------------------------------------------------------------ */
  /* View modes / layout                                                */
  /* ------------------------------------------------------------------ */

  function applyView(view) {
    var next = view === 'edit' || view === 'preview' ? view : 'split';
    state.view = next;
    els.workspace.setAttribute('data-view', next);
    writeLS(LS.view, next);
    var segs = document.querySelectorAll('#viewGroup .seg');
    for (var i = 0; i < segs.length; i += 1) {
      segs[i].classList.toggle('is-active', segs[i].getAttribute('data-view') === next);
    }
    if (next !== 'preview') {
      window.setTimeout(function () {
        updateGutter();
        updateCurrentLine();
      }, 0);
    }
    if (next !== 'edit') updateActiveHeading();
  }

  function applyRatio(ratio) {
    var clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
    state.ratio = clamped;
    els.workspace.style.setProperty('--split', String(clamped));
    if (els.resizer) {
      els.resizer.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
    }
  }

  function isNarrow() {
    return document.body.classList.contains('is-narrow');
  }

  /**
   * Single source of truth for the outline panel — the button state, the
   * drawer visibility and `state.sidebarOpen` are always written together so
   * they can never disagree.
   *
   * Wide layout: the panel is docked, `state.sidebarOpen` is the user's
   * persistent preference. Narrow layout: it is an overlay drawer that starts
   * closed, so the preference is parked in `sidebarPref` and restored when the
   * viewport widens again.
   */
  function applySidebar(open) {
    var narrow = isNarrow();
    state.sidebarOpen = !!open;
    document.body.classList.toggle('sidebar-hidden', !state.sidebarOpen);
    document.body.classList.toggle('sidebar-forced', narrow && state.sidebarOpen);
    var btn = byId('btnSidebar');
    if (btn) {
      btn.classList.toggle('is-on', state.sidebarOpen);
      btn.setAttribute('aria-expanded', String(state.sidebarOpen));
    }
    if (!narrow) {
      sidebarPref = state.sidebarOpen;
      writeLS(LS.sidebar, state.sidebarOpen ? '1' : '0');
    }
  }

  /** React to a narrow <-> wide layout change. */
  function applyNarrowLayout(narrow) {
    var wasNarrow = isNarrow();
    document.body.classList.toggle('is-narrow', narrow);
    if (narrow === wasNarrow) return;
    applySidebar(narrow ? false : sidebarPref);
  }

  function syncNarrow() {
    applyNarrowLayout(narrowMedia ? narrowMedia.matches : window.innerWidth <= 900);
  }

  function applyFocus(on) {
    state.focus = !!on;
    document.body.classList.toggle('is-focus', state.focus);
    var btn = byId('btnFocus');
    if (btn) btn.classList.toggle('is-on', state.focus);
    if (state.focus) els.editor.focus();
  }

  function initResizer() {
    var dragging = false;

    function onPointerDown(event) {
      if (els.workspace.getAttribute('data-view') !== 'split') return;
      if (document.body.classList.contains('is-narrow')) return;
      dragging = true;
      document.body.classList.add('is-resizing');
      if (els.resizer.setPointerCapture && event.pointerId != null) {
        try { els.resizer.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
      }
      event.preventDefault();
    }

    function onPointerMove(event) {
      if (!dragging) return;
      var rect = els.workspace.getBoundingClientRect();
      if (rect.width <= 0) return;
      var ratio = (event.clientX - rect.left) / rect.width;
      applyRatio(ratio);
      event.preventDefault();
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing');
      writeLS(LS.split, String(state.ratio));
      updateGutter();
      updateCurrentLine();
    }

    els.resizer.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    els.resizer.addEventListener('dblclick', function () {
      applyRatio(0.5);
      writeLS(LS.split, '0.5');
    });

    /* keyboard support for the separator (issue: it must be reachable with Tab) */
    els.resizer.addEventListener('keydown', function (event) {
      var step = event.shiftKey ? 0.1 : 0.02;
      var handled = true;
      if (event.key === 'ArrowLeft') {
        applyRatio(state.ratio - step);
      } else if (event.key === 'ArrowRight') {
        applyRatio(state.ratio + step);
      } else if (event.key === 'Home') {
        applyRatio(MIN_RATIO);
      } else if (event.key === 'End') {
        applyRatio(MAX_RATIO);
      } else {
        handled = false;
      }
      if (!handled) return;
      writeLS(LS.split, String(state.ratio));
      updateGutter();
      updateCurrentLine();
      event.preventDefault();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Editing helpers (Tab, wrap, shortcuts)                             */
  /* ------------------------------------------------------------------ */

  /**
   * The single write channel for every programmatic edit (toolbar buttons,
   * keyboard shortcuts, Tab/Shift+Tab).
   *
   * `setRangeText()` does NOT create an undo entry, which desynchronises the
   * browser's native undo stack: Ctrl+Z then either does nothing or rolls back
   * earlier *typing* instead of the formatting just applied.
   * `document.execCommand('insertText')` goes through the same editing pipeline
   * as real keystrokes, so Chromium/Electron record it in the native undo stack.
   * When execCommand is unavailable or refuses (returns false / throws) we fall
   * back to setRangeText() so the feature still works.
   *
   * @param {string} text text that replaces the current selection
   * @param {?number=} selStart caret/selection start after the edit
   * @param {?number=} selEnd selection end after the edit (defaults to selStart)
   */
  function replaceRange(text, selStart, selEnd) {
    var area = els.editor;
    var start = area.selectionStart;
    var end = area.selectionEnd;
    if (document.activeElement !== area) {
      area.focus();
    }
    var inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (err) {
      inserted = false;
    }
    if (!inserted) {
      area.setRangeText(text, start, end, 'end');
    }
    if (selStart != null) {
      area.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
    }
    handleInput();
  }

  /** Insert text at the caret, optionally re-selecting a range inside it. */
  function insertText(text, selectFrom, selectTo) {
    var start = els.editor.selectionStart;
    var from = selectFrom == null ? null : start + selectFrom;
    var to = selectTo == null ? from : start + selectTo;
    replaceRange(text, from, to);
  }

  /** Wrap the selection (or insert a pair and place the caret inside). */
  function wrapSelection(marker, placeholder) {
    var area = els.editor;
    var start = area.selectionStart;
    var end = area.selectionEnd;
    var selected = area.value.slice(start, end);
    var body = selected || placeholder || '';
    replaceRange(
      marker + body + marker,
      start + marker.length,
      start + marker.length + body.length
    );
  }

  function insertLink() {
    var area = els.editor;
    var start = area.selectionStart;
    var end = area.selectionEnd;
    var selected = area.value.slice(start, end);
    var label = selected || 'text';
    /* select the url part so the user can paste immediately */
    var urlStart = start + 1 + label.length + 2;
    replaceRange('[' + label + '](url)', urlStart, urlStart + 3);
  }

  function indentSelection(outdent) {
    var area = els.editor;
    var value = area.value;
    var start = area.selectionStart;
    var end = area.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var sliceEnd = value.indexOf('\n', end);
    if (sliceEnd === -1) sliceEnd = value.length;
    var block = value.slice(lineStart, sliceEnd);
    var lines = block.split('\n');

    if (!outdent && lines.length === 1 && start === end) {
      insertText('  ', 2);
      return;
    }

    var changed;
    if (outdent) {
      changed = lines.map(function (line) {
        if (line.slice(0, 2) === '  ') return line.slice(2);
        if (line.charAt(0) === ' ' || line.charAt(0) === '\t') return line.slice(1);
        return line;
      });
    } else {
      changed = lines.map(function (line) {
        return line.length ? '  ' + line : line;
      });
    }
    var nextBlock = changed.join('\n');
    /* select the whole block first: replaceRange() replaces the selection */
    area.setSelectionRange(lineStart, sliceEnd);
    replaceRange(nextBlock, lineStart, lineStart + nextBlock.length);
  }

  function handleEditorKeydown(event) {
    var mod = event.ctrlKey || event.metaKey;

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      indentSelection(event.shiftKey);
      return;
    }

    if (!mod) return;

    var key = event.key.toLowerCase();
    if (key === 'b' || key === 'i' || key === 'k' || key === '`') {
      event.stopPropagation();
    }
    if (key === 'b') { event.preventDefault(); wrapSelection('**', 'bold'); return; }
    if (key === 'i') { event.preventDefault(); wrapSelection('*', 'italic'); return; }
    if (key === 'k') { event.preventDefault(); insertLink(); return; }
    if (key === '`') { event.preventDefault(); wrapSelection('`', 'code'); return; }
  }

  function handleGlobalKeydown(event) {
    var mod = event.ctrlKey || event.metaKey;
    var key = event.key.toLowerCase();

    if (event.key === 'Escape') {
      /* overlays first, then the editor itself — Escape is the documented way
         out of the textarea so it can never become a keyboard trap */
      var dismissed = false;
      if (!els.exportMenu.hidden) {
        closeExportMenu();
        dismissed = true;
      }
      if (!els.settingsMenu.hidden) {
        closeSettingsMenu();
        dismissed = true;
      }
      if (!els.aboutModal.hidden) {
        closeAbout(true);
        dismissed = true;
      }
      if (isMenuOpen()) {
        closeMenubar(true);
        dismissed = true;
      }
      if (document.body.classList.contains('sidebar-forced')) {
        applySidebar(false);
        dismissed = true;
      }
      if (state.focus) {
        applyFocus(false);
        dismissed = true;
      }
      if (!dismissed && document.activeElement === els.editor) {
        els.editor.blur();
        event.preventDefault();
      }
      return;
    }

    if (!mod) return;

    if (key === 's') {
      event.preventDefault();
      saveDocument(event.shiftKey);
      return;
    }
    if (key === 'o') {
      event.preventDefault();
      openDocument();
      return;
    }
    if (key === 'n') {
      event.preventDefault();
      newDocument();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Export menu                                                        */
  /* ------------------------------------------------------------------ */

  function openExportMenu() {
    els.exportMenu.hidden = false;
    els.btnExport.setAttribute('aria-expanded', 'true');
  }

  function closeExportMenu() {
    if (els.exportMenu.hidden) return;
    els.exportMenu.hidden = true;
    els.btnExport.setAttribute('aria-expanded', 'false');
  }

  function toggleExportMenu(event) {
    event.stopPropagation();
    if (els.exportMenu.hidden) openExportMenu();
    else closeExportMenu();
  }

  /* ------------------------------------------------------------------ */
  /* Settings menu                                                      */
  /* ------------------------------------------------------------------ */

  function openSettingsMenu() {
    els.settingsMenu.hidden = false;
    els.btnSettings.setAttribute('aria-expanded', 'true');
  }

  function closeSettingsMenu() {
    if (els.settingsMenu.hidden) return;
    els.settingsMenu.hidden = true;
    els.btnSettings.setAttribute('aria-expanded', 'false');
  }

  function toggleSettingsMenu(event) {
    event.stopPropagation();
    if (els.settingsMenu.hidden) openSettingsMenu();
    else closeSettingsMenu();
  }

  /* ------------------------------------------------------------------ */
  /* In-app menu bar (Lite host) + About dialog                         */
  /* ------------------------------------------------------------------ */

  /*
   * Lite runs inside a bare WebView2 window that has no native menu bar, so
   * the renderer draws its own. Electron must NOT get one (it already has a
   * real native menu) but a plain browser should: the web build is a natural
   * extension of FoxText and must not lose the "About" entry just because it
   * runs in a tab.
   *
   * The model below mirrors `buildMenu()` in electron/main.js so both builds
   * expose the same command set.
   */
  var MENU_MODEL = {
    file: [
      { cmd: 'new', label: 'menu.file.new', accel: 'Ctrl+N' },
      { cmd: 'open', label: 'menu.file.open', accel: 'Ctrl+O' },
      { sep: true },
      { cmd: 'save', label: 'menu.file.save', accel: 'Ctrl+S' },
      { cmd: 'saveAs', label: 'menu.file.saveAs', accel: 'Ctrl+Shift+S' },
      { sep: true },
      { cmd: 'exportHtml', label: 'menu.file.exportHtml' },
      { sep: true },
      { cmd: 'quit', label: 'menu.file.quit' }
    ],
    edit: [
      { edit: 'undo', label: 'menu.edit.undo', accel: 'Ctrl+Z' },
      { edit: 'redo', label: 'menu.edit.redo', accel: 'Ctrl+Shift+Z' },
      { sep: true },
      { edit: 'cut', label: 'menu.edit.cut', accel: 'Ctrl+X' },
      { edit: 'copy', label: 'menu.edit.copy', accel: 'Ctrl+C' },
      { edit: 'paste', label: 'menu.edit.paste', accel: 'Ctrl+V' },
      { sep: true },
      { edit: 'selectAll', label: 'menu.edit.selectAll', accel: 'Ctrl+A' }
    ],
    view: [
      { cmd: 'toggle-theme', label: 'menu.view.theme', accel: 'Ctrl+Shift+L' },
      { cmd: 'toggle-sidebar', label: 'menu.view.outline', accel: 'Ctrl+\\' },
      { sep: true },
      /* Lite has no zoom API at all (Electron uses
         webContents.setZoomFactor, pywebview exposes no equivalent), so the
         three zoom rows stay listed — keeping the menu structure identical to
         Electron — but are rendered disabled with an explanatory tooltip. */
      { disabled: true, label: 'menu.view.zoomReset', accel: 'Ctrl+0', title: 'menu.zoomUnsupported' },
      { disabled: true, label: 'menu.view.zoomIn', accel: 'Ctrl+ +', title: 'menu.zoomUnsupported' },
      { disabled: true, label: 'menu.view.zoomOut', accel: 'Ctrl+ -', title: 'menu.zoomUnsupported' }
    ],
    help: [
      { cmd: 'about', label: 'menu.help.about' }
    ]
  };

  var menuState = { open: '', trigger: null };
  var appVersion = '';

  /**
   * Whether the in-app menu bar belongs on screen.
   *
   * Electron ships a real native menu bar, so a second one would be a
   * duplicate and stays hidden. Every other host — FoxText Lite (pywebview +
   * WebView2) and a plain browser — gets the HTML menu bar.
   * @return {boolean}
   */
  function isMenubarHost() {
    return window.__foxtextHost !== 'electron';
  }

  /**
   * Whether the host can actually close the application.
   * A browser tab has no bridge, so "Quit" would be a dead entry there.
   * @return {boolean}
   */
  function canQuit() {
    return !!(window.foxtext && typeof window.foxtext.quit === 'function');
  }

  function menuRoots() {
    return document.querySelectorAll('#menubar .mb-item');
  }

  function menuRootButton(name) {
    var roots = menuRoots();
    for (var i = 0; i < roots.length; i += 1) {
      if (roots[i].getAttribute('data-menu') === name) return roots[i];
    }
    return null;
  }

  function setRootExpanded(name, expanded) {
    var btn = menuRootButton(name);
    if (!btn) return;
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.classList.toggle('is-open', !!expanded);
  }

  /**
   * Show or hide the whole bar according to the host marker.
   * Called at boot() and again if a host reports itself late (pywebview can
   * attach its bridge after DOMContentLoaded, so the flag may appear later).
   */
  function ensureMenubar() {
    if (!els.menubar) return;
    var active = isMenubarHost();
    els.menubar.hidden = !active;
    if (!active) closeMenubar(false);
  }

  function isMenuOpen() {
    return menuState.open !== '';
  }

  function buildMenuItem(entry) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'mi';
    item.setAttribute('role', 'menuitem');

    var label = document.createElement('span');
    label.className = 'mi-label';
    label.textContent = t(entry.label);
    item.appendChild(label);

    if (entry.accel) {
      var accel = document.createElement('span');
      accel.className = 'mi-accel';
      accel.setAttribute('aria-hidden', 'true');
      accel.textContent = entry.accel;
      item.appendChild(accel);
    }

    if (entry.disabled) {
      item.className += ' is-disabled';
      item.disabled = true;
      item.setAttribute('aria-disabled', 'true');
      if (entry.title) item.setAttribute('title', t(entry.title));
    } else {
      if (entry.cmd) item.setAttribute('data-cmd', entry.cmd);
      if (entry.edit) item.setAttribute('data-edit', entry.edit);
    }
    return item;
  }

  /** (Re)build the dropdown for one root menu from MENU_MODEL. */
  function renderMenu(name) {
    var model = MENU_MODEL[name];
    if (!model || !els.mbDrop) return;
    var nodes = [];
    for (var i = 0; i < model.length; i += 1) {
      var entry = model[i];
      if (entry.sep) {
        var sep = document.createElement('div');
        sep.className = 'mi-sep';
        sep.setAttribute('role', 'separator');
        nodes.push(sep);
        continue;
      }
      /* "Quit" only makes sense where a host can actually close the app —
         a browser tab has no bridge, so the entry is left out entirely
         rather than shown as a dead button. */
      if (entry.cmd === 'quit' && !canQuit()) continue;
      nodes.push(buildMenuItem(entry));
    }
    /* a skipped item must not leave a dangling separator behind */
    while (nodes.length && nodes[nodes.length - 1].classList.contains('mi-sep')) {
      nodes.pop();
    }
    els.mbDrop.textContent = '';
    for (var j = 0; j < nodes.length; j += 1) {
      els.mbDrop.appendChild(nodes[j]);
    }
  }

  function openMenu(name) {
    var btn = menuRootButton(name);
    if (!btn || !els.mbDrop || !els.menubar) return;
    /* Only one root may be expanded at a time. openMenu() is also reached from
       the pointerenter shortcut, which deliberately skips closeMenubar(), so
       the previous root has to be reset here — otherwise its .is-open
       highlight and its aria-expanded="true" would stay behind and two roots
       would claim to be open at once. */
    if (menuState.open && menuState.open !== name) {
      setRootExpanded(menuState.open, false);
    }
    renderMenu(name);
    els.mbDrop.hidden = false;
    /* Align the shared dropdown with its trigger. Measured with rects rather
       than offsetLeft because the root row can scroll on narrow windows, and
       clamped so the popup never leaves the bar. */
    var barRect = els.menubar.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();
    var left = btnRect.left - barRect.left;
    var maxLeft = Math.max(0, barRect.width - els.mbDrop.offsetWidth - 6);
    els.mbDrop.style.left = Math.min(Math.max(0, left), maxLeft) + 'px';
    menuState.open = name;
    menuState.trigger = btn;
    setRootExpanded(name, true);
  }

  function closeMenubar(restoreFocus) {
    if (!els.mbDrop) return;
    if (els.mbDrop.hidden && !isMenuOpen()) return;
    els.mbDrop.hidden = true;
    els.mbDrop.textContent = '';
    if (menuState.open) setRootExpanded(menuState.open, false);
    var trigger = menuState.trigger;
    menuState.open = '';
    menuState.trigger = null;
    if (restoreFocus && trigger && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  }

  function toggleMenu(name) {
    if (menuState.open === name) {
      closeMenubar(true);
      return;
    }
    closeMenubar(false);
    openMenu(name);
  }

  /** Re-render an open dropdown after a language switch. */
  function refreshMenubar() {
    if (!isMenuOpen()) return;
    renderMenu(menuState.open);
  }

  /**
   * Editing commands go through execCommand on the focused textarea: that is
   * the same channel replaceRange() uses for programmatic edits, so the
   * browser's native undo stack stays in sync.
   * @param {string} name one of execCommand's editing commands
   */
  function runEditCommand(name) {
    if (els.editor && typeof els.editor.focus === 'function') els.editor.focus();
    var ok = false;
    try {
      ok = document.execCommand(name);
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      toast(t('err.noSupport'));
      return;
    }
    /* a selection change moves the caret, so the status bar has to follow —
       the document text itself is untouched */
    updateCurrentLine();
    refreshStatus();
  }

  function quitApp() {
    var bridge = window.foxtext;
    if (bridge && typeof bridge.quit === 'function') {
      try {
        bridge.quit();
        return;
      } catch (err) { /* host refused — fall through to the notice */ }
    }
    toast(t('err.noSupport'));
  }

  function runMenuCommand(item, trigger) {
    if (!item) return;
    var edit = item.getAttribute('data-edit');
    if (edit) {
      runEditCommand(edit);
      return;
    }
    var cmd = item.getAttribute('data-cmd');
    if (!cmd) return;
    if (cmd === 'quit') {
      quitApp();
      return;
    }
    if (cmd === 'about') {
      showAbout(trigger);
      return;
    }
    /* Everything else is a command bindEvents() already listens for. */
    try {
      window.dispatchEvent(new CustomEvent('foxtext:menu', { detail: cmd }));
    } catch (err) { /* no CustomEvent support: the command is simply dropped */ }
  }

  /* ------------------------------ host version ---------------------------- */

  /**
   * Ask the host for its version and publish it in the settings menu and the
   * About dialog.
   *
   * On Lite the bridge object exists from the very first script, but its
   * methods are attached a moment later, so a single call at boot() can easily
   * miss. `ensureVersion()` therefore retries a few times and is also re-run
   * whenever the host announces itself.
   */
  function refreshVersion() {
    if (!window.foxtext || typeof window.foxtext.version !== 'function') return;
    try {
      window.foxtext.version().then(function (version) {
        var v = String(version || '');
        appVersion = v;
        document.documentElement.setAttribute('data-app-version', v);
        els.miVersion.textContent = t('set.version', { v: v || '—' });
        if (els.aboutModal && !els.aboutModal.hidden) {
          els.aboutVersion.textContent = t('set.version', { v: v || '—' });
        }
      }, function () { /* keep whatever is already on screen */ });
    } catch (err) { /* a broken bridge must not break the editor */ }
  }

  var versionTries = 0;

  function ensureVersion() {
    if (appVersion) return;
    if (window.foxtext && typeof window.foxtext.version === 'function') {
      refreshVersion();
      return;
    }
    if (versionTries >= 10) return;
    versionTries += 1;
    window.setTimeout(ensureVersion, 400);
  }

  /* ------------------------------ about dialog ---------------------------- */

  /* The root button that opened the dialog, so the focus can go back to it
     when the dialog closes (closeMenubar() clears menuState.trigger). */
  var aboutOpener = null;

  function showAbout(opener) {
    if (!els.aboutModal) return;
    aboutOpener = opener || null;
    els.aboutVersion.textContent = t('set.version', { v: appVersion || '—' });
    els.aboutModal.hidden = false;
    if (els.aboutOk && typeof els.aboutOk.focus === 'function') els.aboutOk.focus();
  }

  function closeAbout(restoreFocus) {
    if (!els.aboutModal || els.aboutModal.hidden) return;
    els.aboutModal.hidden = true;
    var opener = aboutOpener;
    aboutOpener = null;
    if (restoreFocus && opener && opener.isConnected && typeof opener.focus === 'function') {
      opener.focus();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Input pipeline                                                     */
  /* ------------------------------------------------------------------ */

  function handleInput() {
    state.isSample = false;
    /* dirty is derived from the last saved snapshot so that undoing back to
       the saved text clears the indicator again */
    markDirty(els.editor.value !== state.lastSaved);
    scheduleRender();
    scheduleDraft();
    updateCurrentLine();
    if (state.view === 'preview') updateStats();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */

  function cacheElements() {
    els.workspace = byId('workspace');
    els.sidebar = byId('sidebar');
    els.outline = byId('outline');
    els.editor = byId('editor');
    els.preview = byId('preview');
    els.previewPane = byId('previewPane');
    els.editorPane = byId('editorPane');
    els.gutter = byId('gutter');
    els.currentLine = byId('currentLine');
    els.resizer = byId('resizer');
    els.docName = byId('docName');
    els.docDot = byId('docDot');
    els.toasts = byId('toasts');
    els.draftBanner = byId('draftBanner');
    els.draftMsg = byId('draftMsg');
    els.stCursor = byId('stCursor');
    els.stWords = byId('stWords');
    els.stChars = byId('stChars');
    els.stLines = byId('stLines');
    els.stReading = byId('stReading');
    els.stSave = byId('stSave');
    els.stTheme = byId('stTheme');
    els.exportMenu = byId('exportMenu');
    els.btnExport = byId('btnExport');
    els.langSelect = byId('langSelect');
    els.settingsWrap = byId('settingsWrap');
    els.btnSettings = byId('btnSettings');
    els.settingsMenu = byId('settingsMenu');
    els.miStats = byId('miStats');
    els.miVersion = byId('miVersion');
    els.menubar = byId('menubar');
    els.updateBar = byId('updateBar');
    els.updateText = byId('updateText');
    els.updateAction = byId('updateAction');
    els.updateClose = byId('updateClose');
    els.mbScroll = byId('mbScroll');
    els.mbDrop = byId('mbDrop');
    els.aboutModal = byId('aboutModal');
    els.aboutVersion = byId('aboutVersion');
    els.aboutOk = byId('aboutOk');
  }

  function buildLanguageSelect() {
    var html = [];
    for (var i = 0; i < I18N.langs.length; i += 1) {
      var code = I18N.langs[i];
      html.push('<option value="' + code + '">' + escapeText(I18N.nativeNames[code]) + '</option>');
    }
    els.langSelect.innerHTML = html.join('');
    els.langSelect.value = state.lang;
    els.langSelect.addEventListener('change', function () {
      setLanguage(els.langSelect.value, true);
    });
  }

  function setLanguage(lang, announce) {
    if (I18N.langs.indexOf(lang) === -1) return;
    var wasSample = !state.dirty && state.isSample;
    state.lang = lang;
    writeLS(LS.lang, lang);
    if (wasSample) {
      els.editor.value = t('sample');
      state.isSample = true;
    }
    applyI18n();
    measureLineHeight();
    renderNow();
    applyTheme(state.theme, false);
    /* keep the Electron native menu in the same language as the UI */
    if (window.foxtext && typeof window.foxtext.setLang === 'function') {
      try { window.foxtext.setLang(lang); } catch (err) { /* menu stays as-is */ }
    }
    if (announce) toast(t('toast.langChanged'));
  }

  /**
   * Wire up the in-app menu bar.
   *
   * Accessibility: the roots are plain <button>s, so they are reachable with
   * Tab and activated with Enter/Space by the browser itself. Escape closes an
   * open dropdown and hands focus back to its trigger (see
   * handleGlobalKeydown), so the bar can never become a keyboard trap.
   */
  function bindMenubar() {
    if (!els.menubar) return;

    var roots = menuRoots();
    for (var i = 0; i < roots.length; i += 1) {
      (function (btn) {
        var name = btn.getAttribute('data-menu');
        btn.addEventListener('click', function (event) {
          event.stopPropagation();
          toggleMenu(name);
        });
        btn.addEventListener('keydown', function (event) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu(name);
            var first = els.mbDrop.querySelector('.mi:not([disabled])');
            if (first) first.focus();
          }
        });
        /* classic menubar behaviour: once a menu is open, hovering another
           root switches to it instead of requiring a click */
        btn.addEventListener('pointerenter', function () {
          if (isMenuOpen() && menuState.open !== name) openMenu(name);
        });
      })(roots[i]);
    }

    els.mbDrop.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('.mi') : null;
      if (!item || item.disabled) return;
      /* keep the root button around: the About dialog hands the focus back to
         it when it closes, and closeMenubar() drops the reference */
      var trigger = menuState.trigger;
      /* the dropdown must close before the command runs, otherwise a dialog
         raised by the command would sit behind an open menu */
      closeMenubar(false);
      runMenuCommand(item, trigger);
    });

    els.mbDrop.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeMenubar(true);
    });

    /* Window resize invalidates the dropdown's computed `left` offset. */
    window.addEventListener('resize', function () {
      if (isMenuOpen()) closeMenubar(false);
    });

    if (els.aboutOk) {
      els.aboutOk.addEventListener('click', function () { closeAbout(true); });
    }
    els.aboutModal.addEventListener('click', function (event) {
      /* clicks on the backdrop (never on the card) dismiss the dialog */
      if (event.target === els.aboutModal) closeAbout(true);
    });
  }

  function bindEvents() {
    els.editor.addEventListener('input', handleInput);
    els.editor.addEventListener('keydown', handleEditorKeydown);
    els.editor.addEventListener('click', function () {
      updateCurrentLine();
      refreshStatus();
    });
    els.editor.addEventListener('keyup', function () {
      updateCurrentLine();
      refreshStatus();
    });
    els.editor.addEventListener('select', refreshStatus);
    els.editor.addEventListener('scroll', function () {
      els.gutter.scrollTop = els.editor.scrollTop;
      updateCurrentLine();
      syncEditorToPreview();
    });

    els.previewPane.addEventListener('scroll', function () {
      syncPreviewToEditor();
      updateActiveHeading();
    });

    els.outline.addEventListener('click', onOutlineClick);

    var segs = document.querySelectorAll('#viewGroup .seg');
    for (var i = 0; i < segs.length; i += 1) {
      segs[i].addEventListener('click', function (event) {
        applyView(event.currentTarget.getAttribute('data-view'));
      });
    }

    byId('btnNew').addEventListener('click', newDocument);
    byId('btnOpen').addEventListener('click', openDocument);
    byId('btnSave').addEventListener('click', function () { saveDocument(false); });
    byId('btnSaveAs').addEventListener('click', function () { saveDocument(true); });
    byId('btnTheme').addEventListener('click', toggleTheme);
    byId('btnBold').addEventListener('click', function () { els.editor.focus(); wrapSelection('**', 'bold'); });
    byId('btnItalic').addEventListener('click', function () { els.editor.focus(); wrapSelection('*', 'italic'); });
    byId('btnLink').addEventListener('click', function () { els.editor.focus(); insertLink(); });
    byId('btnInlineCode').addEventListener('click', function () { els.editor.focus(); wrapSelection('`', 'code'); });
    byId('btnSidebar').addEventListener('click', function () { applySidebar(!state.sidebarOpen); });
    byId('btnFocus').addEventListener('click', function () { applyFocus(!state.focus); });

    els.btnExport.addEventListener('click', toggleExportMenu);
    els.exportMenu.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('.menu-item') : null;
      if (!item) return;
      closeExportMenu();
      exportDocument(item.getAttribute('data-export'));
    });
    document.addEventListener('click', function (event) {
      if (!els.exportMenu.hidden) {
        var wrap = byId('exportWrap');
        if (!wrap.contains(event.target)) closeExportMenu();
      }
      if (!els.settingsMenu.hidden && !els.settingsWrap.contains(event.target)) {
        closeSettingsMenu();
      }
      /* a click anywhere outside the bar closes an open dropdown */
      if (isMenuOpen() && els.menubar && !els.menubar.contains(event.target)) {
        closeMenubar(false);
      }
    });

    els.btnSettings.addEventListener('click', toggleSettingsMenu);
    els.miStats.addEventListener('click', function () {
      setStats(els.miStats.getAttribute('aria-checked') !== 'true');
    });

    byId('btnRestore').addEventListener('click', restoreDraft);
    byId('btnDiscard').addEventListener('click', discardDraft);

    document.addEventListener('keydown', handleGlobalKeydown);
    if (narrowMedia) {
      if (typeof narrowMedia.addEventListener === 'function') {
        narrowMedia.addEventListener('change', syncNarrow);
      } else if (typeof narrowMedia.addListener === 'function') {
        /* Safari < 14 */
        narrowMedia.addListener(syncNarrow);
      }
    }
    window.addEventListener('resize', function () {
      measureLineHeight();
      updateGutter();
      updateCurrentLine();
    });
    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });

    /* In Electron the preload already ran, so the version is available right
       away; on Lite it may still be on its way, hence ensureVersion(). */
    ensureVersion();
    if (!window.foxtext) {
      appVersion = '';
      els.miVersion.textContent = t('set.version', { v: '—' });
    }

    bindMenubar();

    /* pywebview hands its API over slightly after DOMContentLoaded, so on that
       host the boot-time beacon has to wait for the bridge to appear. In
       Electron the preload already ran, so this event simply never fires and
       the beacon went out during boot() — sendStats() is idempotent either way. */
    window.addEventListener('foxtext:ready', function () {
      sendStats('start');
      ensureVersion();
      /* the bridge just gained its methods (e.g. quit), so an open menu may
         need one more item */
      refreshMenubar();
    });

    /* A host may announce itself after boot() has already run (Lite injects
       the marker into <head>, but a slow bridge attach can still win the
       race), so the bar is re-evaluated whenever the host says who it is. */
    window.addEventListener('foxtext:host', function () {
      ensureMenubar();
      ensureVersion();
    });

    window.addEventListener('foxtext:menu', function (event) {
      var command = event.detail;
      if (command === 'new') newDocument();
      else if (command === 'open') openDocument();
      else if (command === 'save') saveDocument(false);
      else if (command === 'saveAs') saveDocument(true);
      else if (command === 'exportHtml') exportDocument('html');
      else if (command === 'toggle-theme') toggleTheme();
      else if (command === 'toggle-sidebar') applySidebar(!state.sidebarOpen);
    });

    /* Update bar (2.7.0). The HOST does the network check (the renderer's CSP
       forbids requests) and dispatches `foxtext:update` with
       {version, url}. A browser has no bridge, Electron simply never fires
       the event — so in practice only Lite shows the bar. Dismissals are
       remembered per version so the bar does not nag every launch. */
    window.addEventListener('foxtext:update', function (event) {
      var detail = event.detail || {};
      var version = String(detail.version || '');
      var url = String(detail.url || '');
      if (!version || !url) return;
      if (readLS(LS.updateDismissed, '') === version) return;
      showUpdateBar(version, url);
    });
  }

  /* --- update banner --------------------------------------------------- */

  function showUpdateBar(version, url) {
    if (!els.updateBar) return;
    els.updateBar.dataset.url = url;
    els.updateBar.dataset.versionHint = version;
    els.updateText.textContent = t('update.text', { v: version });
    els.updateAction.textContent = t('update.action');
    els.updateBar.hidden = false;
  }

  function closeUpdateBar(remember) {
    if (!els.updateBar) return;
    els.updateBar.hidden = true;
    if (remember) {
      /* keep the dismissed version around; a newer one re-shows the bar */
      writeLS(LS.updateDismissed, els.updateBar.dataset.versionHint || '');
    }
  }

  function bindUpdateBar() {
    if (!els.updateBar) return;
    els.updateAction.addEventListener('click', function () {
      var url = els.updateBar.dataset.url || '';
      /* Lite hands the URL to the OS default browser; a browser host opens a
         new tab; Electron never shows this bar */
      if (window.foxtext && typeof window.foxtext.openExternal === 'function') {
        try { window.foxtext.openExternal(url); } catch (err) { /* stay put */ }
      } else {
        window.open(url, '_blank', 'noopener');
      }
    });
    els.updateClose.addEventListener('click', function () {
      closeUpdateBar(true);
    });
    /* remember which version the user dismissed (shown-version hint set in
       showUpdateBar via dataset) */
  }

  function initAppearance() {
    /* resolve the layout mode first: applySidebar() behaves differently in the
       narrow (overlay drawer) and wide (docked panel) layouts */
    document.body.classList.toggle('is-narrow', !!(narrowMedia && narrowMedia.matches));

    var savedTheme = readLS(LS.theme, '');
    applyTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark', false);

    var savedView = readLS(LS.view, 'split');
    applyView(savedView);

    var savedRatio = parseFloat(readLS(LS.split, '0.5'));
    applyRatio(isNaN(savedRatio) ? 0.5 : savedRatio);

    sidebarPref = readLS(LS.sidebar, '1') !== '0';
    /* the drawer always starts closed on narrow screens, so the very first
       click on the toggle opens it (button state matches visibility) */
    applySidebar(isNarrow() ? false : sidebarPref);
  }

  function boot() {
    cacheElements();

    var savedLang = readLS(LS.lang, '');
    state.lang = I18N.langs.indexOf(savedLang) !== -1 ? savedLang : I18N.detect();

    buildLanguageSelect();
    initAppearance();

    /* decide (and keep deciding) whether this host needs the in-app menu bar */
    ensureMenubar();

    measureLineHeight();

    var draft = readDraft();
    els.editor.value = t('sample');
    state.isSample = true;
    state.dirty = false;

    applyI18n();
    /* applyI18n() re-applies static tooltips, so the theme button (whose label
       depends on the current theme) is refreshed once more afterwards */
    applyTheme(state.theme, false);
    /* sync the Electron native menu with the language restored from storage */
    if (window.foxtext && typeof window.foxtext.setLang === 'function') {
      try { window.foxtext.setLang(state.lang); } catch (err) { /* menu stays as-is */ }
    }
    renderNow();
    initResizer();
    bindEvents();
    bindUpdateBar();

    if (draft) showDraftBanner(draft);

    updateCurrentLine();
    refreshStatus();
    refreshDocTitle();

    /* reflect the stored opt-out state, then fire one anonymous beacon */
    els.miStats.setAttribute('aria-checked', statsEnabled() ? 'true' : 'false');
    sendStats('start');

    /* Focus policy (a11y): the editor is deliberately NOT auto-focused.
       Starting on <body> means the first Tab reaches the toolbar and only then
       the editor, and Escape inside the editor blurs it again, so the textarea
       is never a keyboard trap. A pending draft banner always wins, since it
       needs an answer first. */
    els.editor.setSelectionRange(0, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
