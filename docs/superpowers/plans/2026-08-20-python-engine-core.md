# Python Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python engine core — pipeline IR, plugin/node registry, DAG
executor, codegen, and a FastAPI HTTP API — with a minimal working tabular
node set (CSV loader, train/test split, a sklearn model, an evaluator) that
proves the whole architecture end-to-end: a JSON pipeline can be executed
in-process AND exported as a standalone Python script that produces
equivalent results, all without any UI.

**Architecture:** A `PipelineIR` (pydantic models) of typed nodes + edges is
the single source of truth. A `NodeRegistry` scans directories for
`manifest.json` + `node.py` pairs (each exposing `execute()`, `codegen()`,
`IMPORTS`) and validates them at scan time. An `executor` topologically sorts
the IR and calls each node's `execute()`, threading outputs through a context
dict keyed by `"{node_id}.{port}"`. A `codegen` module walks the same sorted
IR and calls each node's `codegen()` instead, concatenating source lines into
one script. A thin FastAPI app exposes the registry, run, and codegen
operations over HTTP for the (separately planned) frontend to consume.

**Tech Stack:** Python 3.11+, FastAPI, pydantic v2, pandas, scikit-learn,
pytest, httpx (for `TestClient`).

**Spec:** `docs/superpowers/specs/2026-08-20-visual-ml-builder-design.md`

## Global Constraints

- Python 3.11 or newer (spec: engine `pyproject.toml` requires-python).
- pydantic v2 models for the IR and manifests (not v1 `BaseModel.Config`).
- Node modules expose exactly three names: `IMPORTS: list[str]`,
  `execute(inputs: dict, params: dict) -> dict`,
  `codegen(inputs: dict[str, str], params: dict, var_names: dict[str, str]) -> list[str]`.
- No WebSocket/async streaming in this plan — all nodes here are fast/sync;
  background execution + progress streaming is deferred to a later plan that
  adds PyTorch training nodes (out of scope here, per spec's Future Work
  split into sub-projects).
- All file paths below are relative to the repo root
  `/home/shreyash/projects/visual_model_builder`.

---

## File Structure

```
engine/
  pyproject.toml
  vmb_engine/
    __init__.py
    ir.py                          # Pydantic IR models
    manifest.py                    # Pydantic manifest.json model
    registry.py                    # NodeRegistry: scan + validate + lookup
    executor.py                    # topological sort + execute_pipeline()
    codegen.py                     # topological sort + generate_code()
    api.py                         # FastAPI app: /nodes, /pipeline/run, /pipeline/codegen
    nodes/
      data/
        csv_loader/
          manifest.json
          node.py
        train_test_split/
          manifest.json
          node.py
      sklearn_models/
        random_forest/
          manifest.json
          node.py
      evaluation/
        evaluate_classifier/
          manifest.json
          node.py
  tests/
    __init__.py
    test_ir.py
    test_manifest.py
    test_registry.py
    test_nodes_data.py
    test_nodes_sklearn.py
    test_executor.py
    test_codegen.py
    test_equivalence.py
    test_api.py
```

---

### Task 1: Project scaffolding + Pipeline IR

**Files:**
- Create: `engine/pyproject.toml`
- Create: `engine/vmb_engine/__init__.py`
- Create: `engine/vmb_engine/ir.py`
- Create: `engine/tests/__init__.py`
- Test: `engine/tests/test_ir.py`

**Interfaces:**
- Produces: `Port(name: str, type: str)`, `NodeSpec(id: str, type: str, params: dict)`,
  `EdgeSpec(from_: str, to: str)` (JSON key `"from"`), `PipelineIR(nodes: list[NodeSpec], edges: list[EdgeSpec])`
  with `PipelineIR.model_validate_json(text)` and `.model_dump_json(by_alias=True)`.

- [ ] **Step 1: Create the package skeleton and pyproject.toml**

Create `engine/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "vmb-engine"
version = "0.1.0"
description = "Visual Model Builder Python engine"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn>=0.29.0",
    "pydantic>=2.6.0",
    "pandas>=2.2.0",
    "scikit-learn>=1.4.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
]

[tool.setuptools.packages.find]
include = ["vmb_engine*"]
```

Create `engine/vmb_engine/__init__.py` (empty file).
Create `engine/tests/__init__.py` (empty file).

- [ ] **Step 2: Set up a virtualenv and install the package editable**

```bash
cd /home/shreyash/projects/visual_model_builder
python3 -m venv .venv
.venv/bin/pip install -e "engine[dev]"
```

- [ ] **Step 3: Write the failing test for the IR**

Create `engine/tests/test_ir.py`:

```python
import json
from vmb_engine.ir import EdgeSpec, NodeSpec, PipelineIR


def test_node_spec_roundtrip():
    node = NodeSpec(id="n1", type="data.csv_loader", params={"path": "iris.csv"})
    assert node.id == "n1"
    assert node.type == "data.csv_loader"
    assert node.params == {"path": "iris.csv"}


def test_edge_spec_uses_from_alias():
    edge = EdgeSpec.model_validate({"from": "n1.table", "to": "n2.table"})
    assert edge.from_ == "n1.table"
    assert edge.to == "n2.table"
    # serializes back using the "from" alias, not "from_"
    dumped = edge.model_dump(by_alias=True)
    assert dumped == {"from": "n1.table", "to": "n2.table"}


def test_pipeline_ir_json_roundtrip():
    raw = {
        "nodes": [
            {"id": "n1", "type": "data.csv_loader", "params": {"path": "iris.csv"}},
            {"id": "n2", "type": "data.train_test_split", "params": {"test_size": 0.2}},
        ],
        "edges": [
            {"from": "n1.table", "to": "n2.table"},
        ],
    }
    ir = PipelineIR.model_validate(raw)
    assert len(ir.nodes) == 2
    assert len(ir.edges) == 1
    assert ir.nodes[0].id == "n1"
    assert ir.edges[0].from_ == "n1.table"

    dumped = json.loads(ir.model_dump_json(by_alias=True))
    assert dumped == raw
```

