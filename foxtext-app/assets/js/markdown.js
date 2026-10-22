/* =============================================================================
 * FoxText — markdown.js  (v2.7.0)
 * -----------------------------------------------------------------------------
 * A dependency-free Markdown engine (block parser + inline parser + sanitizer).
 * No CDN, no npm packages, no DOM access: safe to run in a browser <script>,
 * in a Web Worker, or under Node (`require('./assets/js/markdown.js')`).
 *
 * Public API
 *   FoxMarkdown.parse(src, opts) -> string(html)      opts: { sanitize: true }
 *   FoxMarkdown.toc(src)         -> Array<{level,text,id}>
 *   FoxMarkdown.outline(src)     -> Array<{level,text,id,line}>   (extension)
 *
 * Supported syntax
 *   ATX headings (id slugs, duplicate suffix), paragraphs + hard breaks,
 *   bold / italic / bold-italic / strikethrough (both * and _ forms),
 *   inline code, fenced code blocks (``` and ~~~, unclosed tolerated),
 *   blockquotes (nested), nested ordered/unordered lists, GFM task lists,
 *   GFM tables with three alignments, thematic breaks, links (inline + title),
 *   autolinks (<url> and bare http/https), images, backslash escapes,
 *   a small allow-list of inline HTML tags (attributes are always dropped).
 *
 * Not supported (by design, documented in README.md)
 *   setext headings, indented (4-space) code blocks, reference-style links,
 *   footnotes, raw HTML blocks, HTML entities beyond escaping.
 * ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.FoxMarkdown = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '2.7.0';

  /* --------------------------------------------------------------------- */
  /* Escaping helpers                                                      */
  /* --------------------------------------------------------------------- */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var ATTR_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return ESC_MAP[ch];
    });
  }

  function escapeAttr(value) {
    return String(value).replace(/[&<>"'`]/g, function (ch) {
      return ATTR_MAP[ch];
    });
  }

  /* --------------------------------------------------------------------- */
  /* URL safety                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * Returns a URL that is safe to place into href/src, or null when the scheme
   * is dangerous (javascript:, vbscript:, data:text/html, ...).
   * Relative paths, fragments, http(s), mailto, tel are allowed.
   * @param {string} url raw url from markdown source
   * @param {string} kind 'link' | 'image'
   * @return {?string}
   */
  function safeUrl(url, kind) {
    var raw = String(url == null ? '' : url).trim();
    if (!raw) return null;
    if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
    var probe = raw.toLowerCase().replace(/[\s\u0000-\u001f]/g, '');
    if (/^(javascript|vbscript|file|blob|about):/.test(probe)) return null;
    if (probe.indexOf('data:') === 0) {
      if (kind === 'image' && /^data:image\/(png|jpe?g|gif|webp|avif);base64,/.test(probe)) {
        return raw;
      }
      return null;
    }
    return raw;
  }

  /* --------------------------------------------------------------------- */
  /* Slugs / TOC                                                           */
  /* --------------------------------------------------------------------- */

  /** Strip inline markdown syntax and return readable plain text. */
  function plainText(md) {
    var s = String(md == null ? '' : md);
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/`([^`]*)`/g, '$1');
    s = s.replace(/<[^<>]*>/g, '');
    s = s.replace(/[*_~]/g, '');
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/g, '$1');
    return s.trim();
  }

  /**
   * Slugify heading text: lowercase, punctuation removed, whitespace -> '-'.
   * CJK characters are preserved as-is.
   */
  function slugify(text) {
    var s = plainText(text).toLowerCase();
    s = s.replace(/[\u0000-\u001f\u007f]/g, '');
    s = s.replace(/[\s\u00a0]+/g, '-');
    s = s.replace(/[!"#$%&'()*+,.\/:;<=>?@\[\\\]^`{|}~]/g, '');
    s = s.replace(/-{2,}/g, '-');
    s = s.replace(/^-+|-+$/g, '');
    return s || 'section';
  }

  function uniqueSlug(ctx, base) {
    var count = ctx.slugCounts[base];
    if (count == null) {
      ctx.slugCounts[base] = 1;
      return base;
    }
    var next = base + '-' + count;
    ctx.slugCounts[base] = count + 1;
    while (ctx.slugCounts[next] != null) {
      count += 1;
      ctx.slugCounts[base] = count;
      next = base + '-' + count;
    }
    ctx.slugCounts[next] = 1;
    return next;
  }

  /* --------------------------------------------------------------------- */
  /* Inline parser                                                         */
  /* --------------------------------------------------------------------- */

  var BR_MARK = '\u0001';
  var SPECIAL = { '\\': 1, '`': 1, '[': 1, '!': 1, '<': 1, '*': 1, '_': 1, '~': 1 };
  var ALLOWED_TAGS = {
    b: 1, i: 1, em: 1, strong: 1, code: 1, del: 1, ins: 1, mark: 1,
    kbd: 1, sub: 1, sup: 1, u: 1, s: 1, small: 1, span: 1, abbr: 1, br: 1
  };

  /** Find the closing position for an emphasis delimiter. Returns -1. */
  function findCloser(src, from, delim) {
    var len = delim.length;
    var idx = from;
    while (idx < src.length) {
      var pos = src.indexOf(delim, idx);
      if (pos === -1) return -1;
      if (pos > 0 && src.charAt(pos - 1) === '\\') {
        idx = pos + len;
        continue;
      }
      if (len === 1) {
        if (src.charAt(pos + 1) === delim) { idx = pos + 1; continue; }
        if (src.charAt(pos - 1) === delim) { idx = pos + len; continue; }
      }
      if (len === 3) {
        if (src.charAt(pos + 3) === delim) { idx = pos + 3; continue; }
      }
      var content = src.slice(from, pos);
      if (!content) { idx = pos + len; continue; }
      if (/^\s/.test(content) || /\s$/.test(content)) { idx = pos + len; continue; }
      return pos;
    }
    return -1;
  }

  var EMPHASIS = [
    { d: '***', open: '<strong><em>', close: '</em></strong>' },
    { d: '___', open: '<strong><em>', close: '</em></strong>', underscore: true },
    { d: '**', open: '<strong>', close: '</strong>' },
    { d: '__', open: '<strong>', close: '</strong>', underscore: true },
    { d: '~~', open: '<del>', close: '</del>' },
    { d: '*', open: '<em>', close: '</em>' },
    { d: '_', open: '<em>', close: '</em>', underscore: true }
  ];

  function isWordChar(ch) {
    return !!ch && /[0-9A-Za-z\u00c0-\uffff]/.test(ch);
  }

  /** Parse the "(url "title")" tail of an inline link starting at `open`. */
  function parseLinkTail(src, open) {
    var depth = 0;
    var i = open;
    var close = -1;
    for (; i < src.length; i += 1) {
      var ch = src.charAt(i);
      if (ch === '\\') { i += 1; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) return null;
    var inner = src.slice(open + 1, close).trim();
    var href = '';
    var title = null;
    var angle = /^<([^<>]*)>/.exec(inner);
    if (angle) {
      href = angle[1];
      var rest = inner.slice(angle[0].length).trim();
      var t1 = /^("([\s\S]*)"|'([\s\S]*)'|\(([\s\S]*)\))$/.exec(rest);
      if (t1) title = t1[2] != null ? t1[2] : t1[3] != null ? t1[3] : t1[4];
    } else {
      var m = /^(\S*?)(?:\s+("([\s\S]*)"|'([\s\S]*)'|\(([\s\S]*)\)))?\s*$/.exec(inner);
      if (m) {
        href = m[1] || '';
        if (m[3] != null) title = m[3];
        else if (m[4] != null) title = m[4];
        else if (m[5] != null) title = m[5];
      } else {
        href = inner;
      }
    }
    return { href: href, title: title, end: close + 1 };
  }

  /** Locate the matching ']' for a '[' at index `open`. */
  function findBracketClose(src, open) {
    var depth = 0;
    for (var i = open; i < src.length; i += 1) {
      var ch = src.charAt(i);
      if (ch === '\\') { i += 1; continue; }
      if (ch === '`') {
        var run = 0;
        while (src.charAt(i + run) === '`') run += 1;
        var fence = new Array(run + 1).join('`');
        var codeEnd = src.indexOf(fence, i + run);
        if (codeEnd !== -1) { i = codeEnd + run - 1; continue; }
      }
      if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Parse inline markdown into HTML.
   * Every character coming from the source is escaped before being emitted;
   * the only raw HTML produced by this function is generated by the parser.
   */
  function parseInline(src) {
    var out = [];
    var i = 0;
    var n = src.length;
    var plainStart = 0;

    function flushPlain(upTo) {
      if (upTo > plainStart) out.push(escapeHtml(src.slice(plainStart, upTo)));
    }

    while (i < n) {
      var ch = src.charAt(i);

      /* hard line break marker */
      if (ch === BR_MARK) {
        flushPlain(i);
        out.push('<br>');
        i += 1;
        plainStart = i;
        continue;
      }

      /* backslash escape */
      if (ch === '\\') {
        var next = src.charAt(i + 1);
        if (next && /[\\`*_{}\[\]()#+\-.!>|~"']/.test(next)) {
          flushPlain(i);
          out.push(escapeHtml(next));
          i += 2;
          plainStart = i;
          continue;
        }
        i += 1;
        continue;
      }

      /* inline code */
      if (ch === '`') {
        var run = 0;
        while (src.charAt(i + run) === '`') run += 1;
        var fence = new Array(run + 1).join('`');
        var end = src.indexOf(fence, i + run);
        if (end !== -1) {
          var code = src.slice(i + run, end);
          if (code.length > 2 && code.charAt(0) === ' ' && code.charAt(code.length - 1) === ' ' && code.trim()) {
            code = code.slice(1, -1);
          }
          flushPlain(i);
          out.push('<code>' + escapeHtml(code) + '</code>');
          i = end + run;
          plainStart = i;
          continue;
        }
        i += run;
        continue;
      }

      /* image */
      if (ch === '!' && src.charAt(i + 1) === '[') {
        var imgClose = findBracketClose(src, i + 1);
        if (imgClose !== -1 && src.charAt(imgClose + 1) === '(') {
          var imgTail = parseLinkTail(src, imgClose + 1);
          if (imgTail) {
            var imgSrc = safeUrl(imgTail.href, 'image');
            flushPlain(i);
            if (imgSrc) {
              out.push(
                '<img src="' + escapeAttr(imgSrc) + '" alt="' +
                escapeAttr(plainText(src.slice(i + 2, imgClose))) + '"' +
                (imgTail.title ? ' title="' + escapeAttr(imgTail.title) + '"' : '') +
                ' loading="lazy">'
              );
            } else {
              /* dangerous protocol: never emit an <img>, only the alt text */
              out.push(escapeHtml(plainText(src.slice(i + 2, imgClose))));
            }
            i = imgTail.end;
            plainStart = i;
            continue;
          }
        }
      }

      /* inline link */
      if (ch === '[') {
        var linkClose = findBracketClose(src, i);
        if (linkClose !== -1 && src.charAt(linkClose + 1) === '(') {
          var tail = parseLinkTail(src, linkClose + 1);
          if (tail) {
            var href = safeUrl(tail.href, 'link');
            var label = parseInline(src.slice(i + 1, linkClose));
            flushPlain(i);
            if (href) {
              out.push(
                '<a href="' + escapeAttr(href) + '"' +
                (tail.title ? ' title="' + escapeAttr(tail.title) + '"' : '') +
                ' target="_blank" rel="noopener noreferrer">' + label + '</a>'
              );
            } else {
              out.push(label);
            }
            i = tail.end;
            plainStart = i;
            continue;
          }
        }
      }

      /* autolink <scheme:...> and allow-listed raw inline tags */
      if (ch === '<') {
        var auto = /^<([A-Za-z][A-Za-z0-9+.\-]{1,31}:[^<>\s]*)>/.exec(src.slice(i, i + 512));
        if (auto) {
          var autoHref = safeUrl(auto[1], 'link');
          flushPlain(i);
          if (autoHref) {
            out.push('<a href="' + escapeAttr(autoHref) + '" target="_blank" rel="noopener noreferrer">' +
              escapeHtml(auto[1]) + '</a>');
          } else {
            out.push(escapeHtml(auto[0]));
          }
          i += auto[0].length;
          plainStart = i;
          continue;
        }
        var tag = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(src.slice(i, i + 512));
        if (tag) {
          var tagName = tag[2].toLowerCase();
          flushPlain(i);
          if (ALLOWED_TAGS[tagName]) {
            /* attributes are intentionally dropped: no on*, no style, no href */
            if (tagName === 'br') {
              out.push('<br>');
            } else if (tag[1] === '/') {
              out.push('</' + tagName + '>');
            } else {
              out.push('<' + tagName + '>');
            }
          } else {
            out.push(escapeHtml(tag[0]));
          }
          i += tag[0].length;
          plainStart = i;
          continue;
        }
      }

      /* emphasis family */
      if (ch === '*' || ch === '_' || ch === '~') {
        var matched = false;
        for (var e = 0; e < EMPHASIS.length; e += 1) {
          var spec = EMPHASIS[e];
          if (src.substr(i, spec.d.length) !== spec.d) continue;
          if (spec.underscore && isWordChar(src.charAt(i - 1))) continue;
          var closeAt = findCloser(src, i + spec.d.length, spec.d);
          if (closeAt === -1) continue;
          if (spec.underscore && isWordChar(src.charAt(closeAt + spec.d.length))) continue;
          var innerSrc = src.slice(i + spec.d.length, closeAt);
          flushPlain(i);
          out.push(spec.open + parseInline(innerSrc) + spec.close);
          i = closeAt + spec.d.length;
          plainStart = i;
          matched = true;
          break;
        }
        if (matched) continue;
        i += 1;
        continue;
      }

      /* bare url autolink */
      if ((ch === 'h' || ch === 'H') && /^https?:\/\//i.test(src.substr(i, 8))) {
        var rest = src.slice(i);
        var urlMatch = /^https?:\/\/[^\s<>"'`\u3000-\u303f\uff01-\uff5e]+/i.exec(rest);
        if (urlMatch) {
          var url = urlMatch[0];
          var trailing = /[.,;:!?)\]]+$/.exec(url);
          if (trailing) url = url.slice(0, url.length - trailing[0].length);
          if (url.length > 8) {
            flushPlain(i);
            out.push('<a href="' + escapeAttr(url) + '" target="_blank" rel="noopener noreferrer">' +
              escapeHtml(url) + '</a>');
            i += url.length;
            plainStart = i;
            continue;
          }
        }
      }

      i += 1;
    }
    flushPlain(n);
    return out.join('');
  }

  /* --------------------------------------------------------------------- */
  /* Block helpers                                                         */
  /* --------------------------------------------------------------------- */

  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
  var RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
  var RE_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
  var RE_QUOTE = /^ {0,3}>/;
  var RE_LIST_ITEM = /^([ \t]*)([-*+]|(\d{1,9})[.)])([ \t]+)([\s\S]*)$/;
  var RE_TASK = /^\[([ xX])\][ \t]+/;

  function expandedIndent(ws) {
    var width = 0;
    for (var i = 0; i < ws.length; i += 1) width += ws.charAt(i) === '\t' ? 4 : 1;
    return width;
  }

  function matchListItem(line) {
    var m = RE_LIST_ITEM.exec(line);
    if (!m) return null;
    var indent = expandedIndent(m[1]);
    if (indent > 11) return null;
    return {
      indent: indent,
      ordered: m[3] != null,
      num: m[3] != null ? parseInt(m[3], 10) : 0,
      text: m[5],
      raw: line
    };
  }

  function indentOf(line) {
    var m = /^[ \t]*/.exec(line);
    return expandedIndent(m ? m[0] : '');
  }

  function stripIndent(line, amount) {
    var removed = 0;
    var i = 0;
    while (i < line.length && removed < amount) {
      var ch = line.charAt(i);
      if (ch === ' ') { removed += 1; i += 1; }
      else if (ch === '\t') { removed += 4; i += 1; }
      else break;
    }
    return line.slice(i);
  }

  function isTableSeparator(line) {
    if (!line || !/\|/.test(line)) return false;
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    if (!s) return false;
    var cells = s.split('|');
    for (var i = 0; i < cells.length; i += 1) {
      if (!/^[ \t]*:?-{1,}:?[ \t]*$/.test(cells[i])) return false;
    }
    return true;
  }

  function isTableStart(lines, i) {
    if (i + 1 >= lines.length) return false;
    if (lines[i].indexOf('|') === -1) return false;
    return isTableSeparator(lines[i + 1]);
  }

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') {
      s = s.slice(0, -1);
    }
    var cells = [];
    var buf = '';
    for (var i = 0; i < s.length; i += 1) {
      var ch = s.charAt(i);
      if (ch === '\\' && s.charAt(i + 1) === '|') { buf += '|'; i += 1; continue; }
      if (ch === '|') { cells.push(buf); buf = ''; continue; }
      buf += ch;
    }
    cells.push(buf);
    return cells.map(function (c) { return c.trim(); });
  }

  function isBlockStart(lines, i) {
    var line = lines[i];
    if (line == null) return true;
    if (/^\s*$/.test(line)) return true;
    if (RE_FENCE.test(line)) return true;
    if (RE_HEADING.test(line)) return true;
    if (RE_HR.test(line)) return true;
    if (RE_QUOTE.test(line)) return true;
    if (matchListItem(line)) return true;
    if (isTableStart(lines, i)) return true;
    return false;
  }

  /** Join paragraph source lines, honouring GFM hard-break rules. */
  function joinParagraph(ls) {
    var raw = ls.join('\n');
    raw = raw.replace(/(?: {2,}|\\)\n/g, BR_MARK);
    raw = raw.replace(/\n/g, ' ');
    return raw;
  }

  /* --------------------------------------------------------------------- */
  /* Block parser                                                          */
  /* --------------------------------------------------------------------- */

  function parseBlocks(lines, ctx, offset) {
    var out = [];
    var i = 0;
    var n = lines.length;
    var base = offset || 0;

    while (i < n) {
      var line = lines[i];

      if (/^\s*$/.test(line)) { i += 1; continue; }

      /* ---- fenced code block ---- */
      var fence = RE_FENCE.exec(line);
      if (fence) {
        var marker = fence[1];
        var markerChar = marker.charAt(0);
        var markerLen = marker.length;
        var info = (fence[2] || '').trim();
        var lang = (info.split(/\s+/)[0] || '').replace(/[^\w+#.\-]/g, '');
        var buf = [];
        i += 1;
        while (i < n) {
          var closeRe = new RegExp('^ {0,3}' + (markerChar === '`' ? '`' : '~') + '{' + markerLen + ',}\\s*$');
          if (closeRe.test(lines[i])) { i += 1; break; }
          buf.push(lines[i]);
          i += 1;
        }
        out.push(
          '<pre><code' + (lang ? ' class="language-' + escapeAttr(lang) + '"' : '') + '>' +
          escapeHtml(buf.join('\n')) + '</code></pre>'
        );
        continue;
      }

      /* ---- ATX heading ---- */
      var heading = RE_HEADING.exec(line);
      if (heading) {
        var level = heading[1].length;
        var rawText = (heading[2] || '').trim();
        var slug = uniqueSlug(ctx, slugify(rawText));
        ctx.headings.push({
          level: level,
          text: plainText(rawText),
          id: slug,
          line: base + i + 1
        });
        out.push('<h' + level + ' id="' + escapeAttr(slug) + '">' + parseInline(rawText) + '</h' + level + '>');
        i += 1;
        continue;
      }

      /* ---- thematic break ---- */
      if (RE_HR.test(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }

      /* ---- blockquote ---- */
      if (RE_QUOTE.test(line)) {
        var quoteLines = [];
        while (i < n) {
          if (RE_QUOTE.test(lines[i])) {
            quoteLines.push(lines[i].replace(/^ {0,3}>[ ]?/, ''));
            i += 1;
            continue;
          }
          if (/^\s*$/.test(lines[i])) {
            /* keep a single blank line when the quote continues after it */
            var k = i + 1;
            while (k < n && /^\s*$/.test(lines[k])) k += 1;
            if (k < n && RE_QUOTE.test(lines[k])) {
              quoteLines.push('');
              i += 1;
              continue;
            }
          }
          break;
        }
        out.push('<blockquote>\n' + parseBlocks(quoteLines, ctx, base + i - quoteLines.length) + '\n</blockquote>');
        continue;
      }

      /* ---- table ---- */
      if (isTableStart(lines, i)) {
        var headerCells = splitRow(lines[i]);
        var sepCells = splitRow(lines[i + 1]);
        var aligns = sepCells.map(function (c) {
          var left = c.charAt(0) === ':';
          var right = c.charAt(c.length - 1) === ':';
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return '';
        });
        var cols = headerCells.length;
        while (aligns.length < cols) aligns.push('');
        i += 2;
        var rows = [];
        while (i < n && !/^\s*$/.test(lines[i]) && lines[i].indexOf('|') !== -1 &&
               !RE_QUOTE.test(lines[i]) && !RE_FENCE.test(lines[i])) {
          if (RE_HEADING.test(lines[i]) || RE_HR.test(lines[i])) break;
          rows.push(splitRow(lines[i]));
          i += 1;
        }
        var tableHtml = ['<table><thead><tr>'];
        for (var h = 0; h < cols; h += 1) {
          tableHtml.push('<th' + (aligns[h] ? ' style="text-align:' + aligns[h] + '"' : '') + '>' +
            parseInline(headerCells[h] || '') + '</th>');
        }
        tableHtml.push('</tr></thead>');
        if (rows.length) {
          tableHtml.push('<tbody>');
          for (var r = 0; r < rows.length; r += 1) {
            tableHtml.push('<tr>');
            for (var c = 0; c < cols; c += 1) {
              tableHtml.push('<td' + (aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '') + '>' +
                parseInline(rows[r][c] != null ? rows[r][c] : '') + '</td>');
            }
            tableHtml.push('</tr>');
          }
          tableHtml.push('</tbody>');
        }
        tableHtml.push('</table>');
        out.push(tableHtml.join(''));
        continue;
      }

      /* ---- list ---- */
      var listItem = matchListItem(line);
      if (listItem) {
        var listResult = parseList(lines, i, ctx, base);
        out.push(listResult.html);
        i = listResult.next;
        continue;
      }

      /* ---- paragraph ---- */
      var paraLines = [line];
      i += 1;
      while (i < n && !/^\s*$/.test(lines[i]) && !isBlockStart(lines, i)) {
        paraLines.push(lines[i]);
        i += 1;
      }
      out.push('<p>' + parseInline(joinParagraph(paraLines)) + '</p>');
    }

    return out.join('\n');
  }

  /**
   * Parse a list starting at `start`. Handles nesting through indentation,
   * ordered/unordered switching, task list checkboxes and loose/tight items.
   */
  function parseList(lines, start, ctx, base) {
    var first = matchListItem(lines[start]);
    var ordered = first.ordered;
    var baseIndent = first.indent;
    var startNum = first.num || 1;
    var items = [];
    var i = start;

    while (i < lines.length) {
      var m = matchListItem(lines[i]);
      if (!m) break;
      if (m.indent !== baseIndent) break;
      if (m.ordered !== ordered) break;

      var itemStart = i;
      var itemLines = [m.text];
      i += 1;

      while (i < lines.length) {
        var raw = lines[i];
        if (/^\s*$/.test(raw)) {
          var k = i + 1;
          while (k < lines.length && /^\s*$/.test(lines[k])) k += 1;
          if (k >= lines.length) break;
          var nm = matchListItem(lines[k]);
          if (nm && nm.indent > baseIndent) { itemLines.push(''); i += 1; continue; }
          if (!nm && indentOf(lines[k]) > baseIndent) { itemLines.push(''); i += 1; continue; }
          if (nm && nm.indent === baseIndent) { i = k; }
          break;
        }
        var nextItem = matchListItem(raw);
        if (nextItem && nextItem.indent === baseIndent) break;
        if (nextItem && nextItem.indent < baseIndent) break;
        if (!nextItem && indentOf(raw) <= baseIndent) break;
        itemLines.push(stripIndent(raw, baseIndent + 2));
        i += 1;
      }

      items.push({ lines: itemLines, offset: itemStart });
    }

    var parts = [];
    var tag = ordered ? 'ol' : 'ul';
    parts.push('<' + tag + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>');

    for (var n = 0; n < items.length; n += 1) {
      var body = items[n].lines.slice();
      var checkbox = '';
      var task = RE_TASK.exec(body[0] || '');
      if (task) {
        checkbox = '<input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '> ';
        body[0] = body[0].slice(task[0].length);
      }
      /* the item body starts at the marker line, so carry its offset down or
         headings nested in a list would report the wrong source line */
      var inner = parseBlocks(body, ctx, base + (items[n].offset || 0));

      /* unwrap a single leading paragraph so tight lists stay compact,
         while nested blocks (sub lists, quotes, code) are preserved */
      if (inner.indexOf('<p>') === 0) {
        var closeP = inner.indexOf('</p>');
        if (closeP !== -1) {
          var tail = inner.slice(closeP + 4);
          if (tail.indexOf('<p>') === -1) {
            inner = inner.slice(3, closeP) + tail;
          }
        }
      }

      if (checkbox) {
        var cbWrap = /^<p>([\s\S]*)<\/p>$/.exec(inner);
        inner = '<label class="task-item">' + checkbox + (cbWrap ? cbWrap[1] : inner) + '</label>';
      }

      parts.push('<li>' + inner + '</li>');
    }
    parts.push('</' + tag + '>');
    return { html: parts.join(''), next: i };
  }

  /* --------------------------------------------------------------------- */
  /* Final sanitizer (defence in depth)                                    */
  /* --------------------------------------------------------------------- */

  /**
   * Removes dangerous tags/attributes from generated HTML.
   * Parser output is already escaped, so this only ever needs to touch REAL
   * tags — escaped user text (`&lt;img …&gt;`) is left byte-for-byte intact so
   * that source fidelity is preserved.
   */
  function sanitizeHtml(html) {
    var s = String(html);
    var dangerous = 'script|style|iframe|object|embed|link|meta|base|form|svg|math|template|noscript|frame|frameset';
    /* 1. drop dangerous elements together with their content */
    s = s.replace(
      new RegExp('<\\s*(' + dangerous + ')\\b[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>', 'gi'),
      ''
    );
    /* 2. drop stray dangerous open/close tags (incl. self-closing) */
    s = s.replace(new RegExp('<\\s*\\/?\\s*(' + dangerous + ')\\b[^>]*>', 'gi'), '');
    /* 3. clean attributes inside the tags that remain */
    s = s.replace(/<[^>]*>/g, function (tag) {
      return tag
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(
          /\s(href|src|xlink:href)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)\s*:[^"']*\2/gi,
          ' $1="#"'
        );
    });
    return s;
  }

  /* --------------------------------------------------------------------- */
  /* Public API                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * Render markdown to HTML.
   * @param {string} src markdown source
   * @param {{sanitize?: boolean}=} opts
   * @return {string}
   */
  function parse(src, opts) {
    var options = opts || {};
    var sanitize = options.sanitize !== false;
    var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    var lines = text.split('\n');
    var ctx = { headings: [], slugCounts: Object.create(null) };
    var html = parseBlocks(lines, ctx, 0);
    return sanitize ? sanitizeHtml(html) : html;
  }

  /**
   * Build the document outline.
   * @param {string} src
   * @return {Array<{level:number, text:string, id:string}>}
   */
  function toc(src) {
    return outline(src).map(function (item) {
      return { level: item.level, text: item.text, id: item.id };
    });
  }

  /**
   * Like toc() but also returns the 1-based source line of each heading.
   * Used by the editor to jump the caret; kept separate so toc() stays minimal.
   */
  function outline(src) {
    var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    var ctx = { headings: [], slugCounts: Object.create(null) };
    parseBlocks(text.split('\n'), ctx, 0);
    return ctx.headings;
  }

  return {
    version: VERSION,
    parse: parse,
    toc: toc,
    outline: outline,
    /* exposed for unit tests / reuse */
    escapeHtml: escapeHtml,
    slugify: slugify
  };
});
