# Pipeline Data Preview & Metrics Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user preview a data-producing node's output (CSV Loader, Clean Data, etc.) in a side panel, turn `target_column`-style params into dropdowns populated from real upstream columns, and replace raw-JSON `Metrics` display with a formatted view (a real confusion-matrix grid, formatted scalars).

**Architecture:** A new engine endpoint (`POST /pipeline/preview`) executes only the ancestor subgraph of a target node (reusing the existing topological-sort/execution machinery) and serializes its `Table` output. A new `options_source` manifest field lets a `select` param declare which input port supplies its dynamic options; the frontend Inspector resolves this via the same endpoint. A shared `MetricsView` component replaces `JSON.stringify` at both existing metrics-display call sites.

**Tech Stack:** Python/FastAPI/pandas (engine), React/TypeScript/Vitest (frontend) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-22-pipeline-preview-and-metrics-viz-design.md`

## Global Constraints

- Preview responses cap sample rows at 50 (`df.head(50)`) regardless of `total_rows` — this is a preview, not a data browser.
- A subgraph whose ancestor set contains any `long_running: true` node is rejected with a `PreviewError` → HTTP 422, message `"cannot preview past a training node"`.
- On a `ParamSpec`, `options` (static) and `options_source` (dynamic) are mutually exclusive — a param never has both.
- Preview only ever applies to `Table`-typed outputs — never `ImageBatch`/`Layer`/`Model`.
- No pagination beyond the 50-row cap, no live/streaming preview updates, no editing from the preview panel — it is read-only and re-triggered explicitly (button click, or node reselection for the dropdown).

---

## Task 1: `ancestors_of` helper in the executor

**Files:**
- Modify: `engine/vmb_engine/executor.py`
- Test: `engine/tests/test_executor.py`

**Interfaces:**
- Produces: `ancestors_of(ir: PipelineIR, target_node_id: str) -> set[str]` — returns `target_node_id` plus every node that transitively feeds it via `ir.edges`. A node with no incoming path still returns `{target_node_id}` itself. Nodes on a disconnected branch are excluded.

- [ ] **Step 1: Write the failing tests**

Add to `engine/tests/test_executor.py` (add `ancestors_of` to the existing import from `vmb_engine.executor`):

```python
from vmb_engine.executor import ExecutorError, ancestors_of, execute_pipeline, topological_sort
```

```python
def test_ancestors_of_returns_target_and_all_upstream_nodes():
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "x", "params": {}},
                {"id": "n2", "type": "x", "params": {}},
                {"id": "n3", "type": "x", "params": {}},
                {"id": "n4", "type": "x", "params": {}},
            ],
            "edges": [
                {"from": "n1.out", "to": "n2.in"},
                {"from": "n1.out", "to": "n3.in"},
                {"from": "n2.out", "to": "n4.in"},
                {"from": "n3.out", "to": "n4.in"},
            ],
        }
    )
    assert ancestors_of(ir, "n4") == {"n1", "n2", "n3", "n4"}


def test_ancestors_of_excludes_disconnected_branch():
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "x", "params": {}},
                {"id": "n2", "type": "x", "params": {}},
                {"id": "n3", "type": "x", "params": {}},
            ],
            "edges": [
                {"from": "n1.out", "to": "n2.in"},
            ],
        }
    )
    assert ancestors_of(ir, "n2") == {"n1", "n2"}
    assert ancestors_of(ir, "n3") == {"n3"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_executor.py -k ancestors_of -v`
Expected: FAIL with "cannot import name 'ancestors_of'"

- [ ] **Step 3: Implement `ancestors_of`**

In `engine/vmb_engine/executor.py`, add directly after `topological_sort` (after the line `return order` at the end of that function, before `def execute_pipeline`):

```python
def ancestors_of(ir: PipelineIR, target_node_id: str) -> set[str]:
    incoming: dict[str, set[str]] = defaultdict(set)
    for edge in ir.edges:
        from_node, _ = split_ref(edge.from_)
        to_node, _ = split_ref(edge.to)
        incoming[to_node].add(from_node)

    visited: set[str] = set()
    stack = [target_node_id]
    while stack:
        node_id = stack.pop()
        if node_id in visited:
            continue
        visited.add(node_id)
        stack.extend(incoming[node_id])
    return visited
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_executor.py -k ancestors_of -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/executor.py engine/tests/test_executor.py
git commit -m "engine: add ancestors_of helper for subgraph preview"
```

---

## Task 2: `execute_subgraph_preview` + `PreviewError`

**Files:**
- Modify: `engine/vmb_engine/executor.py`
- Test: `engine/tests/test_executor.py`

**Interfaces:**
- Consumes: `ancestors_of` (Task 1), `topological_sort`, `split_ref`, `ExecutorError`, `NodeRegistry.get`.
- Produces: `class PreviewError(Exception)`; `execute_subgraph_preview(ir: PipelineIR, registry: NodeRegistry, target_node_id: str, port: str) -> dict` returning `{"columns": [{"name": str, "dtype": str}, ...], "rows": list[list], "total_rows": int}`. Raises `PreviewError` for an unknown node id, a missing/non-`Table` port, or a `long_running` node in the ancestor set. Raises `ExecutorError` (unchanged) for any node execution failure within the subgraph.

- [ ] **Step 1: Write the failing tests**

Add to `engine/tests/test_executor.py`:

```python
from vmb_engine.executor import (
    ExecutorError,
    PreviewError,
    ancestors_of,
    execute_pipeline,
    execute_subgraph_preview,
    topological_sort,
)
```

```python
def _table_preview_pipeline(csv_path: str) -> PipelineIR:
    return PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": csv_path}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
            ],
            "edges": [{"from": "n1.table", "to": "n2.table"}],
        }
    )


def test_execute_subgraph_preview_returns_columns_rows_and_total(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))
    ir = _table_preview_pipeline(str(csv_path))

    result = execute_subgraph_preview(ir, registry, "n2", "train")

    assert {c["name"] for c in result["columns"]} == {"a", "label"}
    assert result["total_rows"] == 30
    assert len(result["rows"]) == 30


def test_execute_subgraph_preview_caps_rows_at_50(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(200)))
    ir = _table_preview_pipeline(str(csv_path))

    result = execute_subgraph_preview(ir, registry, "n1", "table")

    assert result["total_rows"] == 200
    assert len(result["rows"]) == 50


def test_execute_subgraph_preview_rejects_wrong_port_name(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")
    ir = _table_preview_pipeline(str(csv_path))

    with pytest.raises(PreviewError, match="no Table output named"):
        execute_subgraph_preview(ir, registry, "n1", "not_a_port")


def test_execute_subgraph_preview_rejects_unknown_target_node(registry):
    ir = _table_preview_pipeline("unused.csv")

    with pytest.raises(PreviewError, match="unknown node"):
        execute_subgraph_preview(ir, registry, "does_not_exist", "table")


def test_execute_subgraph_preview_rejects_long_running_ancestor(registry):
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "pytorch_models.input", "params": {"random_state": 42}},
                {"id": "n2", "type": "pytorch_models.train", "params": {"target_column": "label"}},
            ],
            "edges": [{"from": "n1.architecture", "to": "n2.architecture"}],
        }
    )

    with pytest.raises(PreviewError, match="training node"):
        execute_subgraph_preview(ir, registry, "n2", "model")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_executor.py -k execute_subgraph_preview -v`
Expected: FAIL with "cannot import name 'PreviewError'"

- [ ] **Step 3: Implement `PreviewError` and `execute_subgraph_preview`**

In `engine/vmb_engine/executor.py`, first extract the per-node execution loop out of `execute_pipeline` into a shared helper so both functions run the same code. Replace the current `execute_pipeline` function body (lines 51-106) with:

```python
class PreviewError(Exception):
    pass


def _execute_nodes(
    ir: PipelineIR,
    registry: NodeRegistry,
    node_ids: list[str],
    progress_callback=None,
) -> dict[str, object]:
    nodes_by_id = {node.id: node for node in ir.nodes}

    incoming_edges: dict[str, list] = defaultdict(list)
    for edge in ir.edges:
        to_node, to_port = split_ref(edge.to)
        incoming_edges[to_node].append((to_port, edge.from_))

    context: dict[str, object] = {}

    for node_id in node_ids:
        node_spec = nodes_by_id[node_id]
        node_def = registry.get(node_spec.type)

        inputs = {}
        for port_name, from_ref in incoming_edges[node_id]:
            if from_ref not in context:
                raise ExecutorError(f"missing value for '{from_ref}' required by '{node_id}'")
            inputs[port_name] = context[from_ref]

        for port in node_def.manifest.inputs:
            if port.name not in inputs:
                raise ExecutorError(
                    f"node '{node_id}' missing required input '{port.name}'"
                )

        def node_progress(event: dict, _node_id=node_id) -> None:
            if progress_callback is not None:
                progress_callback({**event, "node_id": _node_id})

        try:
            if node_def.manifest.long_running:
                outputs = node_def.execute(
                    inputs, node_spec.params, progress_callback=node_progress
                )
            else:
                outputs = node_def.execute(inputs, node_spec.params)
        except Exception as exc:
            node_progress({"event": "node_error", "error": str(exc)})
            raise ExecutorError(
                f"node '{node_id}' ({node_spec.type}) failed: {exc}"
            ) from exc

        for port in node_def.manifest.outputs:
            if port.name not in outputs:
                raise ExecutorError(
                    f"node '{node_id}' did not produce declared output '{port.name}'"
                )
            context[f"{node_id}.{port.name}"] = outputs[port.name]

    return context


