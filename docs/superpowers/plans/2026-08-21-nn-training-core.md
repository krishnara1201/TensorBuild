# Neural Network Training Core — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and train a tabular MLP end-to-end through the existing `PipelineIR` — chained layer nodes, a `Train` node, and the async execution + WebSocket progress infrastructure the engine doesn't have yet — with zero behavior change to existing sklearn pipelines.

**Architecture:** New `pytorch_models` node category (`Input`, `Linear`, `ReLU`, `Dropout`, `Train`) threads a new `Layer` port type through the DAG exactly like `preprocessing/standardize` threads `train_table`/`test_table` — no core executor/codegen changes needed for the port type itself. `execute_pipeline` gains an optional `progress_callback` used only for nodes whose manifest sets `long_running: true` (only `Train`); `/pipeline/run` routes such pipelines through a new `RunManager` (background `asyncio` task + `asyncio.Queue`) and a `WS /ws/runs/{run_id}` endpoint instead of blocking the HTTP response.

**Tech Stack:** Python 3.11+, PyTorch (CPU), FastAPI/Starlette WebSockets, pytest.

**Spec:** `docs/superpowers/specs/2026-08-21-nn-training-core-design.md`

**Note on scope:** This plan covers the engine (`engine/`) only. Frontend rendering of the new node types, the `Layer` port's edge color, and the live loss-chart UI are a separate follow-up plan, matching this repo's existing precedent of splitting engine-core and frontend plans (`2026-08-20-python-engine-core.md` vs. `2026-08-21-vmb-frontend-canvas-slice.md`). Every task here is independently verifiable via `pytest` and `curl`/a WebSocket test client — no frontend is required to exercise any of it.

## Global Constraints

- New dependencies: `torch` (CPU build) and `websockets` (uvicorn needs a WS
  implementation to serve `/ws/runs/{run_id}` outside of tests) — add both
  to `engine/pyproject.toml` `dependencies`.
- `POST /pipeline/run` must keep its exact current synchronous response
  shape (`{"metrics": {...}}`, `200`) for any pipeline with no
  `long_running` node — existing `test_api.py`/`test_executor.py` tests
  must keep passing unmodified.
- Non-`long_running` nodes' `execute(inputs, params)` call signature must
  not change — every existing node module keeps working with no edits.
- Port `type` strings are free-form labels the executor/codegen never
  branch on — adding `"Layer"` requires no changes to
  `vmb_engine/executor.py`'s or `vmb_engine/codegen.py`'s control flow,
  only to the node manifests that use it.
- Follow the executor/codegen equivalence bar already enforced by
  `test_equivalence.py`: any new node's live-run output and
  exported-and-executed-script output must match.
- Random weight initialization must be seeded once, in the `Input` node
  (via `torch.manual_seed`), so live execution and codegen'd scripts
  produce identical training trajectories — see Task 3.

---

## Task 1: Add PyTorch + websockets dependencies

**Files:**
- Modify: `engine/pyproject.toml`

**Interfaces:**
- Produces: `torch` and `websockets` importable in the `.venv` used by every
  later task.

- [ ] **Step 1: Add the dependencies**

Edit `engine/pyproject.toml`'s `dependencies` list (currently ends at
`"scikit-learn>=1.4.0",`) to add two entries:

```toml
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn>=0.29.0",
    "pydantic>=2.6.0",
    "pandas>=2.2.0",
    "scikit-learn>=1.4.0",
    "torch>=2.2.0",
    "websockets>=12.0",
]
```

- [ ] **Step 2: Install and verify**

Run: `.venv/bin/pip install -e "engine[dev]"`
Then: `.venv/bin/python -c "import torch; import websockets; print(torch.__version__)"`
Expected: prints a version string, no import errors.

- [ ] **Step 3: Commit**

```bash
git add engine/pyproject.toml
git commit -m "engine: add torch and websockets dependencies"
```

---

## Task 2: Executor progress_callback support + metrics-collection helper

**Files:**
- Modify: `engine/vmb_engine/executor.py`
- Modify: `engine/vmb_engine/api.py:38-49` (the inline metrics-filtering block in `run_pipeline`)
- Test: `engine/tests/test_executor.py`

**Interfaces:**
- Produces: `execute_pipeline(ir, registry, progress_callback=None)` — the
  `progress_callback` param is new and optional; existing callers
  (`execute_pipeline(ir, registry)`) are unaffected.
- Produces: `collect_metrics_outputs(ir: PipelineIR, registry: NodeRegistry, context: dict) -> dict`
  — the extracted metrics-filtering logic `run_pipeline` already has
  inline, now reusable by both the sync path and the async `RunManager`
  added in Task 8.
- Produces: `pipeline_has_long_running_node(ir: PipelineIR, registry: NodeRegistry) -> bool`.
- Consumes: `NodeManifest.long_running` (already exists in
  `vmb_engine/manifest.py:21`, currently unused).

- [ ] **Step 1: Write the failing tests**

Add to `engine/tests/test_executor.py`:

