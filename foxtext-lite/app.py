#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""FoxText Lite - a lightweight Windows desktop host.

Instead of shipping a Chromium build (the Electron version is ~300 MB), this
host uses the WebView2 runtime that modern Windows already provides, and serves
the *same* renderer sources over a loopback HTTP server.

Why loopback HTTP rather than file:// : Chromium treats file:// as an opaque
origin, so localStorage (draft autosave, language and theme preferences)
silently stops working there. Serving from 127.0.0.1 keeps every existing
browser-side feature intact, including the strict CSP in index.html.

Result: a standalone .exe of roughly 25-40 MB with the exact same features.
"""
from __future__ import annotations

import ctypes
import json
import os
import posixpath
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_VERSION = "2.7.0"
MAX_FILE_BYTES = 8 * 1024 * 1024

# Lowest Windows build we support: 10.0.17763 == Windows 10 1809, the first
# release WebView2 officially runs on. Anything older (7 / 8 / 8.1, or early
# Win10 builds) gets a clear message instead of a blank white window.
MIN_WINDOWS_BUILD = 17763

# Microsoft's official Evergreen Bootstrapper (~1.5 MB online installer).
WEBVIEW2_BOOTSTRAPPER = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

# Client id of the WebView2 Runtime in the Edge update registry hive.
WEBVIEW2_CLIENT_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

# Anonymous usage beacon — same endpoint as the Electron build. The renderer
# cannot reach the network (index.html sets `connect-src 'none'`), so the host
# sends it. Only id / version / OS / language / event kind are transmitted.
BEACON_URL = "https://text.foxnan.com/api/beat.php"

# Update check (2.7.0). The renderer cannot fetch this itself (its CSP is
# `connect-src 'none'`), so the host does it and notifies the page via the
# `foxtext:update` DOM event. Override the endpoint with FOXTEXT_UPDATE_URL
# for testing. Never fatal: any failure is swallowed and simply means
# "no update bar today".
UPDATE_URL = os.environ.get(
    "FOXTEXT_UPDATE_URL", "https://text.foxnan.com/version.json"
)
UPDATE_TIMEOUT = 4  # seconds; small on purpose — this must never delay startup
UPDATE_CHECK_DELAY = 3  # seconds after `loaded`; let the renderer boot first


def _semver_tuple(value) -> tuple:
    """'2.7.0' -> (2, 7, 0); anything unparseable becomes (0, 0, 0) so a
    malformed version string can never look newer than the running build."""
    try:
        parts = str(value).strip().lstrip("vV").split(".")
        return tuple(int(p) for p in parts[:3]) if len(parts) >= 2 else (0, 0, 0)
    except (TypeError, ValueError):
        return (0, 0, 0)
BEACON_TIMEOUT = 4.0


def _field(value, max_len: int) -> str:
    """Trim, strip control characters and clamp one beacon field."""
    text = value if isinstance(value, str) else ""
    text = "".join(ch for ch in text if ch >= " " and ch != "\x7f")
    return text[:max_len]

MD_FILE_TYPES = (
    "Markdown files (*.md;*.markdown;*.txt)",
    "All files (*.*)",
)

# Maps `window.pywebview.api` onto `window.foxtext`, which is the bridge the
# renderer already knows about. Injected into <head> on the fly so the renderer
# sources stay the single source of truth.
#
# It also stamps `window.__foxtextHost = "lite"`. The renderer uses that marker
# to decide whether it must draw its own menu bar: Lite lives in a bare WebView2
# window with no native menu, while Electron already has a real one. The marker
# is set synchronously at the top of the shim (this <head> script only ever
# exists in the Lite host, so its presence is proof enough) and again inside
# attach() for good measure — that way the renderer can read it during boot()
# no matter when pywebview decides to hand over its API.
BRIDGE_SHIM = (
    '<script>'
    '(function(){'
    'window.__foxtextHost = "lite";'
    'function announce(){'
    '  try { window.dispatchEvent(new CustomEvent("foxtext:host")); } catch (e) {}'
    '}'
    'function attach(){'
    '  if (window.pywebview && window.pywebview.api) {'
    '    window.foxtext = window.pywebview.api;'
    '    window.__foxtextHost = "lite";'
    # pywebview hands over its API *after* DOMContentLoaded, so anything that
    # needs the bridge at boot time has to be told about it.
    '    try { window.dispatchEvent(new CustomEvent("foxtext:ready")); } catch (e) {}'
    '    announce();'
    '    return true;'
    '  }'
    '  return false;'
    '}'
    'announce();'
    'if (!attach()) { window.addEventListener("pywebviewready", attach); }'
    '})();'
    '</script>'
).encode("utf-8")

HEAD_TAG = b"<head"


def resource_root() -> Path:
    """Directory that holds index.html + assets/, works frozen and in source."""
    if getattr(sys, "frozen", False):  # packaged by PyInstaller
        return Path(sys._MEIPASS) / "app"
    return Path(__file__).resolve().parent / "app"


class AppRequestHandler(SimpleHTTPRequestHandler):
    """Serves the bundled renderer, injecting the bridge shim into index.html."""

    root = resource_root()
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep the console/打包产物 silent
        return

    def translate_path(self, path: str) -> str:
        # SimpleHTTPRequestHandler expects an OS path; reproduce its decoding
        # but resolve everything under our bundle root.
        path = path.split("#", 1)[0].split("?", 1)[0]
        path = posixpath.normpath(urllib.parse.unquote(path))
        parts = [p for p in path.split("/") if p and p not in (".", "..")]
        return str(Path(self.root, *parts))

    def send_head(self):
        target = os.path.realpath(self.translate_path(self.path))
        # normalise index.html so the shim is inserted exactly once
        if Path(target).name == "index.html" and Path(target).exists():
            try:
                raw = Path(target).read_bytes()
            except OSError:
                return super().send_head()
            lower = raw.lower()
            idx = lower.find(HEAD_TAG)
            if idx != -1:
                end = raw.find(b">", idx)
                if end != -1 and b"pywebview" not in raw[:end]:
                    raw = raw[: end + 1] + BRIDGE_SHIM + raw[end + 1 :]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command == "HEAD":
                return None
            return _BytesReader(raw)
        return super().send_head()


class _BytesReader:
    """File-like view over already-encoded bytes, for SimpleHTTPRequestHandler."""

    def __init__(self, data: bytes):
        from io import BytesIO

        self._buf = BytesIO(data)

    def read(self, *args):
        return self._buf.read(*args)

    def close(self):
        self._buf.close()


class LoopbackHTTPServer(ThreadingHTTPServer):
    """Keeps the console clean: WebView2 drops keep-alive sockets all the time."""

    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError)):
            return
        ThreadingHTTPServer.handle_error(self, request, client_address)


def start_server() -> str:
    """Serve the renderer on a random loopback port; return the index URL."""
    handler = AppRequestHandler
    handler.root = str(resource_root())
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    server = LoopbackHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{port}/index.html"


def read_text(path: str) -> str:
    """Read a text file, normalising newlines (mirrors the Electron host)."""
    data = Path(path).read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gbk", "utf-16"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode("utf-8", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _webview_module():
    """Import pywebview lazily.

    @return the pywebview module, or None when it is not installed. The api
            object may be created in environments without pywebview (unit
            tests, tooling), so every bridge method has to degrade gracefully
            instead of raising ModuleNotFoundError.
    """
    try:
        import webview

        return webview
    except Exception:
        return None


class FoxTextApi:
    """Exposed to JavaScript as `window.foxtext`."""

    # ---------------- file dialogs ----------------
    def openFile(self):
        webview = _webview_module()
        if webview is None:
            return {"canceled": True}

        window = webview.windows[0] if webview.windows else None
        result = (
            window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=False,
                file_types=MD_FILE_TYPES,
            )
            if window
            else None
        )
        if not result:
            return {"canceled": True}
        target = result[0] if isinstance(result, (list, tuple)) else result
        try:
            if Path(target).stat().st_size > MAX_FILE_BYTES:
                return {"canceled": True, "error": "File is larger than 8 MB"}
            return {
                "canceled": False,
                "path": str(target),
                "content": read_text(str(target)),
            }
        except OSError as exc:
            return {"canceled": True, "error": str(exc)}

    def saveFile(self, content, filePath=None):
        return self._write(content, filePath)

    def saveFileAs(self, content, suggestedName=None):
        webview = _webview_module()
        if webview is None:
            return {"canceled": True}

        window = webview.windows[0] if webview.windows else None
        name = suggestedName or "untitled.md"
        if window:
            target = window.create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(Path.home()),
                save_filename=name,
                file_types=MD_FILE_TYPES,
            )
        else:
            target = None
        if not target:
            return {"canceled": True}
        if isinstance(target, (list, tuple)):
            if not target:
                return {"canceled": True}
            target = target[0]
        return self._write(content, str(target))

    # ---------------- misc ----------------
    def version(self):
        return APP_VERSION

    def quit(self):
        """Close the window and end the process (menu bar > File > Quit).

        pywebview runs every js_bridge_call in its own worker thread, and
        `Window.destroy()` marshals onto the WinForms UI thread via
        Control.Invoke, so calling it from here is thread-safe. It is still
        done on a throwaway thread: `destroy()` closes the form, and we do not
        want the bridge call's own "return value to JS" step to race with a
        window that no longer exists.

        @return {bool} True when a quit request was accepted.
        """
        webview = _webview_module()
        if webview is None:
            return False

        window = webview.windows[0] if webview.windows else None
        if window is None:
            return False

        def _destroy():
            try:
                window.destroy()
            except Exception:
                # Last resort: a window that refuses to close must not leave a
                # zombie process behind.
                try:
                    os._exit(0)
                except Exception:
                    pass

        threading.Thread(target=_destroy, daemon=True).start()
        return True

    def setLang(self, lang=None):
        # pywebview exposes no native menu bar, nothing to rebuild here.
        return APP_VERSION

    def open_external(self, url=None):
        """Open a URL in the user's default browser (update bar uses this).

        Only http/https is accepted — a compromised renderer must not be able
        to make the host open arbitrary schemes (file:, ms-settings:, ...).
        Returns True when the URL was handed to the OS, False otherwise.
        """
        if not isinstance(url, str):
            return False
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return False
        try:
            webbrowser.open(url)
            return True
        except Exception:
            return False

    def beat(self, payload=None):
        """Anonymous launch beacon.

        Mirrors electron/main.js: the renderer is sealed off from the network by
        its own CSP, so the request is made here. Only id / version / OS /
        language / event kind are sent. Returns False when offline or blocked,
        and never raises.
        """
        data = payload if isinstance(payload, dict) else {}
        body = json.dumps(
            {
                "id": _field(data.get("id"), 64),
                "v": _field(data.get("v"), 24),
                "p": _field(data.get("p"), 16),
                "l": _field(data.get("l"), 16),
                "k": _field(data.get("k"), 16) or "start",
            }
        ).encode("utf-8")

        def _post():
            import urllib.error
            import urllib.request

            request = urllib.request.Request(
                BEACON_URL,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=BEACON_TIMEOUT) as resp:
                    return 200 <= getattr(resp, "status", 0) < 300
            except (urllib.error.URLError, OSError, ValueError):
                return False

        # Never block the UI thread for a statistics request.
        threading.Thread(target=_post, daemon=True).start()
        return True

    @staticmethod
    def _write(content, target):
        if not target:
            return {"canceled": True}
        try:
            Path(target).write_text(content or "", encoding="utf-8", newline="")
            return {"canceled": False, "path": str(target)}
        except OSError as exc:
            return {"canceled": True, "error": str(exc)}


# ---------------------------------------------------------------------------
# Startup preflight — Windows version, WebView2 runtime, DPI awareness.
#
# Everything here runs BEFORE the first window exists: on a machine without the
# WebView2 runtime WebView2 simply never initialises, which used to look like a
# blank white window with no explanation. Lite is packaged with console=False,
# so nothing may be printed — user-facing messages go through a native Win32
# MessageBox instead (ctypes only, no tkinter and no extra dependency).
# ---------------------------------------------------------------------------

MB_OK = 0x00000000
MB_YESNO = 0x00000004
MB_ICONERROR = 0x00000010
MB_ICONWARNING = 0x00000030

IDOK = 1
IDYES = 6


def message_box(title: str, text: str, flags: int = MB_OK) -> int:
    """Show a native Win32 message box.

    @param flags MB_* button/style flags
    @return the id of the button that was pressed (1 == OK, 6 == Yes),
            or -1 when no message box could be shown at all.
    """
    try:
        return int(ctypes.windll.user32.MessageBoxW(0, text, title, flags))
    except Exception:
        return -1


def windows_version() -> tuple:
    """@return (major, minor, build) of the running Windows, or (0, 0, 0)."""
    try:
        info = sys.getwindowsversion()
        return (int(info.major), int(info.minor), int(info.build))
    except Exception:
        return (0, 0, 0)


def windows_too_old() -> bool:
    """True when the OS predates the first WebView2-capable Windows 10."""
    major, _minor, build = windows_version()
    if major == 0:
        return False  # not Windows (or unknown) — let the app try anyway
    if major < 10:
        return True  # 7 / 8 / 8.1: WebView2 does not exist there
    return build < MIN_WINDOWS_BUILD


def _registry_has_webview2() -> bool:
    """Probe the EdgeUpdate client hive for the WebView2 Runtime.

    The runtime is registered under WOW6432Node on a 64-bit OS, so every path
    is opened in both the native and the explicitly redirected registry view.
    """
    try:
        import winreg
    except Exception:
        return False

    sub_paths = (
        "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\" + WEBVIEW2_CLIENT_GUID,
        "SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\" + WEBVIEW2_CLIENT_GUID,
    )
    hives = []
    for name in ("HKEY_LOCAL_MACHINE", "HKEY_CURRENT_USER"):
        hive = getattr(winreg, name, None)
        if hive is not None:
            hives.append(hive)
    views = [0]
    for name in ("KEY_WOW64_64KEY", "KEY_WOW64_32KEY"):
        flag = getattr(winreg, name, None)
        if flag is not None:
            views.append(flag)

    for hive in hives:
        for sub_path in sub_paths:
            for view in views:
                try:
                    access = winreg.KEY_READ | view
                    with winreg.OpenKey(hive, sub_path, 0, access) as key:
                        try:
                            value, _kind = winreg.QueryValueEx(key, "pv")
                            if value:
                                return True
                        except OSError:
                            pass
                        # The key itself is already proof that the runtime was
                        # registered; "pv" is only its version string.
                        return True
                except OSError:
                    continue
                except Exception:
                    continue
    return False


def _folder_has_webview2() -> bool:
    """Look for msedgewebview2.exe under the known install directories."""
    for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(var)
        if not base:
            continue
        app_dir = Path(base) / "Microsoft" / "EdgeWebView" / "Application"
        if not app_dir.is_dir():
            continue
        if (app_dir / "msedgewebview2.exe").is_file():
            return True
        try:
            for child in app_dir.iterdir():
                if child.is_dir() and (child / "msedgewebview2.exe").is_file():
                    return True
        except OSError:
            continue
    return False


def has_webview2_runtime() -> bool:
    """True as soon as any probe finds the runtime. Never raises."""
    try:
        if _registry_has_webview2():
            return True
    except Exception:
        pass
    try:
        if _folder_has_webview2():
            return True
    except Exception:
        pass
    return False


def enable_dpi_awareness() -> None:
    """Make the window crisp on HiDPI screens.

    Per-monitor V2 (Win10 1703+) is the best option, then the Win8.1 system
    awareness API, then the older SetProcessDPIAware(). Every step is
    best-effort: a missing API must never keep the app from starting.
    """
    try:
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == -4
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(-4):
            return
    except Exception:
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
        return
    except Exception:
        pass
    try:
        if ctypes.windll.user32.SetProcessDPIAware():
            return
    except Exception:
        pass


def preflight() -> bool:
    """Checks that must pass before the first window is created.

    @return True when the app may continue; False when a message was already
            shown and the process should exit quietly with code 0.
    """
    if os.name != "nt":
        return True

    enable_dpi_awareness()

    if windows_too_old():
        major, minor, build = windows_version()
        message_box(
            "FoxText Lite",
            "FoxText Lite 需要 Windows 10 1809（build 17763）或更高版本。\n\n"
            f"当前系统：Windows {major}.{minor} build {build}\n\n"
            "请升级系统，或改用浏览器直接打开 FoxText 网页版。\n\n"
            "FoxText Lite requires Windows 10 1809 (build 17763) or newer.",
            MB_OK | MB_ICONERROR,
        )
        return False

    if not has_webview2_runtime():
        answer = message_box(
            "FoxText Lite",
            "没有检测到 Microsoft Edge WebView2 运行库。\n"
            "FoxText Lite 依赖它来显示界面，缺少时窗口会是空白的。\n\n"
            "是否现在打开微软官方下载页安装？（在线安装器约 1.5 MB）\n\n"
            "WebView2 Runtime was not found. Open the official download page?",
            MB_YESNO | MB_ICONWARNING,
        )
        if answer == IDYES:
            try:
                webbrowser.open(WEBVIEW2_BOOTSTRAPPER)
            except Exception:
                pass
        return False

    return True


def main() -> None:
    if not preflight():
        return

    try:
        import webview
    except Exception as exc:  # pragma: no cover - packaging problem only
        message_box(
            "FoxText Lite",
            f"界面组件加载失败，程序无法启动。\n\n{exc}",
            MB_OK | MB_ICONERROR,
        )
        return

    try:
        url = start_server()
        api = FoxTextApi()
        window = webview.create_window(
            f"FoxText {APP_VERSION}",
            url=url,
            js_api=api,
            width=1280,
            height=840,
            min_size=(900, 620),
            background_color="#0B0C0E",
            text_select=True,
            confirm_close=False,
        )
    except Exception as exc:
        message_box(
            "FoxText Lite",
            f"窗口创建失败，程序无法启动。\n\n{exc}\n\n"
            "若提示与 WebView2 相关，请先安装 Microsoft Edge WebView2 运行库。",
            MB_OK | MB_ICONERROR,
        )
        return

    # Keyboard shortcuts the Electron build got from its native menu.
    def on_loaded():
        window.evaluate_js(
            r"""
            (function () {
              document.addEventListener('keydown', function (e) {
                var mod = e.ctrlKey || e.metaKey;
                if (!mod) return;
                var map = {
                  'n': 'new', 'o': 'open', 's': e.shiftKey ? 'saveAs' : 'save',
                  'b': 'bold', 'i': 'italic', 'k': 'link'
                };
                var cmd = map[e.key.toLowerCase()];
                if (!cmd) return;
                var handled = ['new', 'open', 'save', 'saveAs'].indexOf(cmd) >= 0;
                if (!handled) return;               // text shortcuts already exist
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('foxtext:menu', { detail: cmd }));
              });
            })();
            """
        )
        # Belt and braces: the host marker is injected into <head>, but if the
        # page ever reloads in a way that loses it, re-stamp it here so the
        # in-app menu bar reappears.
        window.evaluate_js(
            r"""
            (function () {
              try {
                if (window.__foxtextHost !== 'lite') {
                  window.__foxtextHost = 'lite';
                  window.dispatchEvent(new CustomEvent('foxtext:host'));
                }
              } catch (e) {}
            })();
            """
        )

    window.events.loaded += on_loaded

    # Update check (2.7.0): fetch version.json in a daemon thread and, if
    # a newer build exists, notify the renderer via `foxtext:update`. The
    # renderer decides how to present it; a browser host simply never
    # fires this event, so the bar stays hidden there.
    def check_update():
        try:
            time.sleep(UPDATE_CHECK_DELAY)
            request = urllib.request.Request(
                UPDATE_URL, headers={"Accept": "application/json"}
            )
            with urllib.request.urlopen(request, timeout=UPDATE_TIMEOUT) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            remote = payload.get("version")
            if _semver_tuple(remote) <= _semver_tuple(APP_VERSION):
                return
            target = payload.get("url") or (
                "https://github.com/foxnangang/foxtext/releases/latest"
            )
            if not (
                isinstance(target, str)
                and urllib.parse.urlparse(target).scheme in ("http", "https")
            ):
                return
            detail = json.dumps({"version": str(remote), "url": target})
            window.evaluate_js(
                "window.dispatchEvent(new CustomEvent('foxtext:update',"
                f" {{ detail: {detail} }}));"
            )
        except Exception:
            return  # offline, malformed JSON, window already gone — stay quiet

    threading.Thread(target=check_update, daemon=True).start()

    try:
        webview.start(private_mode=False)
    except Exception as exc:
        message_box(
            "FoxText Lite",
            f"启动失败，程序即将退出。\n\n{exc}\n\n"
            "若提示与 WebView2 相关，请先安装 Microsoft Edge WebView2 运行库。",
            MB_OK | MB_ICONERROR,
        )


if __name__ == "__main__":
    main()