def execute_pipeline(
    ir: PipelineIR,
    registry: NodeRegistry,
    progress_callback=None,
) -> dict[str, object]:
    order = topological_sort(ir)
    return _execute_nodes(ir, registry, order, progress_callback)


def execute_subgraph_preview(
    ir: PipelineIR,
    registry: NodeRegistry,
    target_node_id: str,
    port: str,
) -> dict:
    nodes_by_id = {node.id: node for node in ir.nodes}
    if target_node_id not in nodes_by_id:
        raise PreviewError(f"unknown node '{target_node_id}'")

    ancestor_ids = ancestors_of(ir, target_node_id)
    for node_id in ancestor_ids:
        if registry.get(nodes_by_id[node_id].type).manifest.long_running:
            raise PreviewError("cannot preview past a training node")

    target_manifest = registry.get(nodes_by_id[target_node_id].type).manifest
    port_spec = next((p for p in target_manifest.outputs if p.name == port), None)
    if port_spec is None or port_spec.type != "Table":
        raise PreviewError(f"node '{target_node_id}' has no Table output named '{port}'")

    order = [node_id for node_id in topological_sort(ir) if node_id in ancestor_ids]
    context = _execute_nodes(ir, registry, order)

    df = context[f"{target_node_id}.{port}"]
    sample = df.head(50)
    return {
        "columns": [{"name": str(col), "dtype": str(df[col].dtype)} for col in df.columns],
        "rows": sample.values.tolist(),
        "total_rows": len(df),
    }
```

(`collect_metrics_outputs` and `pipeline_has_long_running_node` below stay unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_executor.py -v`
Expected: PASS (all tests, including the pre-existing ones — the refactor must not change `execute_pipeline`'s behavior)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/executor.py engine/tests/test_executor.py
git commit -m "engine: add execute_subgraph_preview for bounded Table preview"
```

---

## Task 3: `POST /pipeline/preview` endpoint

**Files:**
- Modify: `engine/vmb_engine/api.py`
- Test: `engine/tests/test_api.py`

**Interfaces:**
- Consumes: `execute_subgraph_preview`, `PreviewError` (Task 2).
- Produces: `POST /pipeline/preview` accepting `{"pipeline": PipelineIR, "target_node_id": str, "port": str}`, returning the `execute_subgraph_preview` dict as JSON on 200, or `{"detail": str}` on 422.

- [ ] **Step 1: Write the failing tests**

Add to `engine/tests/test_api.py`:

```python
def test_preview_endpoint_returns_columns_rows_and_total(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(10)))
    pipeline = {
        "nodes": [{"id": "n1", "type": "data.csv_loader", "params": {"path": str(csv_path)}}],
        "edges": [],
    }

    response = client.post(
        "/pipeline/preview",
        json={"pipeline": pipeline, "target_node_id": "n1", "port": "table"},
    )

    assert response.status_code == 200
    body = response.json()
    assert {c["name"] for c in body["columns"]} == {"a", "label"}
    assert body["total_rows"] == 10
    assert len(body["rows"]) == 10


def test_preview_endpoint_returns_422_for_long_running_ancestor(client):
    pipeline = {
        "nodes": [
            {"id": "n1", "type": "pytorch_models.input", "params": {"random_state": 42}},
            {"id": "n2", "type": "pytorch_models.train", "params": {"target_column": "label"}},
        ],
        "edges": [{"from": "n1.architecture", "to": "n2.architecture"}],
    }

    response = client.post(
        "/pipeline/preview",
        json={"pipeline": pipeline, "target_node_id": "n2", "port": "model"},
    )

    assert response.status_code == 422
    assert "training node" in response.json()["detail"]


def test_preview_endpoint_returns_422_for_unknown_port(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")
    pipeline = {
        "nodes": [{"id": "n1", "type": "data.csv_loader", "params": {"path": str(csv_path)}}],
        "edges": [],
    }

    response = client.post(
        "/pipeline/preview",
        json={"pipeline": pipeline, "target_node_id": "n1", "port": "nope"},
    )

    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_api.py -k preview_endpoint -v`
Expected: FAIL with 404 (no such route)

- [ ] **Step 3: Implement the endpoint**

In `engine/vmb_engine/api.py`, replace the entire import block (everything from the first `import asyncio` line through `from vmb_engine.runs import RunManager, RunNotFoundError`) with:

```python
import asyncio
import contextlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

from vmb_engine.codegen import generate_code
from vmb_engine.executor import (
    ExecutorError,
    PreviewError,
    collect_metrics_outputs,
    execute_pipeline,
    execute_subgraph_preview,
    pipeline_has_long_running_node,
)
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry, RegistryError
from vmb_engine.runs import RunManager, RunNotFoundError
```

This adds only two things versus the current file: the `pydantic import BaseModel` line, and `PreviewError`/`execute_subgraph_preview` in the `vmb_engine.executor` import — everything else in the block is unchanged from today.

Directly below that import block (still above `DEFAULT_NODES_DIR = ...`), add a small request model:

```python
class PreviewRequest(BaseModel):
    pipeline: PipelineIR
    target_node_id: str
    port: str
```

Inside `create_app`, add the new route directly after `/pipeline/run`:

```python
    @app.post("/pipeline/preview")
    async def preview_node(request: PreviewRequest):
        try:
            result = await asyncio.to_thread(
                execute_subgraph_preview,
                request.pipeline,
                registry,
                request.target_node_id,
                request.port,
            )
        except (ExecutorError, RegistryError, PreviewError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_api.py -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/api.py engine/tests/test_api.py
git commit -m "engine: add POST /pipeline/preview endpoint"
```

---

## Task 4: `options_source` manifest field + apply to 10 nodes

**Files:**
- Modify: `engine/vmb_engine/manifest.py`
- Modify: `engine/vmb_engine/nodes/sklearn_models/{linear_regression,logistic_regression,random_forest,svm}/manifest.json`
- Modify: `engine/vmb_engine/nodes/pytorch_models/train/manifest.json`
- Modify: `engine/vmb_engine/nodes/preprocessing/{standardize,one_hot_encode}/manifest.json`
- Modify: `engine/vmb_engine/nodes/evaluation/{evaluate_classifier,evaluate_regressor,confusion_matrix}/manifest.json`
- Test: `engine/tests/test_api.py`

**Interfaces:**
- Produces: `ParamSpec.options_source: OptionsSource | None`, `OptionsSource.input_port: str`, both serialized by `GET /nodes` via `model_dump(mode="json")`.

- [ ] **Step 1: Write the failing test**

Add to `engine/tests/test_api.py`:

```python
def test_get_nodes_includes_options_source_for_target_column_params(client):
    response = client.get("/nodes")
    manifests = {m["id"]: m for m in response.json()}

    logistic = manifests["sklearn_models.logistic_regression"]
    target_param = next(p for p in logistic["params"] if p["name"] == "target_column")
    assert target_param["type"] == "select"
    assert target_param["options_source"] == {"input_port": "train_table"}

    evaluator = manifests["evaluation.evaluate_classifier"]
    target_param = next(p for p in evaluator["params"] if p["name"] == "target_column")
    assert target_param["options_source"] == {"input_port": "test_table"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_api.py -k options_source -v`
Expected: FAIL with `KeyError: 'options_source'`

- [ ] **Step 3: Add `options_source` to the manifest schema**

Replace the contents of `engine/vmb_engine/manifest.py` with:

```python
from pydantic import BaseModel, Field

from vmb_engine.ir import Port


class OptionsSource(BaseModel):
    input_port: str


class ParamSpec(BaseModel):
    name: str
    type: str
    label: str
    default: object = None
    options: list[str] | None = None
    options_source: OptionsSource | None = None


class NodeManifest(BaseModel):
    id: str
    category: str
    label: str
    inputs: list[Port] = Field(default_factory=list)
    outputs: list[Port] = Field(default_factory=list)
    params: list[ParamSpec] = Field(default_factory=list)
    long_running: bool = False
```

- [ ] **Step 4: Update the 10 manifests**

Change `target_column`'s `"type"` from `"text"` to `"select"` and add `"options_source"` in each file below. `train_table`-sourced group:

`engine/vmb_engine/nodes/sklearn_models/linear_regression/manifest.json` — replace the `params` array:
```json
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        }
    ]
```

`engine/vmb_engine/nodes/sklearn_models/logistic_regression/manifest.json` — replace the `target_column` entry (keep `max_iter`/`random_state` unchanged):
```json
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
```

`engine/vmb_engine/nodes/sklearn_models/random_forest/manifest.json` — replace the `target_column` entry (keep `n_estimators`/`random_state` unchanged):
```json
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
```

`engine/vmb_engine/nodes/sklearn_models/svm/manifest.json` — replace the `target_column` entry (keep `C`/`random_state` unchanged):
```json
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
```

`engine/vmb_engine/nodes/pytorch_models/train/manifest.json` — replace the `target_column` entry (keep `task_type`/`loss_fn`/`optimizer`/`learning_rate`/`epochs`/`batch_size` unchanged):
```json
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "train_table"}
        },
