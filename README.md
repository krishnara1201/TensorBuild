# TensorBuild

TensorBuild is a cross-platform desktop app for building machine learning
pipelines visually. Drag nodes onto a canvas — load data, preprocess,
split train/test, train a model, evaluate it — and run the pipeline
in-app, or export it as a standalone, dependency-free `.py` script that
runs with no TensorBuild install at all.

## Features

- **Visual pipeline canvas** — connect data, preprocessing, model, and
  evaluation nodes into a DAG; no code required to get a working pipeline.
- **Same DAG, two outputs** — the exact pipeline you build runs live in the
  app *and* exports to a plain Python script, so what you see is what you
  ship.
- **scikit-learn and PyTorch nodes** — linear/logistic regression, random
  forest, SVM, k-means, and PyTorch layers (Conv2D, Linear, BatchNorm2D,
  transfer-learning backbones) with training/evaluation nodes for both.
- **Live data preview** — inspect a node's output table (columns, dtypes,
  sampled rows) without running the whole pipeline.
- **Plugin node system** — new node types are a `manifest.json` + `node.py`
  pair, scanned at startup; no core engine changes required to add one.

## Install

Download the latest installer for your platform from the
[Releases page](../../releases):

- **macOS**: `.dmg`
- **Windows**: `.msi`

These builds are unsigned for now, so macOS Gatekeeper and Windows
SmartScreen will warn on first launch ("unknown publisher") — this is
expected, not a sign of a corrupted download.

## Development

TensorBuild has three parts that run together: a Python/FastAPI **engine**,
a React/Vite **frontend**, and a Rust/Tauri **shell** that wraps both into a
desktop window.

### Engine

```bash
# One-time setup, from the repo root
python3 -m venv .venv
.venv/bin/pip install -e "engine[dev]"

# Run the engine's HTTP API locally, default port 8000
.venv/bin/uvicorn vmb_engine.api:app --reload

# Run the test suite
.venv/bin/pytest engine/tests -v
```

### Frontend

```bash
# From apps/frontend/
npm install
npm run dev      # Vite dev server, default port 5173
npm test         # Vitest
npm run build    # type-check + production build
```

Both the engine and frontend dev servers need to be running for the app to
work end-to-end in a browser.

### Desktop shell (Tauri)

```bash
# One-time setup: Rust toolchain + Tauri CLI + Linux GUI deps
cargo install tauri-cli --version "^2.0.0" --locked

# From apps/shell/src-tauri/ — starts Vite, spawns the engine, opens the
# app window, all in one command
cargo tauri dev
```

See `CLAUDE.md` for the full architecture writeup and the project's
spec/plan development workflow.

## How releases are built

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which for
each platform freezes the Python engine into a standalone binary
(PyInstaller), bundles it into the Tauri app as a sidecar (so end users
need nothing but the installer — no Python required), and attaches the
resulting `.dmg`/`.msi` to a GitHub Release for that tag.

## License

MIT — see [LICENSE](LICENSE).
