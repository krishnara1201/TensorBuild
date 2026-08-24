# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the TensorBuild engine, frozen into a single-file
# binary that the Tauri shell embeds as a sidecar (see
# apps/shell/src-tauri/tauri.conf.json's bundle.externalBin and
# apps/shell/src-tauri/src/engine.rs). Run from the repo's engine/ dir:
#
#   .venv/bin/pyinstaller packaging/tensorbuild-engine.spec
#
# node.py/manifest.json under vmb_engine/nodes/ are loaded off disk at
# runtime by NodeRegistry (importlib.util.spec_from_file_location), not
# statically imported, so PyInstaller's import analysis can't find them —
# the whole nodes/ tree must ship as bundled data instead.
from PyInstaller.utils.hooks import collect_all

datas = [("../vmb_engine/nodes", "vmb_engine/nodes")]
binaries = []
hiddenimports = []
for pkg in ("torch", "torchvision", "sklearn"):
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

a = Analysis(
    ["../vmb_engine/__main__.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="tensorbuild-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
