import importlib.util
from pathlib import Path

import torch

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def _load_node_module(rel_path: str):
    node_path = NODES_DIR / rel_path / "node.py"
    spec = importlib.util.spec_from_file_location(rel_path.replace("/", "_"), node_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _batch(values: list[float]) -> dict:
    images = torch.tensor(values, dtype=torch.float32).reshape(len(values), 1, 1, 1)
    labels = torch.arange(len(values), dtype=torch.long)
    return {"images": images, "labels": labels}


def test_normalize_images_execute_uses_train_stats_on_both_splits():
    node = _load_node_module("preprocessing/normalize_images")
    train = _batch([0.0, 10.0])
    test = _batch([5.0])

    outputs = node.execute({"train_images": train, "test_images": test}, {})

    mean, std = 5.0, 5.0
    assert outputs["train"]["images"].flatten().tolist() == [
        (0.0 - mean) / std,
        (10.0 - mean) / std,
    ]
    assert outputs["test"]["images"].flatten().tolist() == [(5.0 - mean) / std]
    assert outputs["train"]["labels"].tolist() == [0, 1]
    assert outputs["test"]["labels"].tolist() == [0]


def test_normalize_images_codegen_emits_train_stat_normalize():
    node = _load_node_module("preprocessing/normalize_images")
    lines = node.codegen(
        {"train_images": "n1_train", "test_images": "n1_test"},
        {},
        {"train": "n2_train", "test": "n2_test"},
    )
    assert lines == [
        "n2_train_mean = n1_train_images.mean(dim=(0, 2, 3), keepdim=True)",
        "n2_train_std = n1_train_images.std(dim=(0, 2, 3), keepdim=True)",
        "n2_train_images = (n1_train_images - n2_train_mean) / n2_train_std",
        "n2_train_labels = n1_train_labels",
        "n2_test_images = (n1_test_images - n2_train_mean) / n2_train_std",
        "n2_test_labels = n1_test_labels",
    ]