```

`engine/vmb_engine/nodes/preprocessing/standardize/manifest.json` — replace the `params` array:
```json
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column (excluded)",
            "default": "",
            "options_source": {"input_port": "train_table"}
        }
    ]
```

`engine/vmb_engine/nodes/preprocessing/one_hot_encode/manifest.json` — replace the `params` array:
```json
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column (excluded)",
            "default": "",
            "options_source": {"input_port": "train_table"}
        }
    ]
```

`test_table`-sourced group:

`engine/vmb_engine/nodes/evaluation/evaluate_classifier/manifest.json` — replace the `params` array:
```json
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "test_table"}
        }
    ]
```

`engine/vmb_engine/nodes/evaluation/evaluate_regressor/manifest.json` — replace the `params` array:
```json
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "test_table"}
        }
    ]
```

`engine/vmb_engine/nodes/evaluation/confusion_matrix/manifest.json` — replace the `params` array:
```json
    "params": [
        {
            "name": "target_column",
            "type": "select",
            "label": "Target Column",
            "default": "",
            "options_source": {"input_port": "test_table"}
        }
    ]
```

`sklearn_models/kmeans` has no `target_column` param — leave untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests -v`
Expected: PASS (all tests — this confirms the manifest edits didn't break registry scanning or any existing node test)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine/vmb_engine/manifest.py engine/vmb_engine/nodes engine/tests/test_api.py
git commit -m "engine: add options_source manifest field, wire to 10 target_column params"
```

---

## Task 5: Frontend types + `previewSubgraph` API client function

**Files:**
- Modify: `apps/frontend/src/api/types.ts`
- Modify: `apps/frontend/src/api/client.ts`
- Test: `apps/frontend/tests/client.test.ts`

**Interfaces:**
- Produces: `OptionsSource { input_port: string }`, `PreviewColumn { name: string; dtype: string }`, `PreviewResult { columns: PreviewColumn[]; rows: unknown[][]; total_rows: number }`, extended `ParamSpec.options_source?: OptionsSource`; `previewSubgraph(ir: PipelineIR, targetNodeId: string, port: string): Promise<PreviewResult>`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/tests/client.test.ts`, updating the import line to include `previewSubgraph`:

```ts
import { getCode, getNodes, getRunSocketUrl, previewSubgraph, runPipeline, resolveBaseUrl } from '../src/api/client'
```

```ts
  it('previewSubgraph POSTs the pipeline/target/port and returns the parsed result', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ columns: [{ name: 'a', dtype: 'int64' }], rows: [[1]], total_rows: 1 }),
    } as Response)

    const result = await previewSubgraph(ir, 'n1', 'table')

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/pipeline/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipeline: ir, target_node_id: 'n1', port: 'table' }),
    })
    expect(result).toEqual({ columns: [{ name: 'a', dtype: 'int64' }], rows: [[1]], total_rows: 1 })
  })

  it('previewSubgraph throws the engine detail message on a 422', async () => {
    const ir: PipelineIR = { nodes: [], edges: [] }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'cannot preview past a training node' }),
    } as Response)

    await expect(previewSubgraph(ir, 'n1', 'table')).rejects.toThrow('cannot preview past a training node')
  })
```

Place these inside the existing `describe('api/client', ...)` block, alongside the other `runPipeline`/`getCode` tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run client.test.ts`
Expected: FAIL with "previewSubgraph is not a function" (or a TS import error)

- [ ] **Step 3: Add the types**

In `apps/frontend/src/api/types.ts`, add after the `ParamSpec` interface's `options` field and before `min?`:

```ts
export interface OptionsSource {
  input_port: string
}
```

Update `ParamSpec` to include the new field (insert `options_source?: OptionsSource` right after `options?: string[]`):

```ts
export interface ParamSpec {
  name: string
  type: 'text' | 'number' | 'select' | 'file_picker' | 'checkbox' | 'slider'
  label: string
  default: unknown
  // Not sent by the engine today (see this plan's Global Constraints) —
  // optional for forward compatibility.
  options?: string[]
  // Dynamic option list sourced from an upstream Table's columns —
  // mutually exclusive with `options`.
  options_source?: OptionsSource
  min?: number
  max?: number
  step?: number
}
```

Add at the end of the file:

```ts
export interface PreviewColumn {
  name: string
  dtype: string
}

export interface PreviewResult {
  columns: PreviewColumn[]
  rows: unknown[][]
  total_rows: number
}
```

- [ ] **Step 4: Add `previewSubgraph` to the client**

In `apps/frontend/src/api/client.ts`, update the type import:

```ts
import type { CodegenResult, NodeManifest, PipelineIR, PreviewResult, RunOutcome } from './types'
```

Replace `postPipeline` with a more general `postJson`, and have `postPipeline` delegate to it (this keeps every existing call site and its request-body assertions unchanged):

```ts
async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errBody = await response.json().catch(() => null)
    const detail =
      errBody && typeof errBody.detail === 'string' ? errBody.detail : `${path} failed: ${response.status}`
    throw new Error(detail)
  }
  return { status: response.status, body: await response.json() }
}

async function postPipeline(path: string, ir: PipelineIR): Promise<{ status: number; body: unknown }> {
  return postJson(path, ir)
}
```

Add, after `getCode`:

```ts
export async function previewSubgraph(ir: PipelineIR, targetNodeId: string, port: string): Promise<PreviewResult> {
  const { body } = await postJson('/pipeline/preview', { pipeline: ir, target_node_id: targetNodeId, port })
  return body as PreviewResult
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run client.test.ts`
Expected: PASS (all tests, including pre-existing `runPipeline`/`getCode` ones — confirms the `postPipeline`/`postJson` refactor didn't change their request bodies)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/api/types.ts src/api/client.ts tests/client.test.ts
git commit -m "frontend: add previewSubgraph client function and PreviewResult/options_source types"
```

---

## Task 6: `DynamicOptionsState` + `useDynamicOptions` hook

**Files:**
- Modify: `apps/frontend/src/inspector/params/types.ts`
- Create: `apps/frontend/src/inspector/useDynamicOptions.ts`
- Test: `apps/frontend/tests/useDynamicOptions.test.ts`

**Interfaces:**
- Consumes: `previewSubgraph` (Task 5), `toIR` (`apps/frontend/src/ir/convert.ts`), `PipelineNode`/`PipelineEdge` (`apps/frontend/src/canvas/types.ts`).
- Produces: `DynamicOptionsState = { status: 'disconnected' } | { status: 'loading' } | { status: 'ready'; options: string[] } | { status: 'error'; message: string }`; `useDynamicOptions(node: PipelineNode | null, nodes: PipelineNode[], edges: PipelineEdge[]): Record<string, DynamicOptionsState>` — one entry per param with `options_source` on the selected node's manifest.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/tests/useDynamicOptions.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDynamicOptions } from '../src/inspector/useDynamicOptions'
import * as client from '../src/api/client'
import type { NodeManifest, ParamSpec } from '../src/api/types'
import type { PipelineEdge, PipelineNode } from '../src/canvas/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, previewSubgraph: vi.fn() }
})

function manifestWithTargetColumn(): NodeManifest {
  const targetColumnParam: ParamSpec = {
    name: 'target_column',
    type: 'select',
    label: 'Target Column',
    default: '',
    options_source: { input_port: 'train_table' },
  }
  return {
    id: 'sklearn_models.logistic_regression',
    category: 'Models (sklearn)',
    label: 'Logistic Regression',
    inputs: [{ name: 'train_table', type: 'Table' }],
    outputs: [{ name: 'model', type: 'Model' }],
    params: [targetColumnParam],
    long_running: false,
  }
}

