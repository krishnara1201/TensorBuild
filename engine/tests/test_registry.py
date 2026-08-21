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
