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
    assert architecture["shape"] is None


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
        "n2_architecture_shape = None",
        "n2_architecture = []",
    ]


def test_linear_execute_appends_layer_and_updates_in_features():
    linear = _load_node_module("pytorch_models/linear")

    outputs = linear.execute(
        {"architecture": {"modules": [], "in_features": 2, "shape": None}}, {"out_features": 8}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].in_features == 2
    assert architecture["modules"][0].out_features == 8
    assert architecture["in_features"] == 8
    assert architecture["shape"] is None


def test_linear_execute_raises_when_shape_is_still_spatial():
    linear = _load_node_module("pytorch_models/linear")

    try:
        linear.execute(
            {"architecture": {"modules": [], "in_features": None, "shape": (4, 8, 8)}},
            {"out_features": 8},
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "Flatten" in str(exc)


def test_linear_codegen_emits_layer_append():
    linear = _load_node_module("pytorch_models/linear")
    lines = linear.codegen(
        {"architecture": "n1_architecture"},
        {"out_features": 8},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "assert n1_architecture_in_features is not None, "
        "'Linear requires a flat shape; insert a Flatten node first'",
        "n2_architecture = n1_architecture + [nn.Linear(n1_architecture_in_features, 8)]",
        "n2_architecture_in_features = 8",
        "n2_architecture_shape = None",
    ]


def test_relu_execute_appends_activation_and_preserves_in_features():
    relu = _load_node_module("pytorch_models/relu")

    outputs = relu.execute(
        {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["in_features"] == 8
    assert architecture["shape"] is None


def test_relu_execute_preserves_spatial_shape():
    relu = _load_node_module("pytorch_models/relu")

    outputs = relu.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (4, 8, 8)}}, {}
    )

    assert outputs["architecture"]["shape"] == (4, 8, 8)
    assert outputs["architecture"]["in_features"] is None


def test_relu_codegen_emits_activation_append():
    relu = _load_node_module("pytorch_models/relu")
    lines = relu.codegen(
        {"architecture": "n2_architecture"}, {}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.ReLU()]",
        "n3_architecture_in_features = n2_architecture_in_features",
        "n3_architecture_shape = n2_architecture_shape",
    ]


def test_dropout_execute_appends_dropout_and_preserves_in_features():
    dropout = _load_node_module("pytorch_models/dropout")

    outputs = dropout.execute(
        {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {"p": 0.3}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].p == 0.3
    assert architecture["in_features"] == 8
    assert architecture["shape"] is None


def test_dropout_codegen_emits_dropout_append():
    dropout = _load_node_module("pytorch_models/dropout")
    lines = dropout.codegen(
        {"architecture": "n2_architecture"}, {"p": 0.3}, {"architecture": "n3_architecture"}
    )
    assert lines == [
        "n3_architecture = n2_architecture + [nn.Dropout(p=0.3)]",
        "n3_architecture_in_features = n2_architecture_in_features",
        "n3_architecture_shape = n2_architecture_shape",
    ]


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


def test_train_execute_regression_trains_and_returns_predictable_model():
    train_node = _load_node_module("pytorch_models/train")
    architecture, train_df = _toy_architecture(out_features=1)

    outputs = train_node.execute(
        {"train_table": train_df, "test_table": train_df, "architecture": architecture},
        {
            "target_column": "label",
            "task_type": "regression",
            "loss_fn": "MSELoss",
            "optimizer": "Adam",
            "learning_rate": 0.01,
            "epochs": 3,
            "batch_size": 8,
        },
    )

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2"]
    preds = model["estimator"].predict(train_df[model["feature_columns"]])
    assert preds.shape == (len(train_df),)

    metrics = outputs["metrics"]
    assert isinstance(metrics["final_train_loss"], float)
    assert isinstance(metrics["final_val_loss"], float)


def test_train_codegen_emits_training_loop_for_regression():
    train_node = _load_node_module("pytorch_models/train")
    lines = train_node.codegen(
        {"train_table": "n2_train", "test_table": "n2_test", "architecture": "n5_architecture"},
        {
            "target_column": "label",
            "task_type": "regression",
            "loss_fn": "MSELoss",
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
        "n6_model_y_train = torch.tensor(n2_train[n6_model_target].values, dtype=torch.float32).unsqueeze(-1)",
        "n6_model_y_test = torch.tensor(n2_test[n6_model_target].values, dtype=torch.float32).unsqueeze(-1)",
        "n6_model_loss_fn = nn.MSELoss()",
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
        "n6_model = _TorchPredictAdapter(n6_model_module, 'regression')",
        "n6_metrics = {'final_train_loss': float(n6_model_train_loss), 'final_val_loss': float(n6_model_val_loss)}",
    ]


def _image_batch(n=4, channels=3, height=8, width=8):
    import torch

    images = torch.zeros(n, channels, height, width)
    labels = torch.zeros(n, dtype=torch.long)
    return {"images": images, "labels": labels}


def test_image_input_execute_infers_spatial_shape():
    image_input = _load_node_module("pytorch_models/image_input")

    outputs = image_input.execute(
        {"train_images": _image_batch(channels=3, height=8, width=8)}, {"random_state": 42}
    )

    architecture = outputs["architecture"]
    assert architecture["modules"] == []
    assert architecture["in_features"] is None
    assert architecture["shape"] == (3, 8, 8)


def test_image_input_codegen_emits_seed_and_shape():
    image_input = _load_node_module("pytorch_models/image_input")
    lines = image_input.codegen(
        {"train_images": "n1_train"},
        {"random_state": 42},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "torch.manual_seed(42)",
        "n2_architecture_shape = tuple(n1_train_images.shape[1:])",
        "n2_architecture_in_features = None",
        "n2_architecture = []",
    ]


def test_conv2d_execute_updates_channel_count_and_preserves_hw():
    conv2d = _load_node_module("pytorch_models/conv2d")

    outputs = conv2d.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (3, 8, 8)}},
        {"out_channels": 6, "kernel_size": 3},
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].out_channels == 6
    assert architecture["shape"] == (6, 8, 8)
    assert architecture["in_features"] is None


