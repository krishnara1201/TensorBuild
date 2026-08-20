# Visual Model Builder — Design Spec

**Date:** 2026-08-20
**Status:** Approved for implementation

## Overview

A cross-platform (Windows + Mac) desktop application, installed off GitHub Releases,
that lets users visually build ML pipelines on a drag-and-drop node canvas: pull data,
build a preprocessing pipeline, create train/test splits, train classical ML models
(scikit-learn) and neural networks (PyTorch), test/evaluate on held-out data, and
export the pipeline as clean, standalone, runnable Python code.

Inspired by [ml_forge](https://github.com/zaina-ml/ml_forge) (a DearPyGui + PyTorch,
image-classification-only node editor), but designed from the start to be
**extendable**: new node types (data sources, preprocessing steps, models, metrics)
are added via a plugin system rather than requiring core code changes, and the
pipeline covers both tabular (sklearn) and image (PyTorch) data rather than only
image classification.

## Goals

- One continuous visual canvas covering the whole pipeline: data → preprocessing →
  split → model → train → test/evaluate — not separate fixed tabs.
- Support both classical ML (scikit-learn: regression, classification, clustering)
  and neural networks (PyTorch: CNNs, transfer learning) on the same canvas.
- Support tabular data (CSV/Excel/Parquet/SQL) and image data (folders, built-in
  datasets like MNIST/CIFAR) in v1.
- Every pipeline can be exported as a standalone `.py` script requiring no app
  dependency to run.
- New node types can be added via a plugin directory (manifest + Python module),
  without touching core code or rebuilding the app.
- Ships as double-click installers (`.dmg`, `.msi`) via GitHub Releases, built by CI.
- Runs fully locally and offline — no server, no account, no internet dependency.

## Non-goals (v1)

- Text/NLP, audio, time series, reinforcement learning node types.
- Remote/cloud training execution.
- A plugin marketplace UI (plugins are installed by dropping a folder in a directory
  for v1; discovery/marketplace is future work).
- Jupyter notebook or multi-file project export (only a single standalone script).
- Multi-user collaboration or cloud project sync.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Tauri Desktop Shell (Rust, thin)                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │  React Frontend                                   │    │
│  │  ┌───────────────┐ ┌──────────────┐ ┌──────────┐ │    │
│  │  │ Node Palette   │ │ React Flow    │ │ Inspector│ │    │
│  │  │ (by category)  │ │ Canvas        │ │ Panel    │ │    │
│  │  └───────────────┘ └──────────────┘ └──────────┘ │    │
│  │  ┌───────────────────────────────────────────┐   │    │
│  │  │ Training Monitor (live loss/acc charts)     │   │    │
│  │  └───────────────────────────────────────────┘   │    │
│  └────────────────────┬──────────────────────────────┘    │
│                        │ loopback HTTP (CRUD, codegen) +   │
│                        │ WebSocket (training progress)     │
│  ┌─────────────────────▼──────────────────────────────┐   │
│  │  Python Engine (FastAPI, bundled via Tauri sidecar) │   │
│  │  ┌────────────┐ ┌───────────────┐ ┌──────────────┐ │   │
│  │  │ Node        │ │ Pipeline       │ │ Codegen      │ │   │
│  │  │ Registry    │ │ Executor (DAG) │ │ (IR → .py)   │ │   │
│  │  │ (core +     │ │                │ │              │ │   │
│  │  │  plugins)   │ │                │ │              │ │   │
│  │  └────────────┘ └───────────────┘ └──────────────┘ │   │
│  │  ┌────────────────────────────────────────────┐    │   │
│  │  │ Execution libs: pandas, sklearn, PyTorch     │    │   │
│  │  └────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key principle:** the React Flow graph is a *view* onto a pipeline IR (a JSON
document of typed nodes + edges). The same IR drives three things identically:
live execution, Python codegen, and project save/load. This keeps "run in-app"
and "export code" from drifting apart, and is the surface a plugin author targets.

### Why Tauri + React + React Flow (not Electron, not pure Python, not Kotlin)

- The ML engine must be Python regardless of UI language — sklearn/PyTorch have
  no serious JVM/Rust/JS equivalent, and codegen output is Python, so the pipeline
  IR should map 1:1 onto Python execution semantics anyway.
- React Flow is the most mature node-graph canvas library available in any
  ecosystem (custom node types, minimap, subflows, edge validation, undo/redo
  largely built in) — building the equivalent interaction layer from scratch
  (as pure-Python or Compose Multiplatform would require) is weeks of UI work
  disconnected from what differentiates this tool.
- Tauri keeps the shell small (Rust, no bundled Chromium like Electron) while
  still hosting a full web-based UI.

### Local IPC

The Rust/React shell and the Python engine are two local processes on the same
machine, communicating over `127.0.0.1` only:

1. Tauri picks a random free port at launch.
2. Tauri generates a random per-session auth token.
3. Tauri spawns the bundled engine: `engine --port <port> --token <token>`.
4. React connects via `http(s)://127.0.0.1:<port>` and `ws://127.0.0.1:<port>/ws`,
   authenticating with the token.

This never touches the real network (no OS firewall prompts on Windows/Mac) and
requires nothing installed by the user — the engine ships as a PyInstaller-frozen
binary bundled as a Tauri sidecar.

## Pipeline IR

```json
{
  "nodes": [
    {"id": "n1", "type": "data.csv_loader", "params": {"path": "iris.csv"}},
    {"id": "n2", "type": "data.train_test_split", "params": {"test_size": 0.2}},
    {"id": "n3", "type": "sklearn.random_forest", "params": {"n_estimators": 100}}
  ],
  "edges": [
    {"from": "n1.table", "to": "n2.table"},
    {"from": "n2.train", "to": "n3.train_data"}
  ]
}
```