- [ ] **Step 4: Run test to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_ir.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vmb_engine.ir'` (or similar import error).

- [ ] **Step 5: Implement the IR models**

Create `engine/vmb_engine/ir.py`:

```python
from pydantic import BaseModel, ConfigDict, Field


class Port(BaseModel):
    name: str
    type: str


class NodeSpec(BaseModel):
    id: str
    type: str
    params: dict = Field(default_factory=dict)


class EdgeSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str


class PipelineIR(BaseModel):
    nodes: list[NodeSpec] = Field(default_factory=list)
    edges: list[EdgeSpec] = Field(default_factory=list)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_ir.py -v`
Expected: PASS (3 passed)

- [ ] **Step 7: Commit**

```bash
git add engine/pyproject.toml engine/vmb_engine/__init__.py engine/vmb_engine/ir.py engine/tests/__init__.py engine/tests/test_ir.py
git commit -m "Add engine scaffolding and pipeline IR models"
```

---

### Task 2: Node manifest schema

**Files:**
- Create: `engine/vmb_engine/manifest.py`
- Test: `engine/tests/test_manifest.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ParamSpec(name: str, type: str, label: str, default: object)`,
  `NodeManifest(id: str, category: str, label: str, inputs: list[Port], outputs: list[Port], params: list[ParamSpec], long_running: bool = False)`
  with `NodeManifest.model_validate_json(text)`.

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_manifest.py`:

```python
import json
from vmb_engine.manifest import NodeManifest


MANIFEST_JSON = {
    "id": "data.csv_loader",
    "category": "Data",
    "label": "CSV Loader",
    "inputs": [],
    "outputs": [{"name": "table", "type": "Table"}],
    "params": [
        {"name": "path", "type": "text", "label": "File Path", "default": ""}
    ],
}


def test_manifest_parses_ports_and_params():
    manifest = NodeManifest.model_validate(MANIFEST_JSON)
    assert manifest.id == "data.csv_loader"
    assert manifest.outputs[0].name == "table"
    assert manifest.outputs[0].type == "Table"
    assert manifest.params[0].name == "path"
    assert manifest.params[0].default == ""


def test_manifest_long_running_defaults_false():
    manifest = NodeManifest.model_validate(MANIFEST_JSON)
    assert manifest.long_running is False


def test_manifest_long_running_can_be_set():
    raw = dict(MANIFEST_JSON, long_running=True)
    manifest = NodeManifest.model_validate(raw)
    assert manifest.long_running is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vmb_engine.manifest'`

- [ ] **Step 3: Implement the manifest model**

Create `engine/vmb_engine/manifest.py`:

```python
from pydantic import BaseModel, Field

from vmb_engine.ir import Port


class ParamSpec(BaseModel):
    name: str
    type: str
    label: str
    default: object = None


class NodeManifest(BaseModel):
    id: str
    category: str
    label: str
    inputs: list[Port] = Field(default_factory=list)
    outputs: list[Port] = Field(default_factory=list)
    params: list[ParamSpec] = Field(default_factory=list)
    long_running: bool = False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_manifest.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/manifest.py engine/tests/test_manifest.py
git commit -m "Add node manifest schema"
```

---

### Task 3: Node registry

**Files:**
- Create: `engine/vmb_engine/registry.py`
- Test: `engine/tests/test_registry.py`

**Interfaces:**
- Consumes: `NodeManifest` from Task 2 (`vmb_engine.manifest`).
- Produces: `NodeDef(manifest: NodeManifest, execute: Callable, codegen: Callable, imports: list[str])`,
  `NodeRegistry` with `.scan(paths: list[Path]) -> None`, `.get(node_type: str) -> NodeDef`,
  `.all() -> list[NodeManifest]`. Raises `RegistryError` (defined in this module) on
  a malformed plugin directory (missing `manifest.json`, missing `execute`/`codegen`,
  or a manifest `id` that collides with an already-registered node).

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_registry.py`:

```python
import json
import textwrap
from pathlib import Path

import pytest

from vmb_engine.registry import NodeRegistry, RegistryError


def _write_plugin(tmp_path: Path, node_id: str, *, missing_codegen: bool = False) -> Path:
    plugin_dir = tmp_path / node_id.replace(".", "_")
    plugin_dir.mkdir()
    manifest = {
        "id": node_id,
        "category": "Test",
        "label": "Test Node",
        "inputs": [],
        "outputs": [{"name": "out", "type": "Table"}],
        "params": [],
    }
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest))

    if missing_codegen:
        body = """
        IMPORTS = []

        def execute(inputs, params):
            return {"out": 1}
        """
    else:
        body = """
        IMPORTS = ["import pandas as pd"]

        def execute(inputs, params):
            return {"out": 1}

        def codegen(inputs, params, var_names):
            return [f"{var_names['out']} = 1"]
        """
    (plugin_dir / "node.py").write_text(textwrap.dedent(body))
    return plugin_dir