```python
import json
import textwrap


def _write_long_running_plugin(tmp_path):
    plugin_dir = tmp_path / "test_long_running"
    plugin_dir.mkdir()
    manifest = {
        "id": "test.long_running",
        "category": "Test",
        "label": "Test Long Running",
        "inputs": [],
        "outputs": [{"name": "out", "type": "Table"}],
        "params": [],
        "long_running": True,
    }
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest))
    (plugin_dir / "node.py").write_text(
        textwrap.dedent(
            """
            IMPORTS = []

            def execute(inputs, params, progress_callback=None):
                if progress_callback is not None:
                    progress_callback({"event": "progress", "epoch": 0})
                    progress_callback({"event": "progress", "epoch": 1})
                return {"out": 1}

            def codegen(inputs, params, var_names):
                return [f"{var_names['out']} = 1"]
            """
        )
    )
    return plugin_dir


def test_execute_pipeline_passes_progress_callback_to_long_running_nodes(tmp_path):
    from vmb_engine.registry import NodeRegistry

    plugin_dir = _write_long_running_plugin(tmp_path)
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.long_running", "params": {}}], "edges": []}
    )

    events = []
    context = execute_pipeline(ir, reg, progress_callback=events.append)

    assert context["n1.out"] == 1
    assert events == [
        {"event": "progress", "epoch": 0, "node_id": "n1"},
        {"event": "progress", "epoch": 1, "node_id": "n1"},
    ]


def test_execute_pipeline_without_progress_callback_still_works(tmp_path):
    from vmb_engine.registry import NodeRegistry

    plugin_dir = _write_long_running_plugin(tmp_path)
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.long_running", "params": {}}], "edges": []}
    )

    context = execute_pipeline(ir, reg)

    assert context["n1.out"] == 1


def test_execute_pipeline_emits_node_error_event_before_raising(tmp_path):
    from vmb_engine.registry import NodeRegistry

    plugin_dir = tmp_path / "test_broken"
    plugin_dir.mkdir()
    manifest = {
        "id": "test.broken",
        "category": "Test",
        "label": "Test Broken",
        "inputs": [],
        "outputs": [{"name": "out", "type": "Table"}],
        "params": [],
    }
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest))
    (plugin_dir / "node.py").write_text(
        textwrap.dedent(
            """
            IMPORTS = []

            def execute(inputs, params):
                raise RuntimeError("boom")

            def codegen(inputs, params, var_names):
                return []
            """
        )
    )
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.broken", "params": {}}], "edges": []}
    )

    events = []
    with pytest.raises(ExecutorError):
        execute_pipeline(ir, reg, progress_callback=events.append)

    assert events == [{"event": "node_error", "error": "boom", "node_id": "n1"}]


def test_pipeline_has_long_running_node(tmp_path):
    from vmb_engine.executor import pipeline_has_long_running_node
    from vmb_engine.registry import NodeRegistry

    plugin_dir = _write_long_running_plugin(tmp_path)
    reg = NodeRegistry()
    reg.scan([plugin_dir])
    ir = PipelineIR.model_validate(
        {"nodes": [{"id": "n1", "type": "test.long_running", "params": {}}], "edges": []}
    )

    assert pipeline_has_long_running_node(ir, reg) is True


def test_collect_metrics_outputs_filters_by_port_type(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))
    ir = _pipeline(str(csv_path))

    from vmb_engine.executor import collect_metrics_outputs

    context = execute_pipeline(ir, registry)
    metrics = collect_metrics_outputs(ir, registry, context)

    assert set(metrics) == {"n4.metrics"}
    assert 0.0 <= metrics["n4.metrics"]["accuracy"] <= 1.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_executor.py -v`
Expected: `FAIL` — `TypeError: execute_pipeline() got an unexpected keyword argument 'progress_callback'` and `ImportError: cannot import name 'pipeline_has_long_running_node'` / `collect_metrics_outputs`.

- [ ] **Step 3: Implement**

Replace `engine/vmb_engine/executor.py`'s `execute_pipeline` function (and
add the two new functions) with:

```python
def execute_pipeline(
    ir: PipelineIR,
    registry: NodeRegistry,
    progress_callback=None,
) -> dict[str, object]:
    order = topological_sort(ir)
    nodes_by_id = {node.id: node for node in ir.nodes}

    incoming_edges: dict[str, list] = defaultdict(list)
    for edge in ir.edges:
        to_node, to_port = split_ref(edge.to)
        incoming_edges[to_node].append((to_port, edge.from_))

    context: dict[str, object] = {}

    for node_id in order:
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


def collect_metrics_outputs(
    ir: PipelineIR, registry: NodeRegistry, context: dict
) -> dict:
    nodes_by_id = {node.id: node for node in ir.nodes}
    metrics = {}
    for ref, value in context.items():
        node_id, port_name = ref.split(".", 1)
        node_def = registry.get(nodes_by_id[node_id].type)
        port = next((p for p in node_def.manifest.outputs if p.name == port_name), None)
        if port is not None and port.type == "Metrics":
            metrics[ref] = value
    return metrics


def pipeline_has_long_running_node(ir: PipelineIR, registry: NodeRegistry) -> bool:
    return any(registry.get(node.type).manifest.long_running for node in ir.nodes)
```

(`node_progress`'s `_node_id=node_id` default argument captures the loop
variable per-iteration — without it every closure would see the final
`node_id` from the loop.)

Then update `engine/vmb_engine/api.py`'s `run_pipeline` (currently
inlining the metrics-filter loop at lines 38-49) to use the new helper:

```python
    @app.post("/pipeline/run")
    def run_pipeline(ir: PipelineIR):
        try:
            context = execute_pipeline(ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        return {"metrics": collect_metrics_outputs(ir, registry, context)}
```

Add `collect_metrics_outputs` to the existing
`from vmb_engine.executor import ...` import line in `api.py`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_executor.py engine/tests/test_api.py -v`
Expected: all `PASS`.

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/executor.py engine/vmb_engine/api.py engine/tests/test_executor.py
git commit -m "engine: add progress_callback support and collect_metrics_outputs helper"
```

---

