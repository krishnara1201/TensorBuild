# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Visual Model Builder: a cross-platform desktop app (Tauri + React frontend,
Python/FastAPI engine) for visually building ML pipelines on a drag-and-drop
node canvas — data loading, preprocessing, train/test split, model training
(scikit-learn and, later, PyTorch), evaluation — with every pipeline
exportable as a standalone, dependency-free `.py` script.

The Python engine (`engine/`) and the frontend (`apps/frontend/` — React +
Vite + TypeScript: canvas, palette, inspector, generated-code view) both
exist. The frontend talks to the engine's HTTP API (`GET /nodes`,
`POST /pipeline/run`, `POST /pipeline/codegen`, `POST /pipeline/preview`).
`/pipeline/preview` runs a bounded subgraph (a target node's ancestors only)
and returns a sampled, JSON-safe `Table` (columns/dtypes, up to 50 rows,
total row count) — it backs both the frontend's data-preview panel and its
dynamic `target_column` dropdowns.

Read before making architectural changes:
- `docs/superpowers/specs/2026-08-20-visual-ml-builder-design.md` — overall
  system design (why Tauri+React+React Flow, plugin system, IPC model, v1
  node set, packaging).
- `docs/superpowers/specs/2026-08-21-vmb-frontend-design.md` — first
  frontend milestone design.
- `docs/superpowers/plans/` — implementation plans (task-by-task, with the
  exact code each task should produce). `docs/superpowers/specs/` and
  `docs/superpowers/plans/` are the durable design record for this project;
  check them before assuming an architectural decision needs re-deriving.

## Commands

### Engine

All commands run from the repo root against `engine/`.

```bash
# One-time setup
python3 -m venv .venv
.venv/bin/pip install -e "engine[dev]"

# Run the full engine test suite
.venv/bin/pytest engine/tests -v

# Run a single test file
.venv/bin/pytest engine/tests/test_executor.py -v

# Run a single test
.venv/bin/pytest engine/tests/test_executor.py::test_execute_pipeline_runs_end_to_end -v

# Run the engine's HTTP API locally (for manual/frontend testing), default port 8000
.venv/bin/uvicorn vmb_engine.api:app --reload
```

### Frontend

All commands run from `apps/frontend/`.

```bash
# One-time setup
npm install

# Run the frontend test suite (Vitest)
npm test

# Type-check and build
npm run build

# Run the Vite dev server, default port 5173
npm run dev
```

Both dev servers must be running for the app to work end-to-end. The engine
only sends CORS headers for `http://localhost:5173` and
`http://127.0.0.1:5173` (see `create_app()` in `vmb_engine/api.py`) — running
the frontend on a different port means updating the engine's CORS
`allow_origins` too.

### Shell (Tauri)

All commands run from `apps/shell/src-tauri/`.

```bash
# One-time setup: Rust toolchain + Tauri CLI + Linux GUI deps
# (see docs/superpowers/specs/2026-08-21-tauri-shell-design.md for the
# exact apt package list on Ubuntu/Debian)
cargo install tauri-cli --version "^2.0.0" --locked

# Run everything with one command: starts the Vite dev server, spawns the
# engine (via the repo's .venv/bin/uvicorn) on a free port, and opens the
# app window. Replaces running the engine and frontend dev servers by hand.
cargo tauri dev
```

The engine is spawned straight out of this repo's `.venv` — a dev-only
stopgap, not the packaged sidecar binary the project will eventually ship
(see the Tauri shell design spec's non-goals).

## Architecture

**Pipeline IR is the single source of truth.** A `PipelineIR`
(`vmb_engine/ir.py`, pydantic v2) — a JSON document of typed `nodes`
(`id`, `type`, `params`) and `edges` (`{"from": "n1.table", "to": "n2.table"}`)
— drives both live execution and code generation identically, so "run in-app"
and "export code" cannot silently diverge. Ports are typed (`Table`, `Model`,
`Metrics`, …); this is also the intended `.vmb` project file format.

**Node plugins are manifest + Python module pairs**, scanned at startup by
`NodeRegistry` (`vmb_engine/registry.py`) from `vmb_engine/nodes/`:

```
vmb_engine/nodes/<category>/<node_name>/
  manifest.json   # id, category, label, input/output ports, param schema
  node.py         # IMPORTS: list[str]
                  # execute(inputs: dict, params: dict) -> dict
                  # codegen(inputs: dict[str, str], params: dict, var_names: dict[str, str]) -> list[str]
```

A `select`-type `ParamSpec` may carry an `options_source: {"input_port": ...}`
instead of a static `options` list, marking it as populated dynamically (e.g.
`target_column`) — the frontend resolves its options by calling
`/pipeline/preview` on that input port's upstream node and reads off the
returned column names.

A malformed plugin (missing `manifest.json`, missing `execute`/`codegen`, a
top-level exception in `node.py`, a duplicate manifest `id`) must fail loudly
at `registry.scan()` time as `RegistryError`, not at first use — this is a
spec requirement (Testing Strategy section), not just a nice-to-have.

Ports are arbitrary named inputs/outputs per manifest, not fixed to 1-in/1-out
— the executor and codegen both iterate `manifest.inputs`/`outputs` generically
(see `execute_pipeline` in `executor.py`), so a node can declare any port
shape without core engine changes. `preprocessing/standardize` and
`preprocessing/one_hot_encode` use this for a fit-on-train/apply-to-both
shape: two `Table` inputs (`train_table`, `test_table`), two `Table` outputs
(`train`, `test`) — fit stats only on `train_table`, apply to both, to avoid
leaking test-set statistics into training.

`Metrics` outputs must be native Python types (`float(...)`, `.tolist()`),
not numpy scalars/arrays — `/pipeline/run` returns them straight through
FastAPI's JSON encoder, which doesn't know how to serialize numpy types. See
`evaluation/confusion_matrix` (`.tolist()` on both the matrix and the label
set) or any `evaluate_*` node (`float(...)` around sklearn metric calls).

**Executor and codegen walk the same topologically-sorted DAG**
(`vmb_engine/executor.py`'s `topological_sort`/`split_ref` are imported by
`vmb_engine/codegen.py`, not reimplemented) so the two paths can't drift
apart mechanically. `execute_pipeline` threads node outputs through a
context dict keyed `"{node_id}.{port}"`; `generate_code` concatenates each
node's `codegen()` lines using the matching `{node_id}_{port}` variable
naming convention. **The executor/codegen equivalence test
(`test_equivalence.py`) is the highest-value test in the suite** — it runs a
pipeline both ways and asserts the results match; when adding or changing a
node, check this test still passes before trusting either path in isolation.

`vmb_engine/api.py`'s `create_app(node_paths=...)` builds a FastAPI app
exposing `GET /nodes`, `POST /pipeline/run`, `POST /pipeline/codegen`,
`POST /pipeline/preview` over the registry/executor/codegen above;
`ExecutorError`/`RegistryError`/`PreviewError` map to 422 responses. A pipeline containing a `"long_running": true` node (the
`pytorch_models.train` node, and any future ones with the same flag) is
executed differently: `POST /pipeline/run` returns `202 {"run_id": ...}`
immediately instead of blocking, `RunManager` (`vmb_engine/runs.py`) runs
the pipeline in a background task and fans its `progress_callback` events
into a per-run `asyncio.Queue`, and `GET /ws/runs/{run_id}` streams that
queue over a WebSocket until a `"complete"`/`"node_error"` event arrives.
Pipelines with no long-running node are unaffected and still execute
synchronously inline on the request.

## Development workflow

This project is built with the Superpowers plugin's spec → plan →
implementation cycle: each milestone gets a design spec in
`docs/superpowers/specs/`, an implementation plan in
`docs/superpowers/plans/`, then executes task-by-task in its own git
worktree under `.claude/worktrees/<plan-name>/` via subagent-driven
development, with a ledger at
`.claude/worktrees/<plan-name>/.superpowers/sdd/<plan-name>/progress.md`
tracking task completion, review findings, and rulings for that plan. Follow
this pattern for new milestones rather than implementing ad hoc.