def test_scan_registers_valid_node(tmp_path):
    plugin_dir = _write_plugin(tmp_path, "test.valid_node")
    registry = NodeRegistry()
    registry.scan([tmp_path])

    node_def = registry.get("test.valid_node")
    assert node_def.manifest.id == "test.valid_node"
    assert node_def.execute({}, {}) == {"out": 1}
    assert node_def.codegen({}, {}, {"out": "x"}) == ["x = 1"]
    assert node_def.imports == ["import pandas as pd"]


def test_scan_raises_on_missing_codegen(tmp_path):
    _write_plugin(tmp_path, "test.broken_node", missing_codegen=True)
    registry = NodeRegistry()

    with pytest.raises(RegistryError, match="codegen"):
        registry.scan([tmp_path])


def test_get_unknown_type_raises(tmp_path):
    registry = NodeRegistry()
    registry.scan([tmp_path])  # empty dir, nothing to register

    with pytest.raises(RegistryError, match="unknown node type"):
        registry.get("nope.does_not_exist")


def test_all_returns_manifests(tmp_path):
    _write_plugin(tmp_path, "test.node_a")
    _write_plugin(tmp_path, "test.node_b")
    registry = NodeRegistry()
    registry.scan([tmp_path])

    ids = sorted(m.id for m in registry.all())
    assert ids == ["test.node_a", "test.node_b"]


def test_scan_raises_on_missing_manifest(tmp_path):
    plugin_dir = tmp_path / "no_manifest"
    plugin_dir.mkdir()
    (plugin_dir / "node.py").write_text(
        "IMPORTS = []\n"
        "def execute(inputs, params):\n"
        "    return {}\n"
        "def codegen(inputs, params, var_names):\n"
        "    return []\n"
    )
    registry = NodeRegistry()

    with pytest.raises(RegistryError, match="missing manifest"):
        registry.scan([tmp_path])


def test_scan_raises_on_node_module_execution_error(tmp_path):
    plugin_dir = tmp_path / "broken_module"
    plugin_dir.mkdir()
    manifest = {
        "id": "test.broken_module",
        "category": "Test",
        "label": "Broken Module",
        "inputs": [],
        "outputs": [{"name": "out", "type": "Table"}],
        "params": [],
    }
    (plugin_dir / "manifest.json").write_text(json.dumps(manifest))
    (plugin_dir / "node.py").write_text("raise RuntimeError('boom')\n")
    registry = NodeRegistry()

    with pytest.raises(RegistryError, match="error executing"):
        registry.scan([tmp_path])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vmb_engine.registry'`

- [ ] **Step 3: Implement the registry**

Create `engine/vmb_engine/registry.py`:

```python
import importlib.util
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from vmb_engine.manifest import NodeManifest


class RegistryError(Exception):
    pass


@dataclass
class NodeDef:
    manifest: NodeManifest
    execute: Callable[[dict, dict], dict]
    codegen: Callable[[dict, dict, dict], list[str]]
    imports: list[str]


class NodeRegistry:
    def __init__(self) -> None:
        self._nodes: dict[str, NodeDef] = {}

    def scan(self, paths: list[Path]) -> None:
        for base in paths:
            if not base.exists():
                continue
            candidates = {p.parent for p in base.rglob("manifest.json")}
            candidates |= {p.parent for p in base.rglob("node.py")}
            for plugin_dir in sorted(candidates):
                self._load_plugin(plugin_dir)

    def _load_plugin(self, plugin_dir: Path) -> None:
        manifest_path = plugin_dir / "manifest.json"
        node_path = plugin_dir / "node.py"

        if not manifest_path.exists():
            raise RegistryError(f"{plugin_dir}: missing manifest.json")

        try:
            manifest = NodeManifest.model_validate(json.loads(manifest_path.read_text()))
        except Exception as exc:
            raise RegistryError(f"{plugin_dir}: invalid manifest.json: {exc}") from exc

        if manifest.id in self._nodes:
            raise RegistryError(f"{plugin_dir}: duplicate node id '{manifest.id}'")

        if not node_path.exists():
            raise RegistryError(f"{plugin_dir}: missing node.py")

        spec = importlib.util.spec_from_file_location(
            f"vmb_engine_plugin_{manifest.id.replace('.', '_')}", node_path
        )
        if spec is None or spec.loader is None:
            raise RegistryError(f"{plugin_dir}: could not load node.py")
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception as exc:
            raise RegistryError(f"{plugin_dir}: error executing node.py: {exc}") from exc

        execute = getattr(module, "execute", None)
        codegen = getattr(module, "codegen", None)
        if execute is None:
            raise RegistryError(f"{plugin_dir}: node.py missing execute()")
        if codegen is None:
            raise RegistryError(f"{plugin_dir}: node.py missing codegen()")

        imports = getattr(module, "IMPORTS", [])

        self._nodes[manifest.id] = NodeDef(
            manifest=manifest, execute=execute, codegen=codegen, imports=imports
        )

    def get(self, node_type: str) -> NodeDef:
        if node_type not in self._nodes:
            raise RegistryError(f"unknown node type '{node_type}'")
        return self._nodes[node_type]

    def all(self) -> list[NodeManifest]:
        return [node_def.manifest for node_def in self._nodes.values()]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_registry.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/registry.py engine/tests/test_registry.py
git commit -m "Add node registry with plugin scanning"
```

