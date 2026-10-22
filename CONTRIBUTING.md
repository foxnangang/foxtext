# Contributing to FoxText

Thanks for your interest! FoxText is a young project and every kind of contribution is welcome — bug reports, translations, documentation, and code.

## The one rule that matters most

**The renderer layer is shared by three hosts and must never be forked.**

```
foxtext-app/index.html + assets/     ← single source of truth
foxtext-lite/app/                    ← byte-identical copy (cp, no edits)
Electron dist/resources/app/         ← byte-identical copy (cp, no edits)
```

If your change touches `foxtext-app/`, re-sync the copies and verify they are byte-identical:

```bash
cp foxtext-app/index.html foxtext-lite/app/index.html
cp foxtext-app/assets/css/app.css        foxtext-lite/app/assets/css/app.css
cp foxtext-app/assets/js/app.js          foxtext-lite/app/assets/js/app.js
cp foxtext-app/assets/js/i18n.js         foxtext-lite/app/assets/js/i18n.js
cp foxtext-app/assets/js/markdown.js     foxtext-lite/app/assets/js/markdown.js
md5sum foxtext-app/assets/js/app.js foxtext-lite/app/assets/js/app.js   # must match
```

## i18n

All user-facing strings live in `foxtext-app/assets/js/i18n.js` (zh-CN / en / ja).
The three dictionaries must stay **strictly symmetric** — if you add a key, add it to
all three languages, then verify:

```bash
node -e "const d=require('./foxtext-app/assets/js/i18n.js'); /* compare key sets */"
```

## Building

- **Browser / Electron**: see the root README (`npm install && npm start`).
- **FoxText Lite**: `PyInstaller FoxTextLite.spec` — do **not** remove
  `libssl-3-x64.dll` / `libcrypto-3-x64.dll` from the bundle; the anonymous
  statistics beacon breaks *silently* without them. After repacking, verify
  behaviourally (launch the exe and confirm the server records a heartbeat),
  not just by checking the file exists in the archive.

## Reporting bugs

Open an issue with: OS version, host (browser / Lite / Electron), steps to reproduce,
expected vs actual. Screenshots welcome.