## Task 3: `Input` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/input/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/input/node.py`
- Test: `engine/tests/test_nodes_pytorch.py`

**Interfaces:**
- Produces: node type `pytorch_models.input`. Output port `architecture`
  (`Layer`) is a runtime dict `{"modules": list[nn.Module], "in_features": int}`;
  in codegen, the paired variables `{var}` (a Python list) and
  `{var}_in_features` (an int) — this is the convention every later layer
  node in this plan consumes and produces.

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_nodes_pytorch.py`:

```python
import importlib.util
from pathlib import Path

import pandas as pd
import pytest

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def _load_node_module(rel_path: str):
    node_path = NODES_DIR / rel_path / "node.py"
    spec = importlib.util.spec_from_file_location(rel_path.replace("/", "_"), node_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _toy_frame(n: int = 40) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "x1": [i % 5 for i in range(n)],
            "x2": [(i * 3) % 7 for i in range(n)],
            "label": [i % 2 for i in range(n)],
        }
    )


def test_input_execute_computes_in_features():
    input_node = _load_node_module("pytorch_models/input")
    train_df = _toy_frame()

    outputs = input_node.execute(
        {"train_table": train_df}, {"target_column": "label", "random_state": 42}
    )

    architecture = outputs["architecture"]
    assert architecture["modules"] == []
    assert architecture["in_features"] == 2