---

### Task 4: Data nodes — csv_loader and train_test_split

**Files:**
- Create: `engine/vmb_engine/nodes/data/csv_loader/manifest.json`
- Create: `engine/vmb_engine/nodes/data/csv_loader/node.py`
- Create: `engine/vmb_engine/nodes/data/train_test_split/manifest.json`
- Create: `engine/vmb_engine/nodes/data/train_test_split/node.py`
- Test: `engine/tests/test_nodes_data.py`

**Interfaces:**
- Consumes: nothing new (plain functions matching the `execute`/`codegen`/`IMPORTS`
  contract from Task 3's registry tests).
- Produces: `data.csv_loader` node with output port `table: Table` (pandas
  `DataFrame`). `data.train_test_split` node with input port `table: Table`
  and output ports `train: Table`, `test: Table` (pandas `DataFrame`s that
  still contain the target column — model nodes extract X/y themselves via
  their own `target_column` param).

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_nodes_data.py`:

```python
import importlib.util
import sys
from pathlib import Path

import pandas as pd

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def _load_node_module(rel_path: str):
    node_path = NODES_DIR / rel_path / "node.py"
    spec = importlib.util.spec_from_file_location(rel_path.replace("/", "_"), node_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_csv_loader_execute_reads_csv(tmp_path):
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text("a,b,label\n1,2,0\n3,4,1\n")

    csv_loader = _load_node_module("data/csv_loader")
    outputs = csv_loader.execute({}, {"path": str(csv_path)})

    df = outputs["table"]
    assert list(df.columns) == ["a", "b", "label"]
    assert len(df) == 2


def test_csv_loader_codegen_emits_read_csv():
    csv_loader = _load_node_module("data/csv_loader")
    lines = csv_loader.codegen({}, {"path": "iris.csv"}, {"table": "n1_table"})
    assert lines == ["n1_table = pd.read_csv('iris.csv')"]


def test_train_test_split_execute_splits_rows():
    tts = _load_node_module("data/train_test_split")
    df = pd.DataFrame({"a": range(10), "label": [0, 1] * 5})

    outputs = tts.execute(
        {"table": df}, {"test_size": 0.2, "random_state": 42}
    )

    assert len(outputs["train"]) == 8
    assert len(outputs["test"]) == 2
    assert set(outputs["train"].columns) == {"a", "label"}


def test_train_test_split_codegen_emits_sklearn_call():
    tts = _load_node_module("data/train_test_split")
    lines = tts.codegen(
        {"table": "n1_table"},
        {"test_size": 0.2, "random_state": 42},
        {"train": "n2_train", "test": "n2_test"},
    )
    assert lines == [
        "n2_train, n2_test = train_test_split(n1_table, test_size=0.2, random_state=42)"
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_data.py -v`
Expected: FAIL — `node.py` files don't exist yet (FileNotFoundError from `spec_from_file_location`/`exec_module`).

- [ ] **Step 3: Implement the csv_loader node**

Create `engine/vmb_engine/nodes/data/csv_loader/manifest.json`:

```json
{
    "id": "data.csv_loader",
    "category": "Data",
    "label": "CSV Loader",
    "inputs": [],
    "outputs": [{"name": "table", "type": "Table"}],
    "params": [
        {"name": "path", "type": "text", "label": "File Path", "default": ""}
    ]
}
```

Create `engine/vmb_engine/nodes/data/csv_loader/node.py`:

```python
IMPORTS = ["import pandas as pd"]


def execute(inputs: dict, params: dict) -> dict:
    import pandas as pd

    df = pd.read_csv(params["path"])
    return {"table": df}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    out_var = var_names["table"]
    return [f"{out_var} = pd.read_csv({params['path']!r})"]
```

- [ ] **Step 4: Implement the train_test_split node**

Create `engine/vmb_engine/nodes/data/train_test_split/manifest.json`:

```json
{
    "id": "data.train_test_split",
    "category": "Data",
    "label": "Train/Test Split",
    "inputs": [{"name": "table", "type": "Table"}],
    "outputs": [
        {"name": "train", "type": "Table"},
        {"name": "test", "type": "Table"}
    ],
    "params": [
        {"name": "test_size", "type": "number", "label": "Test Size", "default": 0.2},
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

Create `engine/vmb_engine/nodes/data/train_test_split/node.py`:

```python
IMPORTS = ["from sklearn.model_selection import train_test_split"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.model_selection import train_test_split

    train_df, test_df = train_test_split(
        inputs["table"],
        test_size=params["test_size"],
        random_state=params["random_state"],
    )
    return {"train": train_df, "test": test_df}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["table"]
    train_var = var_names["train"]
    test_var = var_names["test"]
    test_size = params["test_size"]
    random_state = params["random_state"]
    return [
        f"{train_var}, {test_var} = train_test_split("
        f"{in_var}, test_size={test_size}, random_state={random_state})"
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_data.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/nodes/data engine/tests/test_nodes_data.py
git commit -m "Add csv_loader and train_test_split nodes"
```

---

### Task 5: sklearn random_forest node + evaluate_classifier node

**Files:**
- Create: `engine/vmb_engine/nodes/sklearn_models/random_forest/manifest.json`
- Create: `engine/vmb_engine/nodes/sklearn_models/random_forest/node.py`
- Create: `engine/vmb_engine/nodes/evaluation/evaluate_classifier/manifest.json`
- Create: `engine/vmb_engine/nodes/evaluation/evaluate_classifier/node.py`
- Test: `engine/tests/test_nodes_sklearn.py`

**Interfaces:**
- Consumes: pandas `DataFrame`s shaped like `data.train_test_split`'s outputs
  from Task 4 (target column included, name given by each node's own
  `target_column` param).
- Produces: `sklearn_models.random_forest` node — input `train_table: Table`,
  output `model: Model` where the `Model` value is
  `{"estimator": <fitted sklearn estimator>, "feature_columns": list[str]}`.
  `evaluation.evaluate_classifier` node — inputs `model: Model`,
  `test_table: Table`, output `metrics: Metrics` where the `Metrics` value is
  `{"accuracy": float}`.

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_nodes_sklearn.py`:

```python
import importlib.util
from pathlib import Path

import pandas as pd

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


def test_random_forest_execute_fits_model():
    rf = _load_node_module("sklearn_models/random_forest")
    train_df = _toy_frame()

    outputs = rf.execute(
        {"train_table": train_df},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
    )

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")


def test_random_forest_codegen_emits_fit_call():
    rf = _load_node_module("sklearn_models/random_forest")
    lines = rf.codegen(
        {"train_table": "n2_train"},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
        {"model": "n3_model"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model = RandomForestClassifier(n_estimators=10, random_state=42)",
        "n3_model.fit(n3_model_X, n3_model_y)",
    ]


def test_evaluate_classifier_execute_returns_accuracy():
    rf = _load_node_module("sklearn_models/random_forest")
    evaluator = _load_node_module("evaluation/evaluate_classifier")

    train_df = _toy_frame()
    model_outputs = rf.execute(
        {"train_table": train_df},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
    )

    metrics_outputs = evaluator.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label"},
    )

    accuracy = metrics_outputs["metrics"]["accuracy"]
    assert 0.0 <= accuracy <= 1.0


def test_evaluate_classifier_codegen_emits_accuracy_score():
    evaluator = _load_node_module("evaluation/evaluate_classifier")
    lines = evaluator.codegen(
        {"model": "n3_model", "test_table": "n2_test"},
        {"target_column": "label"},
        {"metrics": "n4_metrics"},
    )
    assert lines == [
        "n4_metrics_X = n2_test.drop(columns=['label'])",
        "n4_metrics_y = n2_test['label']",
        "n4_metrics_preds = n3_model.predict(n4_metrics_X)",
        "n4_metrics = {'accuracy': float(accuracy_score(n4_metrics_y, n4_metrics_preds))}",
        "print(n4_metrics)",
    ]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -v`
Expected: FAIL — node files don't exist yet.

- [ ] **Step 3: Implement the random_forest node**

Create `engine/vmb_engine/nodes/sklearn_models/random_forest/manifest.json`:

```json
{
    "id": "sklearn_models.random_forest",
    "category": "Models (sklearn)",
    "label": "Random Forest",
    "inputs": [{"name": "train_table", "type": "Table"}],
    "outputs": [{"name": "model", "type": "Model"}],
    "params": [
        {"name": "target_column", "type": "text", "label": "Target Column", "default": ""},
        {"name": "n_estimators", "type": "number", "label": "N Estimators", "default": 100},
        {"name": "random_state", "type": "number", "label": "Random State", "default": 42}
    ]
}
```

Create `engine/vmb_engine/nodes/sklearn_models/random_forest/node.py`:

```python
IMPORTS = ["from sklearn.ensemble import RandomForestClassifier"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.ensemble import RandomForestClassifier

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    model = RandomForestClassifier(
        n_estimators=params["n_estimators"], random_state=params["random_state"]
    )
    model.fit(X, y)

    return {"model": {"estimator": model, "feature_columns": list(X.columns)}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    out_var = var_names["model"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {in_var}.drop(columns=[{target!r}])",
        f"{out_var}_y = {in_var}[{target!r}]",
        f"{out_var} = RandomForestClassifier("
        f"n_estimators={params['n_estimators']}, random_state={params['random_state']})",
        f"{out_var}.fit({out_var}_X, {out_var}_y)",
    ]
```

- [ ] **Step 4: Implement the evaluate_classifier node**

Create `engine/vmb_engine/nodes/evaluation/evaluate_classifier/manifest.json`:

```json
{
    "id": "evaluation.evaluate_classifier",
    "category": "Evaluation",
    "label": "Evaluate Classifier",
    "inputs": [
        {"name": "model", "type": "Model"},
        {"name": "test_table", "type": "Table"}
    ],
    "outputs": [{"name": "metrics", "type": "Metrics"}],
    "params": [
        {"name": "target_column", "type": "text", "label": "Target Column", "default": ""}
    ]
}
```

Create `engine/vmb_engine/nodes/evaluation/evaluate_classifier/node.py`:

```python
IMPORTS = ["from sklearn.metrics import accuracy_score"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.metrics import accuracy_score

    target = params["target_column"]
    df = inputs["test_table"]
    model = inputs["model"]

    X = df[model["feature_columns"]]
    y = df[target]
    preds = model["estimator"].predict(X)

    return {"metrics": {"accuracy": float(accuracy_score(y, preds))}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    model_var = inputs["model"]
    test_var = inputs["test_table"]
    out_var = var_names["metrics"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {test_var}.drop(columns=[{target!r}])",
        f"{out_var}_y = {test_var}[{target!r}]",
        f"{out_var}_preds = {model_var}.predict({out_var}_X)",
        f"{out_var} = {{'accuracy': float(accuracy_score({out_var}_y, {out_var}_preds))}}",
        f"print({out_var})",
    ]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_nodes_sklearn.py -v`
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/nodes/sklearn_models engine/vmb_engine/nodes/evaluation engine/tests/test_nodes_sklearn.py
git commit -m "Add random_forest and evaluate_classifier nodes"
```

---

### Task 6: DAG executor

**Files:**
- Create: `engine/vmb_engine/executor.py`
- Test: `engine/tests/test_executor.py`

**Interfaces:**
- Consumes: `PipelineIR` (Task 1), `NodeRegistry`/`NodeDef` (Task 3).
- Produces: `topological_sort(ir: PipelineIR) -> list[str]` (raises
  `ExecutorError`, defined in this module, on a cycle or an edge referencing
  an unknown node id). `execute_pipeline(ir: PipelineIR, registry: NodeRegistry) -> dict[str, object]`
  returning a context dict keyed by `"{node_id}.{port}"` for every output
  port of every executed node.

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_executor.py`:

```python
from pathlib import Path

import pytest

from vmb_engine.executor import ExecutorError, execute_pipeline, topological_sort
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def registry():
    reg = NodeRegistry()
    reg.scan([NODES_DIR])
    return reg


def _pipeline(csv_path: str) -> PipelineIR:
    return PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": csv_path}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
                {
                    "id": "n3",
                    "type": "sklearn_models.random_forest",
                    "params": {"target_column": "label", "n_estimators": 10, "random_state": 42},
                },
                {
                    "id": "n4",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
                {"from": "n3.model", "to": "n4.model"},
                {"from": "n2.test", "to": "n4.test_table"},
            ],
        }
    )


def test_topological_sort_orders_dependencies_first(tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(20)))
    ir = _pipeline(str(csv_path))

    order = topological_sort(ir)

    assert order.index("n1") < order.index("n2")
    assert order.index("n2") < order.index("n3")
    assert order.index("n3") < order.index("n4")


def test_topological_sort_raises_on_cycle():
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "a", "type": "x", "params": {}},
                {"id": "b", "type": "x", "params": {}},
            ],
            "edges": [
                {"from": "a.out", "to": "b.in"},
                {"from": "b.out", "to": "a.in"},
            ],
        }
    )
    with pytest.raises(ExecutorError, match="cycle"):
        topological_sort(ir)


def test_execute_pipeline_runs_end_to_end(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))
    ir = _pipeline(str(csv_path))

    context = execute_pipeline(ir, registry)

    assert "n1.table" in context
    assert "n4.metrics" in context
    accuracy = context["n4.metrics"]["accuracy"]
    assert 0.0 <= accuracy <= 1.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_executor.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vmb_engine.executor'`

- [ ] **Step 3: Implement the executor**

Create `engine/vmb_engine/executor.py`:

```python
from collections import defaultdict, deque

from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


class ExecutorError(Exception):
    pass


def split_ref(ref: str) -> tuple[str, str]:
    node_id, _, port = ref.partition(".")
    return node_id, port


def topological_sort(ir: PipelineIR) -> list[str]:
    node_ids = [node.id for node in ir.nodes]
    node_id_set = set(node_ids)

    dependencies: dict[str, set[str]] = defaultdict(set)
    dependents: dict[str, set[str]] = defaultdict(set)

    for edge in ir.edges:
        from_node, _ = split_ref(edge.from_)
        to_node, _ = split_ref(edge.to)
        if from_node not in node_id_set:
            raise ExecutorError(f"edge references unknown node '{from_node}'")
        if to_node not in node_id_set:
            raise ExecutorError(f"edge references unknown node '{to_node}'")
        dependencies[to_node].add(from_node)
        dependents[from_node].add(to_node)

    in_degree = {node_id: len(dependencies[node_id]) for node_id in node_ids}
    queue = deque(sorted(node_id for node_id in node_ids if in_degree[node_id] == 0))

    order: list[str] = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for dependent in sorted(dependents[current]):
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    if len(order) != len(node_ids):
        raise ExecutorError("pipeline graph has a cycle")

    return order


def execute_pipeline(ir: PipelineIR, registry: NodeRegistry) -> dict[str, object]:
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

        outputs = node_def.execute(inputs, node_spec.params)

        for port in node_def.manifest.outputs:
            if port.name not in outputs:
                raise ExecutorError(
                    f"node '{node_id}' did not produce declared output '{port.name}'"
                )
            context[f"{node_id}.{port.name}"] = outputs[port.name]

    return context
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_executor.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/executor.py engine/tests/test_executor.py
git commit -m "Add DAG executor"
```

---

### Task 7: Code generation

**Files:**
- Create: `engine/vmb_engine/codegen.py`
- Test: `engine/tests/test_codegen.py`

**Interfaces:**
- Consumes: `PipelineIR` (Task 1), `NodeRegistry` (Task 3),
  `topological_sort` (Task 6, imported from `vmb_engine.executor`).
- Produces: `generate_code(ir: PipelineIR, registry: NodeRegistry) -> str`
  returning a complete, runnable Python script (deduped/sorted imports,
  then one block of statements per node in topological order).

- [ ] **Step 1: Write the failing test**

Create `engine/tests/test_codegen.py`:

```python
from pathlib import Path

import pytest

from vmb_engine.codegen import generate_code
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def registry():
    reg = NodeRegistry()
    reg.scan([NODES_DIR])
    return reg


def _pipeline() -> PipelineIR:
    return PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": "iris.csv"}},
                {
                    "id": "n2",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
                {
                    "id": "n3",
                    "type": "sklearn_models.random_forest",
                    "params": {"target_column": "label", "n_estimators": 10, "random_state": 42},
                },
                {
                    "id": "n4",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
                {"from": "n3.model", "to": "n4.model"},
                {"from": "n2.test", "to": "n4.test_table"},
            ],
        }
    )


def test_generate_code_includes_deduped_imports(registry):
    code = generate_code(_pipeline(), registry)

    assert code.count("import pandas as pd") == 1
    assert "from sklearn.model_selection import train_test_split" in code
    assert "from sklearn.ensemble import RandomForestClassifier" in code
    assert "from sklearn.metrics import accuracy_score" in code


def test_generate_code_orders_statements_by_dependency(registry):
    code = generate_code(_pipeline(), registry)

    load_line = code.index("pd.read_csv")
    split_line = code.index("train_test_split(")
    fit_line = code.index(".fit(")
    accuracy_line = code.index("accuracy_score(")

    assert load_line < split_line < fit_line < accuracy_line


def test_generated_code_is_syntactically_valid_python(registry):
    code = generate_code(_pipeline(), registry)
    compile(code, "<generated>", "exec")  # raises SyntaxError if invalid
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest engine/tests/test_codegen.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vmb_engine.codegen'`

- [ ] **Step 3: Implement codegen**

Create `engine/vmb_engine/codegen.py`:

```python
from collections import defaultdict

from vmb_engine.executor import split_ref, topological_sort
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry


def generate_code(ir: PipelineIR, registry: NodeRegistry) -> str:
    order = topological_sort(ir)
    nodes_by_id = {node.id: node for node in ir.nodes}

    incoming_edges: dict[str, list] = defaultdict(list)
    for edge in ir.edges:
        to_node, to_port = split_ref(edge.to)
        incoming_edges[to_node].append((to_port, edge.from_))

    all_imports: set[str] = set()
    body_lines: list[str] = []

    for node_id in order:
        node_spec = nodes_by_id[node_id]
        node_def = registry.get(node_spec.type)
        all_imports.update(node_def.imports)

        input_vars = {}
        for port_name, from_ref in incoming_edges[node_id]:
            from_node, from_port = split_ref(from_ref)
            input_vars[port_name] = f"{from_node}_{from_port}"

        var_names = {port.name: f"{node_id}_{port.name}" for port in node_def.manifest.outputs}

        lines = node_def.codegen(input_vars, node_spec.params, var_names)
        body_lines.extend(lines)

    import_lines = sorted(all_imports)
    return "\n".join(import_lines) + "\n\n" + "\n".join(body_lines) + "\n"
```

Note: this makes `split_ref` a shared helper reused from `executor.py`
(Task 6) rather than duplicated — codegen and the executor must walk the
same DAG the same way, which is the whole point of the equivalence
guarantee this project depends on.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_codegen.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/vmb_engine/codegen.py engine/tests/test_codegen.py
git commit -m "Add code generation from pipeline IR"
```

---

### Task 8: Executor/codegen equivalence test

**Files:**
- Test: `engine/tests/test_equivalence.py`

**Interfaces:**
- Consumes: `execute_pipeline` (Task 6), `generate_code` (Task 7),
  `NodeRegistry` (Task 3), `PipelineIR` (Task 1).
- Produces: nothing new — this is a pure integration test asserting the two
  execution paths agree, which is the spec's highest-value test.

- [ ] **Step 1: Write the equivalence test**

Create `engine/tests/test_equivalence.py`:

```python
import re
import subprocess
import sys
from pathlib import Path

import pytest

from vmb_engine.codegen import generate_code
from vmb_engine.executor import execute_pipeline
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def registry():
    reg = NodeRegistry()
    reg.scan([NODES_DIR])
    return reg


def test_executor_and_exported_script_produce_same_accuracy(tmp_path, registry):
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
                    "type": "sklearn_models.random_forest",
                    "params": {"target_column": "label", "n_estimators": 15, "random_state": 42},
                },
                {
                    "id": "n4",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
                {"from": "n3.model", "to": "n4.model"},
                {"from": "n2.test", "to": "n4.test_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_accuracy = context["n4.metrics"]["accuracy"]

    code = generate_code(ir, registry)
    script_path = tmp_path / "exported.py"
    script_path.write_text(code)

    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        check=True,
    )

    match = re.search(r"'accuracy':\s*([0-9.]+)", result.stdout)
    assert match is not None, f"no accuracy found in script output:\n{result.stdout}"
    script_accuracy = float(match.group(1))

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-9)
```

- [ ] **Step 2: Run test to verify it passes**

Run: `.venv/bin/pytest engine/tests/test_equivalence.py -v`
Expected: PASS (1 passed). If it fails, the mismatch is between how
`execute_pipeline` and `generate_code` order operations or bind
`random_state` — re-check Tasks 4–7 for a discrepancy before changing this
test.

- [ ] **Step 3: Commit**

```bash
git add engine/tests/test_equivalence.py
git commit -m "Add executor/codegen equivalence test"
```

---

### Task 9: FastAPI HTTP API

**Files:**
- Create: `engine/vmb_engine/api.py`
- Test: `engine/tests/test_api.py`

**Interfaces:**
- Consumes: `NodeRegistry`, `execute_pipeline`, `generate_code`, `PipelineIR`.
- Produces: FastAPI app instance `app` in `vmb_engine.api` with:
  - `GET /nodes` → `200` JSON list of manifest dicts (`registry.all()`,
    each `.model_dump(mode="json")`).
  - `POST /pipeline/run` → body is a `PipelineIR` JSON document → `200`
    `{"metrics": {"<node_id>.<port>": <value>, ...}}` for every output port
    whose declared type is `"Metrics"`; `422` with `{"detail": ...}` on an
    `ExecutorError`/`RegistryError`.
  - `POST /pipeline/codegen` → body is a `PipelineIR` JSON document → `200`
    `{"code": "<script text>"}`; `422` on the same error types.

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/test_api.py`:

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vmb_engine.api import create_app

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