def test_conv2d_execute_raises_without_spatial_shape():
    conv2d = _load_node_module("pytorch_models/conv2d")

    try:
        conv2d.execute(
            {"architecture": {"modules": [], "in_features": 8, "shape": None}},
            {"out_channels": 6, "kernel_size": 3},
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_conv2d_codegen_emits_conv_append():
    conv2d = _load_node_module("pytorch_models/conv2d")
    lines = conv2d.codegen(
        {"architecture": "n1_architecture"},
        {"out_channels": 6, "kernel_size": 3},
        {"architecture": "n2_architecture"},
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'Conv2D requires a spatial shape; insert after Image Input, another "
        "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear'",
        "n2_architecture = n1_architecture + "
        "[nn.Conv2d(n1_architecture_shape[0], 6, 3, padding='same')]",
        "n2_architecture_shape = (6, n1_architecture_shape[1], n1_architecture_shape[2])",
        "n2_architecture_in_features = None",
    ]


def test_batchnorm2d_execute_preserves_shape():
    batchnorm2d = _load_node_module("pytorch_models/batchnorm2d")

    outputs = batchnorm2d.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (6, 8, 8)}}, {}
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["modules"][0].num_features == 6
    assert architecture["shape"] == (6, 8, 8)


def test_batchnorm2d_execute_raises_without_spatial_shape():
    batchnorm2d = _load_node_module("pytorch_models/batchnorm2d")

    try:
        batchnorm2d.execute(
            {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {}
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_batchnorm2d_codegen_emits_batchnorm_append():
    batchnorm2d = _load_node_module("pytorch_models/batchnorm2d")
    lines = batchnorm2d.codegen(
        {"architecture": "n1_architecture"}, {}, {"architecture": "n2_architecture"}
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'BatchNorm2D requires a spatial shape; insert after Image Input, another "
        "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear'",
        "n2_architecture = n1_architecture + [nn.BatchNorm2d(n1_architecture_shape[0])]",
        "n2_architecture_shape = n1_architecture_shape",
        "n2_architecture_in_features = None",
    ]


def test_maxpool2d_execute_halves_spatial_dims():
    maxpool2d = _load_node_module("pytorch_models/maxpool2d")

    outputs = maxpool2d.execute(
        {"architecture": {"modules": [], "in_features": None, "shape": (6, 8, 8)}},
        {"pool_size": 2},
    )

    architecture = outputs["architecture"]
    assert len(architecture["modules"]) == 1
    assert architecture["shape"] == (6, 4, 4)


def test_maxpool2d_execute_raises_without_spatial_shape():
    maxpool2d = _load_node_module("pytorch_models/maxpool2d")

    try:
        maxpool2d.execute(
            {"architecture": {"modules": [], "in_features": 8, "shape": None}}, {"pool_size": 2}
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "spatial shape" in str(exc)


def test_maxpool2d_codegen_emits_pool_append():
    maxpool2d = _load_node_module("pytorch_models/maxpool2d")
    lines = maxpool2d.codegen(
        {"architecture": "n1_architecture"}, {"pool_size": 2}, {"architecture": "n2_architecture"}
    )
    assert lines == [
        "assert n1_architecture_shape is not None, "
        "'MaxPool2D requires a spatial shape; insert after Image Input, another "
        "Conv2D/BatchNorm2D/MaxPool2D — not after Flatten/Linear'",
        "n2_architecture = n1_architecture + [nn.MaxPool2d(2)]",
        "n2_architecture_shape = (n1_architecture_shape[0], "
        "n1_architecture_shape[1] // 2, n1_architecture_shape[2] // 2)",
        "n2_architecture_in_features = None",
    ]