Ports are typed (`Table`, `Tensor`, `Model`, `Metrics`, `ImageBatch`, …). The
canvas rejects connections between incompatible port types. This is also the
`.vmb` project file format (saved as-is, plus a `viewport`/node-position block
for canvas layout, which is display-only and ignored by the executor/codegen).

## Node / Plugin System

Each node type is a manifest + Python module:

```
core/nodes/data/csv_loader/
  manifest.json   # id, category, label, input ports, output ports, param schema
  node.py         # def execute(inputs, params) -> outputs
                  # def codegen(inputs, params, var_names) -> list[str]
```

- The engine's **node registry** scans `core/nodes/` and `~/.vmb/plugins/` at
  startup. Dropping a correctly-structured folder into the plugins directory
  registers new nodes into the palette with no core rebuild.
- Param schemas are generic enough (`text`, `number`, `select`, `file_picker`,
  `checkbox`, `slider`) that the frontend's Inspector panel renders a working
  param UI for any node — including plugin-provided ones — without frontend
  code changes.
- Manifests may set `"long_running": true` for nodes whose `execute()` should
  run as a background asyncio task with progress events (training nodes),
  rather than being awaited synchronously.

## Execution Model

- Training runs in a background asyncio task inside the single engine process.
- Progress (`{"event": "progress", "node_id": ..., "epoch": ..., "loss": ...}`)
  streams over the WebSocket the frontend subscribes to for the active run.
- Node-level exceptions are caught per-node and reported as a `node_error`
  event tagged with the failing node's id, so the canvas highlights exactly
  which node broke rather than crashing the whole run.
- A "Run" executes the full graph or a selected subgraph (e.g., iterate on
  data-prep without retraining).

## Code Generation

`codegen.py` topologically sorts the same DAG the executor uses and
concatenates each node's `codegen()` output with a shared variable-naming
scheme (`n1_table`, `n2_train`, …), producing a single standalone `train.py`
with no app dependency to run. Because codegen and execution walk the same
sorted DAG and the same node modules, the two paths cannot silently diverge —
this is enforced by a test suite (see Testing).

## Frontend Structure

```
apps/frontend/src/
  canvas/     # React Flow wrapper, custom node renderer, port-type edge validation
  palette/    # Node types grouped by category, fetched from the engine's registry
  inspector/  # Selected node's params, rendered generically from its manifest schema
  monitor/    # Live loss/accuracy charts, subscribes to the WS progress stream
  project/    # New/save/load .vmb project, talks to engine's project endpoints
  codeview/   # "View/Export Code" panel: syntax-highlighted generated .py, Save As
```

One continuous canvas — no fixed Data/Model/Training tabs. A `Test`/`Evaluate`
node type takes a `Model` + held-out `Table`/`Tensor` and produces a `Metrics`
output (accuracy, confusion matrix, R², …), representing "test on the data" as
a node rather than a separate app mode.

## V1 Node Set

- **Data**: CSV/Excel/Parquet loader, SQL query connector, image folder loader,
  built-in datasets (MNIST, CIFAR-10/100, FashionMNIST).
- **Preprocessing**: train/test split, normalize/standardize, one-hot encode,
  image transforms (resize, normalize, augment).
- **Models (sklearn)**: LinearRegression, LogisticRegression, RandomForest,
  SVM, KMeans.
- **Models (PyTorch)**: Conv2D, Linear, ReLU, BatchNorm2D, Flatten, Dropout,
  Input/Output shape nodes, transfer-learning backbones (ResNet/EfficientNet).
- **Training**: Loss, Optimizer, epoch/device/checkpoint/early-stopping config.
- **Evaluation**: Test/Evaluate (metrics), confusion matrix, loss/accuracy curve.

## Packaging & Distribution

```
appname/
  apps/
    frontend/          # React + React Flow + Vite
    shell/              # Tauri (Rust) — spawns engine sidecar, manages window
  engine/
    core/
      nodes/            # built-in node types (data/, sklearn/, pytorch/)
      registry.py        # scans core/nodes + ~/.vmb/plugins at startup
      executor.py         # DAG topo-sort + execution + WS progress events
      codegen.py           # DAG walk -> .py source
      api.py                # FastAPI routes + WS endpoint
    pyproject.toml
  plugins-examples/     # sample third-party-style plugins, doubles as docs
  .github/workflows/
    build.yml            # matrix: macos-latest, windows-latest
                          #  -> PyInstaller freeze engine to a binary
                          #  -> cargo tauri build (embeds binary as sidecar)
                          #  -> uploads .dmg / .msi to the GitHub Release
  docs/
    plugin-authoring.md
```

CI on a version tag builds both installers and attaches them to a GitHub
Release — no manual packaging steps per release.

## Testing Strategy

- **IR/execution/codegen equivalence** (highest value): for a set of sample
  pipelines, train via the executor and separately run the exported script,
  asserting equivalent metrics within tolerance. This is the primary defense
  against the IR, executor, and codegen silently drifting apart.
- **Node registry/plugin loading**: manifests with malformed schemas or
  missing `execute`/`codegen` functions fail loudly at registry scan time,
  not at first use.
- **Frontend**: schema-driven Inspector rendering and canvas port-type
  connection validation are the main testable surfaces (individual node UIs
  are generated, not hand-written, so they don't need per-node tests).

## Future Work (explicitly out of v1 scope)

- Text/NLP node types (tokenization, embeddings, RNN/Transformer nodes).
- Jupyter notebook and multi-file project export formats.
- Plugin marketplace / in-app plugin discovery and install.
- Remote/cloud training execution for long-running jobs.