@pytest.fixture
def client():
    app = create_app(node_paths=[NODES_DIR])
    return TestClient(app)


def _pipeline(csv_path: str) -> dict:
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
                "type": "sklearn_models.random_forest",
                "params": {"target_column": "label", "n_estimators": 10, "random_state": 42},
            },
            {
                "id": "n4",
                "type": "evaluation.evaluate_classifier",
                "params": {"target_column": "label"},
            },
        ],
        "edges": [
            {"from": "n1.table", "to": "n2.table"},
            {"from": "n2.train", "to": "n3.train_table"},
            {"from": "n3.model", "to": "n4.model"},
            {"from": "n2.test", "to": "n4.test_table"},
        ],
    }


def test_get_nodes_lists_registered_manifests(client):
    response = client.get("/nodes")
    assert response.status_code == 200
    ids = {m["id"] for m in response.json()}
    assert "data.csv_loader" in ids
    assert "sklearn_models.random_forest" in ids


def test_run_pipeline_returns_metrics(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n" + "\n".join(f"{i},{i % 2}" for i in range(40)))

    response = client.post("/pipeline/run", json=_pipeline(str(csv_path)))

    assert response.status_code == 200
    body = response.json()
    assert "n4.metrics" in body["metrics"]
    assert 0.0 <= body["metrics"]["n4.metrics"]["accuracy"] <= 1.0


def test_run_pipeline_with_bad_edge_returns_422(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")
    pipeline = _pipeline(str(csv_path))
    pipeline["edges"][0]["to"] = "does_not_exist.table"

    response = client.post("/pipeline/run", json=pipeline)

    assert response.status_code == 422


def test_codegen_endpoint_returns_script(client, tmp_path):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,label\n1,0\n")

    response = client.post("/pipeline/codegen", json=_pipeline(str(csv_path)))

    assert response.status_code == 200
    code = response.json()["code"]
    assert "RandomForestClassifier" in code
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest engine/tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vmb_engine.api'`

- [ ] **Step 3: Implement the API**

Create `engine/vmb_engine/api.py`:

```python
from pathlib import Path

from fastapi import FastAPI, HTTPException

from vmb_engine.codegen import generate_code
from vmb_engine.executor import ExecutorError, execute_pipeline
from vmb_engine.ir import PipelineIR
from vmb_engine.registry import NodeRegistry, RegistryError

DEFAULT_NODES_DIR = Path(__file__).resolve().parent / "nodes"


def create_app(node_paths: list[Path] | None = None) -> FastAPI:
    registry = NodeRegistry()
    registry.scan(node_paths if node_paths is not None else [DEFAULT_NODES_DIR])

    app = FastAPI(title="Visual Model Builder Engine")

    @app.get("/nodes")
    def list_nodes():
        return [manifest.model_dump(mode="json") for manifest in registry.all()]

    @app.post("/pipeline/run")
    def run_pipeline(ir: PipelineIR):
        try:
            context = execute_pipeline(ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        nodes_by_id = {node.id: node for node in ir.nodes}
        metrics = {}
        for ref, value in context.items():
            node_id, port_name = ref.split(".", 1)
            node_def = registry.get(nodes_by_id[node_id].type)
            port = next((p for p in node_def.manifest.outputs if p.name == port_name), None)
            if port is not None and port.type == "Metrics":
                metrics[ref] = value

        return {"metrics": metrics}

    @app.post("/pipeline/codegen")
    def codegen_pipeline(ir: PipelineIR):
        try:
            code = generate_code(ir, registry)
        except (ExecutorError, RegistryError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"code": code}

    return app


app = create_app()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest engine/tests/test_api.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Run the full engine test suite**

Run: `.venv/bin/pytest engine/tests -v`
Expected: all tests across every task pass.

- [ ] **Step 6: Commit**

```bash
git add engine/vmb_engine/api.py engine/tests/test_api.py
git commit -m "Add FastAPI HTTP API for the engine"
```

---

## Out of scope for this plan (deferred to follow-up plans)

- Tauri shell + React frontend (separate plan; consumes this API).
- WebSocket progress streaming + background/async execution for long-running
  (PyTorch) training nodes.
- PyTorch/image node set (Conv2D, DataLoader, transfer-learning backbones).
- `~/.vmb/plugins` user plugin directory wiring into `create_app`'s
  `node_paths` (the registry already supports scanning multiple paths —
  this just needs the CLI entrypoint that launches `create_app` to pass it).
- PyInstaller packaging + GitHub Actions release CI.