function csvLoaderManifest(): NodeManifest {
  return {
    id: 'data.csv_loader',
    category: 'Data',
    label: 'CSV Loader',
    inputs: [],
    outputs: [{ name: 'table', type: 'Table' }],
    params: [],
    long_running: false,
  }
}

const selectedNode: PipelineNode = {
  id: 'n2',
  type: 'pipelineNode',
  position: { x: 0, y: 0 },
  data: { manifest: manifestWithTargetColumn(), params: { target_column: '' } },
}

const upstreamNode: PipelineNode = {
  id: 'n1',
  type: 'pipelineNode',
  position: { x: 0, y: 0 },
  data: { manifest: csvLoaderManifest(), params: {} },
}

describe('useDynamicOptions', () => {
  it('reports disconnected when the input port has no incoming edge', () => {
    const { result } = renderHook(() => useDynamicOptions(selectedNode, [selectedNode, upstreamNode], []))

    expect(result.current.target_column).toEqual({ status: 'disconnected' })
  })

  it('loads and reports ready options when connected', async () => {
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({
      columns: [
        { name: 'age', dtype: 'int64' },
        { name: 'label', dtype: 'int64' },
      ],
      rows: [],
      total_rows: 0,
    })
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'train_table' },
    ]

    const { result } = renderHook(() => useDynamicOptions(selectedNode, [selectedNode, upstreamNode], edges))

    expect(result.current.target_column).toEqual({ status: 'loading' })

    await waitFor(() => {
      expect(result.current.target_column).toEqual({ status: 'ready', options: ['age', 'label'] })
    })
  })

  it('reports error when the preview call fails', async () => {
    vi.mocked(client.previewSubgraph).mockRejectedValueOnce(new Error('bad path'))
    const edges: PipelineEdge[] = [
      { id: 'e1', source: 'n1', sourceHandle: 'table', target: 'n2', targetHandle: 'train_table' },
    ]

    const { result } = renderHook(() => useDynamicOptions(selectedNode, [selectedNode, upstreamNode], edges))

    await waitFor(() => {
      expect(result.current.target_column).toEqual({ status: 'error', message: 'bad path' })
    })
  })

  it('returns an empty record when the selected node has no dynamic-select params', () => {
    const { result } = renderHook(() => useDynamicOptions(upstreamNode, [selectedNode, upstreamNode], []))

    expect(result.current).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run useDynamicOptions.test.ts`
Expected: FAIL — module `../src/inspector/useDynamicOptions` does not exist

- [ ] **Step 3: Add `DynamicOptionsState` to param control types**

Replace `apps/frontend/src/inspector/params/types.ts` with:

```ts
import type { ParamSpec } from '../../api/types'

export type DynamicOptionsState =
  | { status: 'disconnected' }
  | { status: 'loading' }
  | { status: 'ready'; options: string[] }
  | { status: 'error'; message: string }

export interface ParamControlProps {
  spec: ParamSpec
  value: unknown
  onChange: (value: unknown) => void
  dynamicOptions?: DynamicOptionsState
}
```

- [ ] **Step 4: Implement `useDynamicOptions`**

Create `apps/frontend/src/inspector/useDynamicOptions.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { previewSubgraph } from '../api/client'
import type { PreviewResult } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { toIR } from '../ir/convert'
import type { DynamicOptionsState } from './params/types'

export function useDynamicOptions(
  node: PipelineNode | null,
  nodes: PipelineNode[],
  edges: PipelineEdge[],
): Record<string, DynamicOptionsState> {
  const [state, setState] = useState<Record<string, DynamicOptionsState>>({})
  const requestIdRef = useRef(0)
  const cacheRef = useRef(new Map<string, PreviewResult>())

  useEffect(() => {
    const dynamicParams = node?.data.manifest.params.filter((spec) => spec.options_source) ?? []
    if (!node || dynamicParams.length === 0) {
      setState({})
      return
    }

    const requestId = ++requestIdRef.current
    const ir = toIR(nodes, edges)
    const irKey = JSON.stringify(ir)
    const initialState: Record<string, DynamicOptionsState> = {}
    const toFetch: { paramName: string; sourceNodeId: string; sourcePort: string; cacheKey: string }[] = []

    for (const spec of dynamicParams) {
      const inputPort = spec.options_source!.input_port
      const edge = edges.find((e) => e.target === node.id && e.targetHandle === inputPort)
      if (!edge || !edge.sourceHandle) {
        initialState[spec.name] = { status: 'disconnected' }
        continue
      }
      const cacheKey = `${edge.source}.${edge.sourceHandle}::${irKey}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        initialState[spec.name] = { status: 'ready', options: cached.columns.map((c) => c.name) }
      } else {
        initialState[spec.name] = { status: 'loading' }
        toFetch.push({ paramName: spec.name, sourceNodeId: edge.source, sourcePort: edge.sourceHandle, cacheKey })
      }
    }
    setState(initialState)

    for (const { paramName, sourceNodeId, sourcePort, cacheKey } of toFetch) {
      previewSubgraph(ir, sourceNodeId, sourcePort)
        .then((result) => {
          cacheRef.current.set(cacheKey, result)
          if (requestIdRef.current !== requestId) return
          setState((prev) => ({
            ...prev,
            [paramName]: { status: 'ready', options: result.columns.map((c) => c.name) },
          }))
        })
        .catch((error: Error) => {
          if (requestIdRef.current !== requestId) return
          setState((prev) => ({ ...prev, [paramName]: { status: 'error', message: error.message } }))
        })
    }
  }, [node, nodes, edges])

  return state
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run useDynamicOptions.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/inspector/params/types.ts src/inspector/useDynamicOptions.ts tests/useDynamicOptions.test.ts
git commit -m "frontend: add useDynamicOptions hook for target_column dropdowns"
```

---

## Task 7: `SelectParam` dynamic rendering + Inspector wiring

**Files:**
- Modify: `apps/frontend/src/inspector/params/SelectParam.tsx`
- Modify: `apps/frontend/src/inspector/InspectorPanel.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Test: `apps/frontend/tests/InspectorPanel.test.tsx`

**Interfaces:**
- Consumes: `useDynamicOptions` (Task 6), `DynamicOptionsState` (Task 6).
- Produces: `InspectorPanelProps` gains `nodes: PipelineNode[]` and `edges: PipelineEdge[]`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/frontend/tests/InspectorPanel.test.tsx` in full with:

```tsx
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InspectorPanel } from '../src/inspector/InspectorPanel'
import * as dynamicOptionsModule from '../src/inspector/useDynamicOptions'
import type { PipelineNode } from '../src/canvas/types'
import type { NodeManifest, ParamSpec } from '../src/api/types'

vi.mock('../src/inspector/useDynamicOptions', async () => {
  const actual = await vi.importActual<typeof import('../src/inspector/useDynamicOptions')>(
    '../src/inspector/useDynamicOptions',
  )
  return { ...actual, useDynamicOptions: vi.fn(() => ({})) }
})

// InspectorPanel's param inputs are fully controlled by `node.data.params`.
// Rendering it with a static `node` prop (as a real controlled <input> requires
// value to be echoed back after each keystroke, or React reverts the DOM to the
// stale prop value) only exercises single-keystroke interactions correctly.
// This harness plays the role Task 9's App will play: it applies each
// onParamChange call back onto the node before re-rendering, so multi-keystroke
// interactions (clearing then retyping a number, typing a multi-character path)
// accumulate the way they will in the real app, while still letting every test
// assert on the exact (nodeId, paramName, value) arguments reported upward.
function Harness({
  initialNode,
  onParamChange,
}: {
  initialNode: PipelineNode
  onParamChange: (nodeId: string, paramName: string, value: unknown) => void
}) {
  const [node, setNode] = useState(initialNode)
  const handleParamChange = (nodeId: string, paramName: string, value: unknown) => {
    onParamChange(nodeId, paramName, value)
    setNode((prev) => ({
      ...prev,
      data: { ...prev.data, params: { ...prev.data.params, [paramName]: value } },
    }))
  }
  return (
    <InspectorPanel
      node={node}
      nodes={[node]}
      edges={[]}
      onParamChange={handleParamChange}
      onPreview={vi.fn()}
    />
  )
}

function manifestWithParam(param: ParamSpec): NodeManifest {
  return {
    id: 'test.node',
    category: 'Test',
    label: 'Test Node',
    inputs: [],
    outputs: [],
    params: [param],
    long_running: false,
  }
}

function nodeWithParam(param: ParamSpec, value: unknown): PipelineNode {
  return {
    id: 'n1',
    type: 'pipelineNode',
    position: { x: 0, y: 0 },
    data: { manifest: manifestWithParam(param), params: { [param.name]: value } },
  }
}

describe('InspectorPanel', () => {
  it('shows a placeholder when no node is selected', () => {
    render(<InspectorPanel node={null} nodes={[]} edges={[]} onParamChange={vi.fn()} onPreview={vi.fn()} />)
    expect(screen.getByText(/select a node/i)).toBeInTheDocument()
  })

  it('renders a text control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam({ name: 'path', type: 'text', label: 'File Path', default: '' }, '')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.type(screen.getByLabelText('File Path'), 'a')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'path', 'a')
  })

  it('renders a number control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam(
      { name: 'n_estimators', type: 'number', label: 'N Estimators', default: 100 },
      100,
    )
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    const input = screen.getByLabelText('N Estimators')
    await userEvent.clear(input)
    await userEvent.type(input, '5')

    expect(onParamChange).toHaveBeenLastCalledWith('n1', 'n_estimators', 5)
  })

  it('renders a checkbox control and reports changes', async () => {
    const onParamChange = vi.fn()
    const node = nodeWithParam({ name: 'shuffle', type: 'checkbox', label: 'Shuffle', default: false }, false)
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.click(screen.getByLabelText('Shuffle'))

    expect(onParamChange).toHaveBeenCalledWith('n1', 'shuffle', true)
  })

  it('renders a select control with options and reports changes', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'kernel',
      type: 'select',
      label: 'Kernel',
      default: 'linear',
      options: ['linear', 'rbf'],
    }
    const node = nodeWithParam(spec, 'linear')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.selectOptions(screen.getByLabelText('Kernel'), 'rbf')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'kernel', 'rbf')
  })

  it('falls back to a text control when a select has no options and no options_source', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'kernel', type: 'select', label: 'Kernel', default: '' }
    const node = nodeWithParam(spec, '')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    const input = screen.getByLabelText('Kernel')
    expect(input.tagName).toBe('INPUT')
    await userEvent.type(input, 'x')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'kernel', 'x')
  })

  it('renders a slider control with bounds and reports changes', () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'test_size',
      type: 'slider',
      label: 'Test Size',
      default: 0.2,
      min: 0,
      max: 1,
      step: 0.1,
    }
    const node = nodeWithParam(spec, 0.2)
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    fireEvent.change(screen.getByLabelText('Test Size'), { target: { value: '0.5' } })

    expect(onParamChange).toHaveBeenCalledWith('n1', 'test_size', 0.5)
  })

  it('falls back to a number control when a slider has no bounds', () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'test_size', type: 'slider', label: 'Test Size', default: 0.2 }
    const node = nodeWithParam(spec, 0.2)
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    expect(screen.getByLabelText('Test Size')).toHaveAttribute('type', 'number')
  })

  it('renders a file_picker control as a plain path input', async () => {
    const onParamChange = vi.fn()
    const spec: ParamSpec = { name: 'folder', type: 'file_picker', label: 'Folder', default: '' }
    const node = nodeWithParam(spec, '')
    render(<Harness initialNode={node} onParamChange={onParamChange} />)

    await userEvent.type(screen.getByLabelText('Folder'), '/tmp')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'folder', '/tmp')
  })

  it('renders a disabled select with a placeholder when a dynamic-select param is disconnected', () => {
    vi.mocked(dynamicOptionsModule.useDynamicOptions).mockReturnValue({
      target_column: { status: 'disconnected' },
    })
    const spec: ParamSpec = {
      name: 'target_column',
      type: 'select',
      label: 'Target Column',
      default: '',
      options_source: { input_port: 'train_table' },
    }
    const node = nodeWithParam(spec, '')
    render(<InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={vi.fn()} onPreview={vi.fn()} />)

    const select = screen.getByLabelText('Target Column')
    expect(select).toBeDisabled()
    expect(screen.getByText('Connect input to see columns')).toBeInTheDocument()
  })

  it('renders a disabled select with a loading placeholder while columns are loading', () => {
    vi.mocked(dynamicOptionsModule.useDynamicOptions).mockReturnValue({
      target_column: { status: 'loading' },
    })
    const spec: ParamSpec = {
      name: 'target_column',
      type: 'select',
      label: 'Target Column',
      default: '',
      options_source: { input_port: 'train_table' },
    }
    const node = nodeWithParam(spec, '')
    render(<InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={vi.fn()} onPreview={vi.fn()} />)

    expect(screen.getByLabelText('Target Column')).toBeDisabled()
    expect(screen.getByText('Loading columns…')).toBeInTheDocument()
  })

  it('renders dynamic select options once loaded and reports changes', async () => {
    vi.mocked(dynamicOptionsModule.useDynamicOptions).mockReturnValue({
      target_column: { status: 'ready', options: ['age', 'label'] },
    })
    const onParamChange = vi.fn()
    const spec: ParamSpec = {
      name: 'target_column',
      type: 'select',
      label: 'Target Column',
      default: '',
      options_source: { input_port: 'train_table' },
    }
    const node = nodeWithParam(spec, '')
    render(
      <InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={onParamChange} onPreview={vi.fn()} />,
    )

    await userEvent.selectOptions(screen.getByLabelText('Target Column'), 'label')

    expect(onParamChange).toHaveBeenCalledWith('n1', 'target_column', 'label')
  })

  it('renders a disabled select with the error message when the dynamic-options fetch fails', () => {
    vi.mocked(dynamicOptionsModule.useDynamicOptions).mockReturnValue({
      target_column: { status: 'error', message: 'bad path' },
    })
    const spec: ParamSpec = {
      name: 'target_column',
      type: 'select',
      label: 'Target Column',
      default: '',
      options_source: { input_port: 'train_table' },
    }
    const node = nodeWithParam(spec, '')
    render(<InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={vi.fn()} onPreview={vi.fn()} />)

    expect(screen.getByLabelText('Target Column')).toBeDisabled()
    expect(screen.getByText('bad path')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run InspectorPanel.test.tsx`
Expected: FAIL — `InspectorPanel` doesn't accept `nodes`/`edges`/`onPreview` props yet (TS error), and the dynamic-select tests find no disabled select

- [ ] **Step 3: Update `SelectParam`**

Replace `apps/frontend/src/inspector/params/SelectParam.tsx` with:

```tsx
import { TextParam } from './TextParam'
import type { ParamControlProps } from './types'

export function SelectParam({ spec, value, onChange, dynamicOptions }: ParamControlProps) {
  if (dynamicOptions) {
    if (dynamicOptions.status === 'ready') {
      return (
        <label className="param-control">
          <span>{spec.label}</span>
          <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
            <option value="" disabled>
              Select a column…
            </option>
            {dynamicOptions.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )
    }
    const placeholder =
      dynamicOptions.status === 'disconnected'
        ? 'Connect input to see columns'
        : dynamicOptions.status === 'loading'
          ? 'Loading columns…'
          : dynamicOptions.message
    return (
      <label className="param-control">
        <span>{spec.label}</span>
        <select disabled value="">
          <option value="">{placeholder}</option>
        </select>
      </label>
    )
  }

  if (!spec.options || spec.options.length === 0) {
    return <TextParam spec={spec} value={value} onChange={onChange} />
  }
  return (
    <label className="param-control">
      <span>{spec.label}</span>
      <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        {spec.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 4: Wire `InspectorPanel`**

Replace `apps/frontend/src/inspector/InspectorPanel.tsx` with:

```tsx
import type { ComponentType } from 'react'
import type { ParamSpec } from '../api/types'
import type { PipelineEdge, PipelineNode } from '../canvas/types'
import { CheckboxParam } from './params/CheckboxParam'
import { FilePickerParam } from './params/FilePickerParam'
import { NumberParam } from './params/NumberParam'
import { SelectParam } from './params/SelectParam'
import { SliderParam } from './params/SliderParam'
import { TextParam } from './params/TextParam'
import type { ParamControlProps } from './params/types'
import { useDynamicOptions } from './useDynamicOptions'

const CONTROLS: Record<ParamSpec['type'], ComponentType<ParamControlProps>> = {
  text: TextParam,
  number: NumberParam,
  select: SelectParam,
  file_picker: FilePickerParam,
  checkbox: CheckboxParam,
  slider: SliderParam,
}

export interface InspectorPanelProps {
  node: PipelineNode | null
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  onParamChange: (nodeId: string, paramName: string, value: unknown) => void
  onPreview: (nodeId: string, port: string) => void
}

export function InspectorPanel({ node, nodes, edges, onParamChange, onPreview }: InspectorPanelProps) {
  const dynamicOptions = useDynamicOptions(node, nodes, edges)

  if (!node) {
    return (
      <aside className="inspector-panel">
        <p>Select a node to edit its parameters.</p>
      </aside>
    )
  }

  const { manifest, params } = node.data
  const tableOutputs = manifest.outputs.filter((port) => port.type === 'Table')

  return (
    <aside className="inspector-panel">
      <h2>{manifest.label}</h2>
      {manifest.params.map((spec) => {
        const Control = CONTROLS[spec.type]
        return (
          <Control
            key={spec.name}
            spec={spec}
            value={params[spec.name]}
            onChange={(value) => onParamChange(node.id, spec.name, value)}
            dynamicOptions={spec.options_source ? dynamicOptions[spec.name] : undefined}
          />
        )
      })}
      {tableOutputs.length > 0 && (
        <div className="inspector-preview-buttons">
          {tableOutputs.map((port) => (
            <button key={port.name} type="button" onClick={() => onPreview(node.id, port.name)}>
              {tableOutputs.length > 1 ? `Preview ${port.name}` : 'Preview Output'}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 5: Update `App.tsx`'s `InspectorPanel` usage**

In `apps/frontend/src/App.tsx`, update the `<InspectorPanel />` element (the rest of `App.tsx` is left as-is for this task — the `onPreview` handler is added in Task 9):

```tsx
        <InspectorPanel
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          onParamChange={handleParamChange}
          onPreview={() => {}}
        />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run InspectorPanel.test.tsx`
Expected: PASS (all tests)

Run: `npm test -- --run` (full suite)
Expected: PASS — confirms `App.test.tsx` still passes with the new required `InspectorPanel` props supplied

- [ ] **Step 7: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/inspector/params/SelectParam.tsx src/inspector/InspectorPanel.tsx src/App.tsx tests/InspectorPanel.test.tsx
git commit -m "frontend: render target_column as a dynamic dropdown in the Inspector"
```

---

## Task 8: `usePreview` hook + `PreviewPanel` component

**Files:**
- Create: `apps/frontend/src/preview/usePreview.ts`
- Create: `apps/frontend/src/preview/PreviewPanel.tsx`
- Modify: `apps/frontend/src/index.css`
- Test: `apps/frontend/tests/usePreview.test.ts`
- Test: `apps/frontend/tests/PreviewPanel.test.tsx`

**Interfaces:**
- Consumes: `previewSubgraph` (Task 5).
- Produces: `PreviewState = { status: 'idle' } | { status: 'loading' } | { status: 'success'; data: PreviewResult } | { status: 'error'; error: string }`; `usePreview(): { state: PreviewState; runPreview: (ir: PipelineIR, nodeId: string, port: string) => void; reset: () => void }`; `PreviewPanel({ state: PreviewState; onClose: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/usePreview.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePreview } from '../src/preview/usePreview'
import * as client from '../src/api/client'
import type { PipelineIR } from '../src/api/types'

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, previewSubgraph: vi.fn() }
})

const ir: PipelineIR = { nodes: [], edges: [] }

describe('usePreview', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => usePreview())
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('moves to loading then success', async () => {
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({
      columns: [{ name: 'a', dtype: 'int64' }],
      rows: [[1]],
      total_rows: 1,
    })
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })
    expect(result.current.state).toEqual({ status: 'loading' })

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'success',
        data: { columns: [{ name: 'a', dtype: 'int64' }], rows: [[1]], total_rows: 1 },
      })
    })
  })

  it('moves to error on failure', async () => {
    vi.mocked(client.previewSubgraph).mockRejectedValueOnce(new Error('bad path'))
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error', error: 'bad path' })
    })
  })

  it('reset returns to idle', async () => {
    vi.mocked(client.previewSubgraph).mockResolvedValueOnce({ columns: [], rows: [], total_rows: 0 })
    const { result } = renderHook(() => usePreview())

    act(() => {
      result.current.runPreview(ir, 'n1', 'table')
    })
    await waitFor(() => expect(result.current.state.status).toBe('success'))

    act(() => {
      result.current.reset()
    })
    expect(result.current.state).toEqual({ status: 'idle' })
  })
})
```

Create `apps/frontend/tests/PreviewPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewPanel } from '../src/preview/PreviewPanel'
import type { PreviewState } from '../src/preview/usePreview'

