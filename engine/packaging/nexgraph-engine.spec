# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec: đóng gói engine thành thư mục onedir dist/nexgraph-engine/.
# Chạy từ thư mục engine/:  uv run pyinstaller packaging/nexgraph-engine.spec --noconfirm
import importlib.metadata as md
import os
import re

from PyInstaller.utils.hooks import collect_all, collect_submodules

ENGINE_DIR = os.path.abspath(os.path.join(SPECPATH, ".."))

datas, binaries, hiddenimports = [], [], []

# Mã bên thứ ba được chép nguyên vào src/ (xem NOTICE); nexgraph_engine là code của nhóm.
for pkg in ("graphify", "nexgraph_engine"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# Mọi binding tree-sitter có trong môi trường (grammar là phần mở rộng biên dịch sẵn, dễ bị bỏ sót).
for dist in md.distributions():
    name = dist.metadata["Name"] or ""
    if re.fullmatch(r"tree[-_]sitter.*", name, re.I):
        module = name.lower().replace("-", "_")
        try:
            d, b, h = collect_all(module)
        except Exception:
            continue
        datas += d
        binaries += b
        hiddenimports += h

hiddenimports += collect_submodules("uvicorn")
# Graphify import các gói export trong thân hàm (F10): khai báo rõ để bản đóng gói có đủ.
hiddenimports += ["matplotlib.backends.backend_agg", "matplotlib.backends.backend_svg", *collect_submodules("scipy.sparse"), *collect_submodules("neo4j"), *collect_submodules("falkordb")]

a = Analysis(
    [os.path.join(ENGINE_DIR, "src", "nexgraph_engine", "cli.py")],
    pathex=[os.path.join(ENGINE_DIR, "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="nexgraph-engine",
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="nexgraph-engine", upx=False)
