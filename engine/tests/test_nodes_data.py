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