def test_input_codegen_emits_seed_and_empty_architecture():
    input_node = _load_node_module("pytorch_models/input")
    lines = input_node.codegen(
        {"train_table": "n1_table"},
        {"target_column": "label", "random_state": 42},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "torch.manual_seed(42)",
        "n2_architecture_in_features = len([c for c in n1_table.columns if c != 'label'])",
        "n2_architecture = []",
    ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v`
Expected: `FAIL` — no such file `pytorch_models/input/node.py`.

- [ ] **Step 3: Implement**

`engine/vmb_engine/nodes/pytorch_models/input/manifest.json`:

```json
{
    "id": "pytorch_models.input",
    "category": "Models (PyTorch)",
    "label": "Input",
    "inputs": [{"name": "train_table", "type": "Table"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": [
        {"name": "target_column", "type": "text", "label": "Target Column", "default": ""},
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

`engine/vmb_engine/nodes/pytorch_models/input/node.py`:

```python
IMPORTS = ["import torch"]


def execute(inputs: dict, params: dict) -> dict:
    import torch

    torch.manual_seed(params["random_state"])
    target = params["target_column"]
    df = inputs["train_table"]
    in_features = len([c for c in df.columns if c != target])
    return {"architecture": {"modules": [], "in_features": in_features}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    out_var = var_names["architecture"]
    target = params["target_column"]
    random_state = params["random_state"]
    return [
        f"torch.manual_seed({random_state})",
        f"{out_var}_in_features = len([c for c in {train_in}.columns if c != {target!r}])",
        f"{out_var} = []",
    ]
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/nodes/pytorch_models/input engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.input node"
```

---

## Task 4: `Linear` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/linear/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/linear/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: the `Layer` runtime/codegen convention from Task 3.
- Produces: node type `pytorch_models.linear`; same `Layer` convention,
  `in_features` becomes the node's `out_features` param for whatever
  connects downstream.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def test_linear_execute_appends_layer_and_updates_in_features():
    linear = _load_node_module("pytorch_models/linear")

    outputs = linear.execute(
        {"architecture": {"modules": [], "in_features": 2}}, {"out_features": 8}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].in_features == 2
    assert architecture["modules"][0].out_features == 8
    assert architecture["in_features"] == 8


def test_linear_codegen_emits_layer_append():
    linear = _load_node_module("pytorch_models/linear")
    lines = linear.codegen(
        {"architecture": "n1_architecture"},
        {"out_features": 8},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "n2_architecture = n1_architecture + [nn.Linear(n1_architecture_in_features, 8)]",
        "n2_architecture_in_features = 8",
    ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k linear`
Expected: `FAIL`.

- [ ] **Step 3: Implement**

`engine/vmb_engine/nodes/pytorch_models/linear/manifest.json`:

```json
{
    "id": "pytorch_models.linear",
    "category": "Models (PyTorch)",
    "label": "Linear",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": [
        {"name": "out_features", "type": "number", "label": "Output Features", "default": 64}
    ]
}
```

`engine/vmb_engine/nodes/pytorch_models/linear/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    out_features = params["out_features"]
    layer = nn.Linear(architecture["in_features"], out_features)
    modules = architecture["modules"] + [layer]
    return {"architecture": {"modules": modules, "in_features": out_features}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    out_features = params["out_features"]
    return [
        f"{out_var} = {in_var} + [nn.Linear({in_var}_in_features, {out_features})]",
        f"{out_var}_in_features = {out_features}",
    ]
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k linear`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/nodes/pytorch_models/linear engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.linear node"
```

---

## Task 5: `ReLU` and `Dropout` nodes

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/relu/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/relu/node.py`
- Create: `engine/vmb_engine/nodes/pytorch_models/dropout/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/dropout/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes/Produces: same `Layer` convention as Task 3/4 — both pass
  `in_features` through unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def test_relu_execute_appends_activation_and_preserves_in_features():
    relu = _load_node_module("pytorch_models/relu")

    outputs = relu.execute({"architecture": {"modules": [], "in_features": 8}}, {})

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["in_features"] == 8


def test_relu_codegen_emits_activation_append():
    relu = _load_node_module("pytorch_models/relu")
    lines = relu.codegen(
        {"architecture": "n2_architecture"}, {}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.ReLU()]",
        "n3_architecture_in_features = n2_architecture_in_features",
    ]


def test_dropout_execute_appends_dropout_and_preserves_in_features():
    dropout = _load_node_module("pytorch_models/dropout")

    outputs = dropout.execute({"architecture": {"modules": [], "in_features": 8}}, {"p": 0.3})

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].p == 0.3
    assert architecture["in_features"] == 8


def test_dropout_codegen_emits_dropout_append():
    dropout = _load_node_module("pytorch_models/dropout")
    lines = dropout.codegen(
        {"architecture": "n2_architecture"}, {"p": 0.3}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.Dropout(p=0.3)]",
        "n3_architecture_in_features = n2_architecture_in_features",
    ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k "relu or dropout"`
Expected: `FAIL`.

- [ ] **Step 3: Implement**

`engine/vmb_engine/nodes/pytorch_models/relu/manifest.json`:

```json
{
    "id": "pytorch_models.relu",
    "category": "Models (PyTorch)",
    "label": "ReLU",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": []
}
```

`engine/vmb_engine/nodes/pytorch_models/relu/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    modules = architecture["modules"] + [nn.ReLU()]
    return {"architecture": {"modules": modules, "in_features": architecture["in_features"]}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    return [
        f"{out_var} = {in_var} + [nn.ReLU()]",
        f"{out_var}_in_features = {in_var}_in_features",
    ]
```

`engine/vmb_engine/nodes/pytorch_models/dropout/manifest.json`:

```json
{
    "id": "pytorch_models.dropout",
    "category": "Models (PyTorch)",
    "label": "Dropout",
    "inputs": [{"name": "architecture", "type": "Layer"}],
    "outputs": [{"name": "architecture", "type": "Layer"}],
    "params": [
        {"name": "p", "type": "number", "label": "Dropout Probability", "default": 0.5}
    ]
}
```

`engine/vmb_engine/nodes/pytorch_models/dropout/node.py`:

```python
IMPORTS = ["import torch.nn as nn"]


def execute(inputs: dict, params: dict) -> dict:
    import torch.nn as nn

    architecture = inputs["architecture"]
    modules = architecture["modules"] + [nn.Dropout(p=params["p"])]
    return {"architecture": {"modules": modules, "in_features": architecture["in_features"]}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["architecture"]
    out_var = var_names["architecture"]
    p = params["p"]
    return [
        f"{out_var} = {in_var} + [nn.Dropout(p={p})]",
        f"{out_var}_in_features = {in_var}_in_features",
    ]
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k "relu or dropout"`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/nodes/pytorch_models/relu engine/vmb_engine/nodes/pytorch_models/dropout engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.relu and pytorch_models.dropout nodes"
```

---

## Task 6: `Train` node

**Files:**
- Create: `engine/vmb_engine/nodes/pytorch_models/train/manifest.json`
- Create: `engine/vmb_engine/nodes/pytorch_models/train/node.py`
- Test: `engine/tests/test_nodes_pytorch.py` (append)

**Interfaces:**
- Consumes: `Layer` architecture from Tasks 3-5 (`inputs["architecture"]["modules"]`).
- Produces: `model` output — a dict `{"estimator": <object with .predict(df)>, "feature_columns": list[str]}`,
  matching the exact shape every sklearn model node and every evaluation
  node (`evaluate_classifier`, `evaluate_regressor`, `confusion_matrix`)
  already expects — those nodes require **no changes**.
- Produces: `metrics` output — `{"final_train_loss": float, "final_val_loss": float}`.
- Produces: `execute(inputs, params, progress_callback=None)` — called by
  `execute_pipeline` (Task 2) with a callback that fires once per epoch as
  `{"event": "progress", "epoch": int, "loss": float, "val_loss": float}`
  (executor injects `node_id`).

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_nodes_pytorch.py`:

```python
def _toy_architecture(in_features=2, hidden=8, out_features=2):
    input_node = _load_node_module("pytorch_models/input")
    linear = _load_node_module("pytorch_models/linear")
    relu = _load_node_module("pytorch_models/relu")

    train_df = _toy_frame()
    arch = input_node.execute(
        {"train_table": train_df}, {"target_column": "label", "random_state": 42}
    )["architecture"]
    arch = linear.execute({"architecture": arch}, {"out_features": hidden})["architecture"]
    arch = relu.execute({"architecture": arch}, {})["architecture"]
    arch = linear.execute({"architecture": arch}, {"out_features": out_features})["architecture"]
    return arch, train_df


def test_train_execute_trains_and_returns_predictable_model():
    train_node = _load_node_module("pytorch_models/train")
    architecture, train_df = _toy_architecture()

    outputs = train_node.execute(
        {"train_table": train_df, "test_table": train_df, "architecture": architecture},
        {
            "target_column": "label",
            "task_type": "classification",
            "loss_fn": "CrossEntropyLoss",
            "optimizer": "Adam",
            "learning_rate": 0.01,
            "epochs": 3,
            "batch_size": 8,
        },
    )

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2"]
    preds = model["estimator"].predict(train_df[model["feature_columns"]])
    assert len(preds) == len(train_df)

    metrics = outputs["metrics"]
    assert isinstance(metrics["final_train_loss"], float)
    assert isinstance(metrics["final_val_loss"], float)


def test_train_execute_calls_progress_callback_once_per_epoch():
    train_node = _load_node_module("pytorch_models/train")
    architecture, train_df = _toy_architecture()

    events = []
    train_node.execute(
        {"train_table": train_df, "test_table": train_df, "architecture": architecture},
        {
            "target_column": "label",
            "task_type": "classification",
            "loss_fn": "CrossEntropyLoss",
            "optimizer": "Adam",
            "learning_rate": 0.01,
            "epochs": 3,
            "batch_size": 8,
        },
        progress_callback=events.append,
    )

    assert [e["epoch"] for e in events] == [0, 1, 2]
    assert all(e["event"] == "progress" for e in events)
    assert all(isinstance(e["loss"], float) and isinstance(e["val_loss"], float) for e in events)


def test_train_codegen_emits_training_loop():
    train_node = _load_node_module("pytorch_models/train")
    lines = train_node.codegen(
        {"train_table": "n2_train", "test_table": "n2_test", "architecture": "n5_architecture"},
        {
            "target_column": "label",
            "task_type": "classification",
            "loss_fn": "CrossEntropyLoss",
            "optimizer": "Adam",
            "learning_rate": 0.001,
            "epochs": 5,
            "batch_size": 16,
        },
        {"model": "n6_model", "metrics": "n6_metrics"},
    )
    assert lines == [
        "n6_model_target = 'label'",
        "n6_model_X = n2_train.drop(columns=[n6_model_target])",
        "n6_model_feature_columns = list(n6_model_X.columns)",
        "n6_model_module = nn.Sequential(*n5_architecture)",
        "n6_model_X_train = torch.tensor(n6_model_X.values, dtype=torch.float32)",
        "n6_model_X_test = torch.tensor(n2_test[n6_model_feature_columns].values, dtype=torch.float32)",
        "n6_model_y_train = torch.tensor(n2_train[n6_model_target].values, dtype=torch.long)",
        "n6_model_y_test = torch.tensor(n2_test[n6_model_target].values, dtype=torch.long)",
        "n6_model_loss_fn = nn.CrossEntropyLoss()",
        "n6_model_optimizer = torch.optim.Adam(n6_model_module.parameters(), lr=0.001)",
        "n6_model_n = n6_model_X_train.shape[0]",
        "n6_model_train_loss = 0.0",
        "n6_model_val_loss = 0.0",
        "for n6_model_epoch in range(5):",
        "    n6_model_module.train()",
        "    n6_model_permutation = torch.randperm(n6_model_n)",
        "    n6_model_epoch_loss = 0.0",
        "    for n6_model_start in range(0, n6_model_n, 16):",
        "        n6_model_idx = n6_model_permutation[n6_model_start:n6_model_start + 16]",
        "        n6_model_xb = n6_model_X_train[n6_model_idx]",
        "        n6_model_yb = n6_model_y_train[n6_model_idx]",
        "        n6_model_optimizer.zero_grad()",
        "        n6_model_out = n6_model_module(n6_model_xb)",
        "        n6_model_loss = n6_model_loss_fn(n6_model_out, n6_model_yb)",
        "        n6_model_loss.backward()",
        "        n6_model_optimizer.step()",
        "        n6_model_epoch_loss += n6_model_loss.item() * len(n6_model_idx)",
        "    n6_model_train_loss = n6_model_epoch_loss / n6_model_n",
        "    n6_model_module.eval()",
        "    with torch.no_grad():",
        "        n6_model_val_loss = n6_model_loss_fn(n6_model_module(n6_model_X_test), n6_model_y_test).item()",
        "n6_model = _TorchPredictAdapter(n6_model_module, 'classification')",
        "n6_metrics = {'final_train_loss': float(n6_model_train_loss), 'final_val_loss': float(n6_model_val_loss)}",
    ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k train`
Expected: `FAIL`.

- [ ] **Step 3: Implement**

`engine/vmb_engine/nodes/pytorch_models/train/manifest.json`:

```json
{
    "id": "pytorch_models.train",
    "category": "Models (PyTorch)",
    "label": "Train",
    "inputs": [
        {"name": "train_table", "type": "Table"},
        {"name": "test_table", "type": "Table"},
        {"name": "architecture", "type": "Layer"}
    ],
    "outputs": [
        {"name": "model", "type": "Model"},
        {"name": "metrics", "type": "Metrics"}
    ],
    "params": [
        {"name": "target_column", "type": "text", "label": "Target Column", "default": ""},
        {
            "name": "task_type",
            "type": "select",
            "label": "Task Type",
            "default": "classification",
            "options": ["classification", "regression"]
        },
        {
            "name": "loss_fn",
            "type": "select",
            "label": "Loss Function",
            "default": "CrossEntropyLoss",
            "options": ["CrossEntropyLoss", "MSELoss"]
        },
        {
            "name": "optimizer",
            "type": "select",
            "label": "Optimizer",
            "default": "Adam",
            "options": ["Adam", "SGD"]
        },
        {"name": "learning_rate", "type": "number", "label": "Learning Rate", "default": 0.001},
        {"name": "epochs", "type": "number", "label": "Epochs", "default": 20},
        {"name": "batch_size", "type": "number", "label": "Batch Size", "default": 32}
    ],
    "long_running": true
}
```

`engine/vmb_engine/nodes/pytorch_models/train/node.py`:

```python
_ADAPTER_CLASS_SRC = (
    "class _TorchPredictAdapter:\n"
    "    def __init__(self, module, task_type):\n"
    "        self.module = module\n"
    "        self.task_type = task_type\n"
    "\n"
    "    def predict(self, X):\n"
    "        self.module.eval()\n"
    "        with torch.no_grad():\n"
    "            out = self.module(torch.tensor(X.values, dtype=torch.float32))\n"
    "        if self.task_type == 'classification':\n"
    "            return out.argmax(dim=1).numpy()\n"
    "        return out.squeeze(-1).numpy()"
)

IMPORTS = ["import torch", "import torch.nn as nn", _ADAPTER_CLASS_SRC]


class _TorchPredictAdapter:
    def __init__(self, module, task_type):
        self.module = module
        self.task_type = task_type

    def predict(self, X):
        import torch

        self.module.eval()
        with torch.no_grad():
            out = self.module(torch.tensor(X.values, dtype=torch.float32))
        if self.task_type == "classification":
            return out.argmax(dim=1).numpy()
        return out.squeeze(-1).numpy()


def execute(inputs: dict, params: dict, progress_callback=None) -> dict:
    import torch
    import torch.nn as nn

    target = params["target_column"]
    task_type = params["task_type"]
    train_df = inputs["train_table"]
    test_df = inputs["test_table"]
    architecture = inputs["architecture"]

    feature_columns = [c for c in train_df.columns if c != target]
    model = nn.Sequential(*architecture["modules"])

    X_train = torch.tensor(train_df[feature_columns].values, dtype=torch.float32)
    X_test = torch.tensor(test_df[feature_columns].values, dtype=torch.float32)
    if task_type == "classification":
        y_train = torch.tensor(train_df[target].values, dtype=torch.long)
        y_test = torch.tensor(test_df[target].values, dtype=torch.long)
    else:
        y_train = torch.tensor(train_df[target].values, dtype=torch.float32).unsqueeze(-1)
        y_test = torch.tensor(test_df[target].values, dtype=torch.float32).unsqueeze(-1)

    loss_fn = getattr(nn, params["loss_fn"])()
    optimizer = getattr(torch.optim, params["optimizer"])(
        model.parameters(), lr=params["learning_rate"]
    )

    batch_size = params["batch_size"]
    n = X_train.shape[0]
    train_loss = 0.0
    val_loss = 0.0

    for epoch in range(params["epochs"]):
        model.train()
        permutation = torch.randperm(n)
        epoch_loss = 0.0
        for start in range(0, n, batch_size):
            idx = permutation[start : start + batch_size]
            xb, yb = X_train[idx], y_train[idx]
            optimizer.zero_grad()
            out = model(xb)
            loss = loss_fn(out, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * len(idx)
        train_loss = epoch_loss / n

        model.eval()
        with torch.no_grad():
            val_loss = loss_fn(model(X_test), y_test).item()

        if progress_callback is not None:
            progress_callback(
                {"event": "progress", "epoch": epoch, "loss": train_loss, "val_loss": val_loss}
            )

    estimator = _TorchPredictAdapter(model, task_type)
    return {
        "model": {"estimator": estimator, "feature_columns": feature_columns},
        "metrics": {"final_train_loss": float(train_loss), "final_val_loss": float(val_loss)},
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    train_in = inputs["train_table"]
    test_in = inputs["test_table"]
    arch_in = inputs["architecture"]
    model_var = var_names["model"]
    metrics_var = var_names["metrics"]
    target = params["target_column"]
    task_type = params["task_type"]
    loss_fn = params["loss_fn"]
    optimizer = params["optimizer"]
    lr = params["learning_rate"]
    epochs = params["epochs"]
    batch_size = params["batch_size"]

    y_dtype = "torch.long" if task_type == "classification" else "torch.float32"
    unsqueeze = "" if task_type == "classification" else ".unsqueeze(-1)"

    return [
        f"{model_var}_target = {target!r}",
        f"{model_var}_X = {train_in}.drop(columns=[{model_var}_target])",
        f"{model_var}_feature_columns = list({model_var}_X.columns)",
        f"{model_var}_module = nn.Sequential(*{arch_in})",
        f"{model_var}_X_train = torch.tensor({model_var}_X.values, dtype=torch.float32)",
        f"{model_var}_X_test = torch.tensor({test_in}[{model_var}_feature_columns].values, dtype=torch.float32)",
        f"{model_var}_y_train = torch.tensor({train_in}[{model_var}_target].values, dtype={y_dtype}){unsqueeze}",
        f"{model_var}_y_test = torch.tensor({test_in}[{model_var}_target].values, dtype={y_dtype}){unsqueeze}",
        f"{model_var}_loss_fn = nn.{loss_fn}()",
        f"{model_var}_optimizer = torch.optim.{optimizer}({model_var}_module.parameters(), lr={lr})",
        f"{model_var}_n = {model_var}_X_train.shape[0]",
        f"{model_var}_train_loss = 0.0",
        f"{model_var}_val_loss = 0.0",
        f"for {model_var}_epoch in range({epochs}):",
        f"    {model_var}_module.train()",
        f"    {model_var}_permutation = torch.randperm({model_var}_n)",
        f"    {model_var}_epoch_loss = 0.0",
        f"    for {model_var}_start in range(0, {model_var}_n, {batch_size}):",
        f"        {model_var}_idx = {model_var}_permutation[{model_var}_start:{model_var}_start + {batch_size}]",
        f"        {model_var}_xb = {model_var}_X_train[{model_var}_idx]",
        f"        {model_var}_yb = {model_var}_y_train[{model_var}_idx]",
        f"        {model_var}_optimizer.zero_grad()",
        f"        {model_var}_out = {model_var}_module({model_var}_xb)",
        f"        {model_var}_loss = {model_var}_loss_fn({model_var}_out, {model_var}_yb)",
        f"        {model_var}_loss.backward()",
        f"        {model_var}_optimizer.step()",
        f"        {model_var}_epoch_loss += {model_var}_loss.item() * len({model_var}_idx)",
        f"    {model_var}_train_loss = {model_var}_epoch_loss / {model_var}_n",
        f"    {model_var}_module.eval()",
        "    with torch.no_grad():",
        f"        {model_var}_val_loss = {model_var}_loss_fn({model_var}_module({model_var}_X_test), {model_var}_y_test).item()",
        f"{model_var} = _TorchPredictAdapter({model_var}_module, {task_type!r})",
        f"{metrics_var} = {{'final_train_loss': float({model_var}_train_loss), "
        f"'final_val_loss': float({model_var}_val_loss)}}",
    ]
```

Note: `_TorchPredictAdapter` is defined twice on purpose — once as a real
class for `execute()` to instantiate, once as literal source text in
`_ADAPTER_CLASS_SRC` for `codegen()` to emit into exported scripts (via the
existing `IMPORTS` dedup mechanism in `codegen.py`). This mirrors how every
other node in this codebase keeps `execute()` and `codegen()` as
independently-written parallel implementations — the equivalence test
(Task 7) is what guarantees they don't drift, not shared code.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_nodes_pytorch.py -v -k train`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/nodes/pytorch_models/train engine/tests/test_nodes_pytorch.py
git commit -m "engine: add pytorch_models.train node"
```

---

## Task 7: Executor/codegen equivalence test for a full MLP pipeline

**Files:**
- Test: `engine/tests/test_equivalence.py` (append)

**Interfaces:**
- Consumes: `pytorch_models.input/linear/relu/train`, `evaluation.evaluate_classifier`
  (all existing by this point).

- [ ] **Step 1: Write the failing test**

Append to `engine/tests/test_equivalence.py`:

```python
def test_executor_and_exported_script_agree_with_mlp_pipeline(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i % 2}" for i in range(60)))

    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": str(csv_path)}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
                {
                    "id": "n3",
                    "type": "pytorch_models.input",
                    "params": {"target_column": "label", "random_state": 42},
                },
                {"id": "n4", "type": "pytorch_models.linear", "params": {"out_features": 8}},
                {"id": "n5", "type": "pytorch_models.relu", "params": {}},
                {"id": "n6", "type": "pytorch_models.linear", "params": {"out_features": 2}},
                {
                    "id": "n7",
                    "type": "pytorch_models.train",
                    "params": {
                        "target_column": "label",
                        "task_type": "classification",
                        "loss_fn": "CrossEntropyLoss",
                        "optimizer": "Adam",
                        "learning_rate": 0.01,
                        "epochs": 3,
                        "batch_size": 16,
                    },
                },
                {
                    "id": "n8",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
                {"from": "n3.architecture", "to": "n4.architecture"},
                {"from": "n4.architecture", "to": "n5.architecture"},
                {"from": "n5.architecture", "to": "n6.architecture"},
                {"from": "n2.train", "to": "n7.train_table"},
                {"from": "n2.test", "to": "n7.test_table"},
                {"from": "n6.architecture", "to": "n7.architecture"},
                {"from": "n7.model", "to": "n8.model"},
                {"from": "n2.test", "to": "n8.test_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_accuracy = context["n8.metrics"]["accuracy"]

    code = generate_code(ir, registry)
    script_path = tmp_path / "exported.py"
    script_path.write_text(code)

    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    match = re.search(r"'accuracy':\s*([0-9.]+)", result.stdout)
    assert match is not None, f"no accuracy found in script output:\n{result.stdout}"
    script_accuracy = float(match.group(1))

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-6)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_equivalence.py -v -k mlp`
Expected: `FAIL` if any node in the chain has a bug (this test is the
end-to-end integration check for Tasks 3-6 — if Tasks 3-6 were implemented
correctly it may already pass; run it regardless to confirm).

- [ ] **Step 3: Fix any mismatch**

If `executor_accuracy != script_accuracy`, the most likely cause is a
line-order or variable-naming mismatch between a node's `execute()` and
`codegen()` — compare them side by side against Tasks 3-6's implementations
line by line; the RNG consumption order (weight init in `Linear`, batch
shuffling in `Train`) must happen in identical sequence in both paths.

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_equivalence.py -v -k mlp`
Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add engine/tests/test_equivalence.py
git commit -m "engine: add executor/codegen equivalence test for MLP pipeline"
```

---

## Task 8: Async execution + WebSocket progress endpoint

**Files:**
- Create: `engine/vmb_engine/runs.py`
- Modify: `engine/vmb_engine/api.py`
- Test: `engine/tests/test_api.py` (append)

**Interfaces:**
- Produces: `RunManager` class — `start(ir, registry) -> str` (returns a
  `run_id`, schedules background execution), `stream(run_id) -> AsyncIterator[dict]`
  (yields queued events until `complete`/`node_error`).
- Produces: `POST /pipeline/run` now returns `202 {"run_id": ...}` instead
  of `200 {"metrics": ...}` whenever the submitted pipeline contains a
  `long_running` node (detected via `pipeline_has_long_running_node` from
  Task 2); unchanged for every other pipeline.
- Produces: `WS /ws/runs/{run_id}`, streaming JSON events
  `{"event": "progress", "node_id", "epoch", "loss", "val_loss"}`,
  `{"event": "node_error", "node_id", "error"}`, `{"event": "complete", "metrics"}`.

- [ ] **Step 1: Write the failing tests**

Append to `engine/tests/test_api.py`:

```python
def _mlp_pipeline(csv_path: str) -> dict:
    return {
        "nodes": [
            {"id": "n1", "type": "data.csv_loader", "params": {"path": csv_path}},
            {
                "id": "n2",
                "type": "data.train_test_split",
                "params": {"test_size": 0.25, "random_state": 42},
            },
            {
                "id": "n3",
                "type": "pytorch_models.input",
                "params": {"target_column": "label", "random_state": 42},
            },
            {"id": "n4", "type": "pytorch_models.linear", "params": {"out_features": 4}},
            {"id": "n5", "type": "pytorch_models.relu", "params": {}},
            {"id": "n6", "type": "pytorch_models.linear", "params": {"out_features": 2}},
            {
                "id": "n7",
                "type": "pytorch_models.train",
                "params": {
                    "target_column": "label",
                    "task_type": "classification",
                    "loss_fn": "CrossEntropyLoss",
                    "optimizer": "Adam",
                    "learning_rate": 0.01,
                    "epochs": 2,
                    "batch_size": 8,
                },
            },
        ],
        "edges": [
            {"from": "n1.table", "to": "n2.table"},
            {"from": "n2.train", "to": "n3.train_table"},
            {"from": "n3.architecture", "to": "n4.architecture"},
            {"from": "n4.architecture", "to": "n5.architecture"},
            {"from": "n5.architecture", "to": "n6.architecture"},
            {"from": "n2.train", "to": "n7.train_table"},
            {"from": "n2.test", "to": "n7.test_table"},
            {"from": "n6.architecture", "to": "n7.architecture"},
        ],
    }


def test_run_pipeline_with_long_running_node_returns_run_id(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i % 2}" for i in range(40)))

    response = client.post("/pipeline/run", json=_mlp_pipeline(str(csv_path)))

    assert response.status_code == 202
    assert "run_id" in response.json()


def test_ws_run_events_streams_progress_then_complete(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i % 2}" for i in range(40)))

    run_id = client.post("/pipeline/run", json=_mlp_pipeline(str(csv_path))).json()["run_id"]

    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        events = []
        while True:
            event = ws.receive_json()
            events.append(event)
            if event["event"] in ("complete", "node_error"):
                break

    progress_events = [e for e in events if e["event"] == "progress"]
    assert [e["epoch"] for e in progress_events] == [0, 1]
    assert all(e["node_id"] == "n7" for e in progress_events)
    assert events[-1]["event"] == "complete"
    assert "n7.metrics" in events[-1]["metrics"]


def test_ws_run_events_streams_node_error(client, tmp_path):
    pipeline = _mlp_pipeline(str(tmp_path / "does_not_exist.csv"))

    run_id = client.post("/pipeline/run", json=pipeline).json()["run_id"]

    with client.websocket_connect(f"/ws/runs/{run_id}") as ws:
        event = ws.receive_json()

    assert event["event"] == "node_error"
    assert event["node_id"] == "n1"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_api.py -v -k "long_running or ws_run"`
Expected: `FAIL` — `202` assertion fails (currently always `200`), and
`/ws/runs/{run_id}` doesn't exist (`404`/connection rejected).

- [ ] **Step 3: Implement**

Create `engine/vmb_engine/runs.py`:

```python
import asyncio
import uuid
from typing import AsyncIterator

from vmb_engine.executor import ExecutorError, collect_metrics_outputs, execute_pipeline
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


class RunManager:
    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue] = {}

    def start(self, ir: PipelineIR, registry: NodeRegistry) -> str:
        run_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        self._queues[run_id] = queue
        loop = asyncio.get_running_loop()

        def progress_callback(event: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, event)

        async def run() -> None:
            try:
                context = await asyncio.to_thread(
                    execute_pipeline, ir, registry, progress_callback
                )
            except ExecutorError:
                return
            metrics = collect_metrics_outputs(ir, registry, context)
            await queue.put({"event": "complete", "metrics": metrics})

        asyncio.create_task(run())
        return run_id

    async def stream(self, run_id: str) -> AsyncIterator[dict]:
        queue = self._queues[run_id]
        while True:
            event = await queue.get()
            yield event
            if event["event"] in ("complete", "node_error"):
                del self._queues[run_id]
                return
```

Modify `engine/vmb_engine/api.py`. Update the imports at the top:

```python
import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from vmb_engine.codegen import generate_code
from vmb_engine.executor import (
    ExecutorError,
    collect_metrics_outputs,
    execute_pipeline,
    pipeline_has_long_running_node,
)
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry, RegistryError
from vmb_engine.runs import RunManager
```

Inside `create_app()`, after `registry.scan(...)`, add:

```python
    run_manager = RunManager()
```

Replace the `run_pipeline` route with:

```python
    @app.post("/pipeline/run")
    async def run_pipeline(ir: PipelineIR):
        try:
            if pipeline_has_long_running_node(ir, registry):
                run_id = run_manager.start(ir, registry)
                return JSONResponse(status_code=202, content={"run_id": run_id})
            context = await asyncio.to_thread(execute_pipeline, ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        return {"metrics": collect_metrics_outputs(ir, registry, context)}
```

Add the new WebSocket route (anywhere after `run_pipeline`):

```python
    @app.websocket("/ws/runs/{run_id}")
    async def stream_run_events(websocket: WebSocket, run_id: str):
        await websocket.accept()
        async for event in run_manager.stream(run_id):
            await websocket.send_json(event)
        await websocket.close()
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_api.py -v`
Expected: all `PASS`, including the pre-existing tests (`test_run_pipeline_returns_metrics`
etc.) unmodified.

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest engine/tests -v`
Expected: all `PASS`.

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/runs.py engine/vmb_engine/api.py engine/tests/test_api.py
git commit -m "engine: add async execution + WebSocket progress for long-running nodes"
```
