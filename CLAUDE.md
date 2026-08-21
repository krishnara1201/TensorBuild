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
`POST /pipeline/run`, `POST /pipeline/codegen`).

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

A malformed plugin (missing `manifest.json`, missing `execute`/`codegen`, a
top-level exception in `node.py`, a duplicate manifest `id`) must fail loudly
at `registry.scan()` time as `RegistryError`, not at first use — this is a
spec requirement (Testing Strategy section), not just a nice-to-have.

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
exposing `GET /nodes`, `POST /pipeline/run`, `POST /pipeline/codegen` over
the registry/executor/codegen above; `ExecutorError`/`RegistryError` map to
422 responses. No WebSocket/async execution exists yet — all current nodes
are synchronous. That's deferred to the plan that adds PyTorch training
nodes (manifests may set `"long_running": true` for those, per the parent
spec, but nothing consumes that flag yet).

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