describe('PreviewPanel', () => {
  it('shows a loading state', () => {
    render(<PreviewPanel state={{ status: 'loading' }} onClose={vi.fn()} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error message', () => {
    render(<PreviewPanel state={{ status: 'error', error: 'bad path' }} onClose={vi.fn()} />)
    expect(screen.getByText('bad path')).toBeInTheDocument()
  })

  it('renders columns, rows, and a row-count footer on success', () => {
    const state: PreviewState = {
      status: 'success',
      data: {
        columns: [
          { name: 'age', dtype: 'int64' },
          { name: 'label', dtype: 'object' },
        ],
        rows: [
          [25, 'yes'],
          [31, 'no'],
        ],
        total_rows: 4200,
      },
    }
    render(<PreviewPanel state={state} onClose={vi.fn()} />)

    expect(screen.getByText('age')).toBeInTheDocument()
    expect(screen.getByText('int64')).toBeInTheDocument()
    expect(screen.getByText('yes')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 4,200 rows')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<PreviewPanel state={{ status: 'idle' }} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run usePreview.test.ts PreviewPanel.test.tsx`
Expected: FAIL — neither module exists yet

- [ ] **Step 3: Implement `usePreview`**

Create `apps/frontend/src/preview/usePreview.ts`:

```ts
import { useCallback, useState } from 'react'
import { previewSubgraph } from '../api/client'
import type { PipelineIR, PreviewResult } from '../api/types'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: PreviewResult }
  | { status: 'error'; error: string }

export function usePreview() {
  const [state, setState] = useState<PreviewState>({ status: 'idle' })

  const runPreview = useCallback((ir: PipelineIR, nodeId: string, port: string) => {
    setState({ status: 'loading' })
    previewSubgraph(ir, nodeId, port)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: Error) => setState({ status: 'error', error: error.message }))
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, runPreview, reset }
}
```

- [ ] **Step 4: Implement `PreviewPanel`**

Create `apps/frontend/src/preview/PreviewPanel.tsx`:

```tsx
import type { PreviewState } from './usePreview'

export interface PreviewPanelProps {
  state: PreviewState
  onClose: () => void
}

export function PreviewPanel({ state, onClose }: PreviewPanelProps) {
  return (
    <aside className="preview-panel">
      <div className="modal-panel-header">
        <h2>Data Preview</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {state.status === 'loading' && <p>Loading…</p>}
      {state.status === 'error' && <p className="error-banner">{state.error}</p>}
      {state.status === 'success' && (
        <>
          <div className="preview-table-scroll">
            <table className="preview-table">
              <thead>
                <tr>
                  {state.data.columns.map((col) => (
                    <th key={col.name}>
                      {col.name}
                      <div className="preview-table-dtype">{col.dtype}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="preview-table-footer">
            Showing {state.data.rows.length} of {state.data.total_rows.toLocaleString()} rows
          </p>
        </>
      )}
    </aside>
  )
}
```

- [ ] **Step 5: Add CSS**

Append to `apps/frontend/src/index.css`:

```css
.preview-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 480px;
  background: white;
  border-left: 1px solid #ccc;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  overflow-y: auto;
  padding: 16px;
  z-index: 10;
}

.preview-table-scroll {
  overflow-x: auto;
}

.preview-table {
  border-collapse: collapse;
  width: 100%;
}

.preview-table th,
.preview-table td {
  border: 1px solid #ddd;
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}

.preview-table-dtype {
  font-size: 10px;
  font-weight: normal;
  color: #888;
}

.preview-table-footer {
  margin-top: 8px;
  font-size: 12px;
  color: #555;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --run usePreview.test.ts PreviewPanel.test.tsx`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/preview/usePreview.ts src/preview/PreviewPanel.tsx src/index.css tests/usePreview.test.ts tests/PreviewPanel.test.tsx
git commit -m "frontend: add usePreview hook and PreviewPanel side panel"
```

---

## Task 9: Wire the Preview button end-to-end in `App.tsx`

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/tests/InspectorPanel.test.tsx`
- Modify: `apps/frontend/tests/App.test.tsx`

**Interfaces:**
- Consumes: `usePreview`, `PreviewPanel` (Task 8), `InspectorPanel`'s `onPreview` prop (Task 7).

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/tests/InspectorPanel.test.tsx`, inside the `describe('InspectorPanel', ...)` block:

```tsx
  it('renders a single "Preview Output" button for a node with one Table output and calls onPreview', async () => {
    const onPreview = vi.fn()
    const manifest: NodeManifest = {
      id: 'data.csv_loader',
      category: 'Data',
      label: 'CSV Loader',
      inputs: [],
      outputs: [{ name: 'table', type: 'Table' }],
      params: [],
      long_running: false,
    }
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest, params: {} },
    }
    render(<InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={vi.fn()} onPreview={onPreview} />)

    await userEvent.click(screen.getByRole('button', { name: 'Preview Output' }))

    expect(onPreview).toHaveBeenCalledWith('n1', 'table')
  })

  it('renders two labeled preview buttons for a node with two Table outputs', () => {
    const manifest: NodeManifest = {
      id: 'preprocessing.standardize',
      category: 'Preprocessing',
      label: 'Standardize',
      inputs: [
        { name: 'train_table', type: 'Table' },
        { name: 'test_table', type: 'Table' },
      ],
      outputs: [
        { name: 'train', type: 'Table' },
        { name: 'test', type: 'Table' },
      ],
      params: [],
      long_running: false,
    }
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest, params: {} },
    }
    render(<InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={vi.fn()} onPreview={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Preview train' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview test' })).toBeInTheDocument()
  })

  it('renders no preview button for a node with no Table output', () => {
    const manifest: NodeManifest = {
      id: 'sklearn_models.kmeans',
      category: 'Models (sklearn)',
      label: 'KMeans',
      inputs: [{ name: 'train_table', type: 'Table' }],
      outputs: [{ name: 'model', type: 'Model' }],
      params: [],
      long_running: false,
    }
    const node: PipelineNode = {
      id: 'n1',
      type: 'pipelineNode',
      position: { x: 0, y: 0 },
      data: { manifest, params: {} },
    }
    render(<InspectorPanel node={node} nodes={[node]} edges={[]} onParamChange={vi.fn()} onPreview={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument()
  })
```

Add to `apps/frontend/tests/App.test.tsx`. Update the mocked-modules block to also mock `PreviewPanel` and `InspectorPanel`, and add `previewSubgraph` to the `client` mock:

```tsx
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client')
  return { ...actual, useNodes: vi.fn(), useRunPipeline: vi.fn(), useGetCode: vi.fn(), previewSubgraph: vi.fn() }
})

vi.mock('../src/training/TrainingMonitor', () => ({
  TrainingMonitor: ({ runId, onClose }: { runId: string; onClose: () => void }) => (
    <div>
      <p>Training monitor for {runId}</p>
      <button type="button" onClick={onClose}>
        Close training monitor
      </button>
    </div>
  ),
}))

vi.mock('../src/inspector/InspectorPanel', () => ({
  InspectorPanel: ({ onPreview }: { onPreview: (nodeId: string, port: string) => void }) => (
    <button type="button" onClick={() => onPreview('n1', 'table')}>
      Fake preview trigger
    </button>
  ),
}))

vi.mock('../src/preview/PreviewPanel', () => ({
  PreviewPanel: ({ onClose }: { onClose: () => void }) => (
    <div>
      <p>Preview panel</p>
      <button type="button" onClick={onClose}>
        Close preview
      </button>
    </div>
  ),
}))
```

Add a new test inside `describe('App', ...)`:

```tsx
  it('opens and closes the preview panel when Preview is triggered from the inspector', async () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(mockMutation({}))
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))
    vi.mocked(client.previewSubgraph).mockResolvedValue({ columns: [], rows: [], total_rows: 0 })

    render(<App />)
    await userEvent.click(screen.getByText('Fake preview trigger'))

    expect(await screen.findByText('Preview panel')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Close preview'))

    expect(screen.queryByText('Preview panel')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run InspectorPanel.test.tsx App.test.tsx`
Expected: FAIL — no preview buttons rendered yet; `App.tsx` doesn't wire a real `onPreview` yet

- [ ] **Step 3: Update `App.tsx`**

In `apps/frontend/src/App.tsx`, update imports:

```tsx
import { useCallback, useState } from 'react'
import { useEdgesState, useNodesState } from '@xyflow/react'
import { useGetCode, useRunPipeline } from './api/client'
import { PipelineCanvas } from './canvas/PipelineCanvas'
import type { PipelineEdge, PipelineNode } from './canvas/types'
import { CodeViewPanel } from './codeview/CodeViewPanel'
import { InspectorPanel } from './inspector/InspectorPanel'
import { toIR } from './ir/convert'
import { MetricsView } from './metrics/MetricsView'
import { NodePalette } from './palette/NodePalette'
import { PreviewPanel } from './preview/PreviewPanel'
import { usePreview } from './preview/usePreview'
import { TrainingMonitor } from './training/TrainingMonitor'
```

(The `MetricsView` import above is used starting in Task 11 — leave it in now so this task's edit doesn't need to touch this import block twice.)

Add state and handlers, right after the existing `activeRunId` state:

```tsx
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState<{ nodeId: string; port: string } | null>(null)
  const preview = usePreview()
```

Add handlers after `handleViewCode`:

```tsx
  const handlePreview = useCallback(
    (nodeId: string, port: string) => {
      setPreviewTarget({ nodeId, port })
      preview.runPreview(toIR(nodes, edges), nodeId, port)
    },
    [nodes, edges, preview],
  )

  const handleClosePreview = useCallback(() => {
    setPreviewTarget(null)
    preview.reset()
  }, [preview])
```

Update the `<InspectorPanel />` element to use the real handler:

```tsx
        <InspectorPanel
          node={selectedNode}
          nodes={nodes}
          edges={edges}
          onParamChange={handleParamChange}
          onPreview={handlePreview}
        />
```

Render the panel at the end, alongside the existing modals:

```tsx
      {isCodeViewOpen && codeMutation.data && (
        <CodeViewPanel code={codeMutation.data.code} onClose={() => setCodeViewOpen(false)} />
      )}
      {activeRunId && <TrainingMonitor runId={activeRunId} onClose={() => setActiveRunId(null)} />}
      {previewTarget && <PreviewPanel state={preview.state} onClose={handleClosePreview} />}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run` (full suite)
Expected: PASS — `MetricsView` doesn't exist yet, so this step will fail on the import; **do not run this step until Task 10 is complete**. Instead, for this task only, run:

Run: `npm test -- --run InspectorPanel.test.tsx App.test.tsx`
Expected: PASS (both files)

Note: `App.tsx`'s new `import { MetricsView } from './metrics/MetricsView'` will break the build/tests until Task 10 creates that file — Task 10 must be done immediately after this one before running the full suite or `npm run build`.

- [ ] **Step 5: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/App.tsx tests/InspectorPanel.test.tsx tests/App.test.tsx
git commit -m "frontend: wire Preview Output button to open the data preview panel"
```

---

## Task 10: `MetricsView` component

**Files:**
- Create: `apps/frontend/src/metrics/MetricsView.tsx`
- Modify: `apps/frontend/src/index.css`
- Test: `apps/frontend/tests/MetricsView.test.tsx`

**Interfaces:**
- Produces: `MetricsView({ metrics: Record<string, unknown> })` — renders a confusion-matrix grid when `metrics` has array-typed `confusion_matrix`/`labels` keys, formatted stat rows when every value is a number, otherwise a `<pre>` fallback.

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/tests/MetricsView.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricsView } from '../src/metrics/MetricsView'

describe('MetricsView', () => {
  it('renders scalar metrics as formatted stat rows', () => {
    render(<MetricsView metrics={{ accuracy: 0.913456, final_val_loss: 0.2 }} />)

    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9135')).toBeInTheDocument()
    expect(screen.getByText('Final Val Loss')).toBeInTheDocument()
    expect(screen.getByText('0.2000')).toBeInTheDocument()
  })

  it('renders a confusion matrix as a labeled grid with the diagonal highlighted', () => {
    render(
      <MetricsView
        metrics={{
          confusion_matrix: [
            [8, 1],
            [2, 9],
          ],
          labels: [0, 1],
        }}
      />,
    )

    const table = screen.getByRole('table')
    const diagonalCells = table.querySelectorAll('.confusion-matrix-diagonal')
    expect(diagonalCells).toHaveLength(2)
    expect(diagonalCells[0]).toHaveTextContent('8')
    expect(diagonalCells[1]).toHaveTextContent('9')
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.getAllByText('1')).toHaveLength(2)
  })

  it('falls back to a formatted block for an unrecognized metrics shape', () => {
    render(<MetricsView metrics={{ weird: { nested: true } }} />)

    expect(screen.getByText(/"weird"/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run MetricsView.test.tsx`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement `MetricsView`**

Create `apps/frontend/src/metrics/MetricsView.tsx`:

```tsx
export interface MetricsViewProps {
  metrics: Record<string, unknown>
}

function isConfusionMatrix(
  metrics: Record<string, unknown>,
): metrics is Record<string, unknown> & { confusion_matrix: number[][]; labels: unknown[] } {
  return Array.isArray(metrics.confusion_matrix) && Array.isArray(metrics.labels)
}

function formatKey(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function MetricsView({ metrics }: MetricsViewProps) {
  if (isConfusionMatrix(metrics)) {
    const { confusion_matrix: matrix, labels } = metrics
    const rest = Object.fromEntries(
      Object.entries(metrics).filter(([key]) => key !== 'confusion_matrix' && key !== 'labels'),
    )
    return (
      <div className="metrics-view">
        <table className="confusion-matrix-table">
          <thead>
            <tr>
              <th />
              {labels.map((label, i) => (
                <th key={i}>{String(label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th>{String(labels[rowIndex])}</th>
                {row.map((count, colIndex) => (
                  <td key={colIndex} className={rowIndex === colIndex ? 'confusion-matrix-diagonal' : undefined}>
                    {count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(rest).length > 0 && <MetricsView metrics={rest} />}
      </div>
    )
  }

  const entries = Object.entries(metrics)
  const allScalar = entries.length > 0 && entries.every(([, value]) => typeof value === 'number')
  if (allScalar) {
    return (
      <dl className="metrics-view">
        {entries.map(([key, value]) => (
          <div className="metrics-stat" key={key}>
            <dt>{formatKey(key)}</dt>
            <dd>{(value as number).toPrecision(4)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return <pre className="metrics-fallback">{JSON.stringify(metrics, null, 2)}</pre>
}
```

- [ ] **Step 4: Add CSS**

Append to `apps/frontend/src/index.css`:

```css
.metrics-block {
  margin-bottom: 16px;
}

.metrics-block-heading {
  font-size: 13px;
  color: #555;
  margin: 0 0 4px;
}

.metrics-view {
  margin: 0;
}

.metrics-stat {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}

.metrics-stat dt {
  font-weight: 600;
}

.metrics-stat dd {
  margin: 0;
}

.confusion-matrix-table {
  border-collapse: collapse;
}

.confusion-matrix-table th,
.confusion-matrix-table td {
  border: 1px solid #ddd;
  padding: 4px 8px;
  text-align: center;
}

.confusion-matrix-diagonal {
  background: #e3f2e3;
  font-weight: 600;
}

.metrics-fallback {
  background: #f6f6f6;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run MetricsView.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/metrics/MetricsView.tsx src/index.css tests/MetricsView.test.tsx
git commit -m "frontend: add MetricsView for formatted metrics/confusion-matrix display"
```

---

## Task 11: Wire `MetricsView` into `App.tsx` and `TrainingMonitor.tsx`

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/training/TrainingMonitor.tsx`
- Modify: `apps/frontend/tests/App.test.tsx`
- Modify: `apps/frontend/tests/TrainingMonitor.test.tsx`

**Interfaces:**
- Consumes: `MetricsView` (Task 10).

- [ ] **Step 1: Update the existing tests to check formatted output**

In `apps/frontend/tests/App.test.tsx`, update the `'renders returned metrics on a successful synchronous run'` test:

```tsx
  it('renders returned metrics on a successful synchronous run', () => {
    vi.mocked(client.useRunPipeline).mockReturnValue(
      mockMutation({ data: { kind: 'sync', metrics: { 'n4.metrics': { accuracy: 0.95 } } } }),
    )
    vi.mocked(client.useGetCode).mockReturnValue(mockMutation({}))

    render(<App />)

    expect(screen.getByText(/n4\.metrics/)).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9500')).toBeInTheDocument()
  })
```

In `apps/frontend/tests/TrainingMonitor.test.tsx`, update the `'shows final metrics when training completes'` test:

```tsx
  it('shows final metrics when training completes', () => {
    mockState({
      status: 'complete',
      history: [],
      metrics: { 'n6.metrics': { accuracy: 0.9 } },
    })

    render(<TrainingMonitor runId="run-1" onClose={vi.fn()} />)

    expect(screen.getByText('Training complete')).toBeInTheDocument()
    expect(screen.getByText(/n6\.metrics/)).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('0.9000')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run App.test.tsx TrainingMonitor.test.tsx`
Expected: FAIL — `getByText('Accuracy')` finds nothing yet

- [ ] **Step 3: Update `App.tsx`'s metrics rendering**

In `apps/frontend/src/App.tsx`, replace the `runMutation.data?.kind === 'sync'` block:

```tsx
      {runMutation.data?.kind === 'sync' && (
        <div className="metrics-list">
          {Object.entries(runMutation.data.metrics).map(([ref, value]) => (
            <div key={ref} className="metrics-block">
              <h3 className="metrics-block-heading">{ref}</h3>
              <MetricsView metrics={value as Record<string, unknown>} />
            </div>
          ))}
        </div>
      )}
```

(`MetricsView` is already imported as of Task 9's import-block edit.)

- [ ] **Step 4: Update `TrainingMonitor.tsx`'s metrics rendering**

In `apps/frontend/src/training/TrainingMonitor.tsx`, add the import:

```tsx
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { MetricsView } from '../metrics/MetricsView'
import { useTrainingRun, type TrainingState } from './useTrainingRun'
```

Replace the completion-metrics block:

```tsx
      {state.status === 'complete' && (
        <div className="metrics-list">
          {Object.entries(state.metrics).map(([ref, value]) => (
            <div key={ref} className="metrics-block">
              <h3 className="metrics-block-heading">{ref}</h3>
              <MetricsView metrics={value as Record<string, unknown>} />
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --run` (full suite)
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
git add src/App.tsx src/training/TrainingMonitor.tsx tests/App.test.tsx tests/TrainingMonitor.test.tsx
git commit -m "frontend: replace raw-JSON metrics display with MetricsView"
```

---

## Task 12: Full-suite verification and dev-server smoke check

**Files:** none (verification only, plus any small fixes it surfaces)

- [ ] **Step 1: Run the full engine suite**

```bash
cd /home/shreyash/projects/visual_model_builder
.venv/bin/pytest engine/tests -v
```

Expected: all tests pass.

- [ ] **Step 2: Run the full frontend suite and type-check/build**

```bash
cd /home/shreyash/projects/visual_model_builder/apps/frontend
npm test -- --run
npm run build
```

Expected: all tests pass; `tsc --noEmit && vite build` succeeds with no new errors.

- [ ] **Step 3: Dev-server smoke check**

```bash
cd /home/shreyash/projects/visual_model_builder
.venv/bin/uvicorn vmb_engine.api:app --port 8000 &
ENGINE_PID=$!
sleep 2
curl -sf -X POST http://127.0.0.1:8000/nodes > /dev/null 2>&1
curl -sf http://127.0.0.1:8000/nodes | grep -q "options_source" && echo "ENGINE OK"
kill $ENGINE_PID
```

Expected: prints `ENGINE OK`.

- [ ] **Step 4: Commit (only if Steps 1-3 required fixes)**

If every check above passed with no source changes, there is nothing to commit — this task is done. Otherwise:

```bash
cd /home/shreyash/projects/visual_model_builder
git add engine apps/frontend
git commit -m "engine+frontend: fix issues found in full-suite/build verification"
```

## Manual QA (for a human, after this plan is merged)

No task above drives a real browser through an actual preview/dropdown/metrics flow — that needs a human. Run this once all 12 tasks are complete:

1. Start the engine: `.venv/bin/uvicorn vmb_engine.api:app --reload`.
2. Start the frontend: `cd apps/frontend && npm run dev`, open the printed URL.
3. Drag **CSV Loader** onto the canvas, set its path to a small CSV file, select it, and click **Preview Output**. Confirm the side panel opens on the right showing real columns/rows/row-count, without needing to click the top-level **Run** button first.
4. Drag **Train/Test Split** onto the canvas, connect CSV Loader's `table` output to it. Drag **Logistic Regression** onto the canvas, connect Train/Test Split's `train` output to it. Select Logistic Regression and confirm its **Target Column** field is a dropdown auto-populated with the CSV's real column names (not free text), with no manual "load" click needed.
5. Disconnect that edge and reselect Logistic Regression; confirm the dropdown becomes disabled with a "Connect input to see columns" placeholder instead of erroring.
6. Wire up a full pipeline through **Evaluate Classifier** and **Confusion Matrix**, click **Run**. Confirm the results area shows accuracy as a formatted stat (not `JSON.stringify`) and the confusion matrix as a real labeled grid with the diagonal visually highlighted.
7. Repeat step 6 for a pipeline using the **Train** (PyTorch) long-running node instead, confirming the same formatted display shows up in the **Training complete** view of the training monitor.
8. On the PyTorch **Train** node (or any node feeding a `long_running` node), confirm there's no crash or hang if you try to preview a node whose upstream chain runs through a training node — this should be prevented by the endpoint returning a "cannot preview past a training node" error, surfaced inline rather than silently failing.
