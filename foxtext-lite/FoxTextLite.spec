# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('app', 'app')]
binaries = []
hiddenimports = []
tmp_ret = collect_all('pywebview')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('pythonnet')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# ---------------------------------------------------------------------------
# 2.6.0 瘦身（2026-10-22）
#
# 只跑 win-x64：裁掉 pywebview 收集进来的 win-x86 / win-arm64 原生 Loader。
def _keep_x64(pair):
    dest = pair[0].replace('/', '\\').lower()
    return ('win-x86' not in dest) and ('win-arm64' not in dest)

binaries = [b for b in binaries if _keep_x64(b)]
datas = [d for d in datas if _keep_x64(d)]

# 排除与本应用无关的误收依赖（体积大头，共约 10MB）：
#   - cryptography 的 9.45MB rust 扩展（_rust.pyd）：app 只用 urllib，用不到
#   - setuptools：纯构建期，运行时不需要
#   - pefile / PyInstaller：打包器自己的东西
#
# ⚠️ 绝不能排除 libssl-3-x64.dll / libcrypto-3-x64.dll —— _ssl/_hashlib 扩展
#    依赖它们，urllib 的 https 匿名统计上报靠这对 DLL。缺了会**静默失败**
#    （urllib 返回 False 而不报错），所以发布后必须做行为断言：
#    启动 exe → 服务器 stats.db 真落库，而不是只看文件在不在包里。
#
# ⚠️ 不排除 bottle / tornado / cffi：pywebview 依赖链可能条件 import，
#    它们合计不到 1MB，不值得冒破坏风险。
EXCLUDES = [
    'cryptography', 'bcrypt',
    'setuptools', 'pefile',
    'PyInstaller', 'mitmproxy',
    'tkinter', 'pydoc_data', 'unittest', 'test',
]

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDES,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='FoxTextLite',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
