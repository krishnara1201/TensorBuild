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
