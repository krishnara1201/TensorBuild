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
        check=False,
    )
    assert result.returncode == 0, result.stderr

    match = re.search(r"'accuracy':\s*([0-9.]+)", result.stdout)
    assert match is not None, f"no accuracy found in script output:\n{result.stdout}"
    script_accuracy = float(match.group(1))

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-9)


def test_executor_and_exported_script_agree_with_standardize_node(tmp_path, registry):
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
                    "type": "preprocessing.standardize",
                    "params": {"target_column": "label"},
                },
                {
                    "id": "n4",
                    "type": "sklearn_models.logistic_regression",
                    "params": {"target_column": "label", "max_iter": 1000, "random_state": 42},
                },
                {
                    "id": "n5",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
                {"from": "n2.test", "to": "n3.test_table"},
                {"from": "n3.train", "to": "n4.train_table"},
                {"from": "n4.model", "to": "n5.model"},
                {"from": "n3.test", "to": "n5.test_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_accuracy = context["n5.metrics"]["accuracy"]

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

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-9)


def test_executor_and_exported_script_agree_with_regression_pipeline(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i * 3.1}" for i in range(60)))

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
                    "type": "sklearn_models.linear_regression",
                    "params": {"target_column": "label"},
                },
                {
                    "id": "n4",
                    "type": "evaluation.evaluate_regressor",
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
    executor_r2 = context["n4.metrics"]["r2"]

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

    match = re.search(r"'r2':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no r2 found in script output:\n{result.stdout}"
    script_r2 = float(match.group(1))

    assert executor_r2 == pytest.approx(script_r2, abs=1e-9)


def test_executor_and_exported_script_agree_with_clean_data_node(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    rows = ["a,b,label"]
    for i in range(60):
        a = "" if i % 10 == 0 else str(float(i))
        b = f" {i * 2} "
        rows.append(f"{a},{b},{i % 2}")
    rows.append(rows[-1])  # duplicate row for drop_duplicates to remove
    csv_path.write_text("\n".join(rows))

    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": str(csv_path)}},
                {
                    "id": "n2",
                    "type": "preprocessing.clean_data",
                    "params": {
                        "strip_whitespace": True,
                        "fix_dtypes": True,
                        "missing_value_strategy": "fill_mean",
                        "missing_value_columns": "a",
                        "drop_duplicates": True,
                    },
                },
                {
                    "id": "n3",
                    "type": "data.train_test_split",
                    "params": {"test_size": 0.25, "random_state": 42},
                },
                {
                    "id": "n4",
                    "type": "sklearn_models.random_forest",
                    "params": {"target_column": "label", "n_estimators": 15, "random_state": 42},
                },
                {
                    "id": "n5",
                    "type": "evaluation.evaluate_classifier",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.table", "to": "n3.table"},
                {"from": "n3.train", "to": "n4.train_table"},
                {"from": "n4.model", "to": "n5.model"},
                {"from": "n3.test", "to": "n5.test_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_accuracy = context["n5.metrics"]["accuracy"]

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

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-9)


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


def test_executor_and_exported_script_agree_with_mlp_regression_pipeline(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i * 3.1}" for i in range(60)))

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
                {"id": "n6", "type": "pytorch_models.linear", "params": {"out_features": 1}},
                {
                    "id": "n7",
                    "type": "pytorch_models.train",
                    "params": {
                        "target_column": "label",
                        "task_type": "regression",
                        "loss_fn": "MSELoss",
                        "optimizer": "Adam",
                        "learning_rate": 0.01,
                        "epochs": 3,
                        "batch_size": 16,
                    },
                },
                {
                    "id": "n8",
                    "type": "evaluation.evaluate_regressor",
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
    executor_r2 = context["n8.metrics"]["r2"]

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

    match = re.search(r"'r2':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no r2 found in script output:\n{result.stdout}"
    script_r2 = float(match.group(1))

    assert executor_r2 == pytest.approx(script_r2, abs=1e-6)


def test_executor_and_exported_script_agree_with_cnn_pipeline(tmp_path, registry):
    from PIL import Image

    data_dir = tmp_path / "images"
    for class_name, shade in (("cat", 50), ("dog", 200)):
        class_dir = data_dir / class_name
        class_dir.mkdir(parents=True)
        for i in range(10):
            Image.new("RGB", (16, 16), color=(shade, shade, shade)).save(class_dir / f"{i}.png")

    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {
                    "id": "n1",
                    "type": "data.image_folder_loader",
                    "params": {
                        "directory": str(data_dir),
                        "image_size": 16,
                        "test_size": 0.3,
                        "random_state": 42,
                    },
                },
                {"id": "n2", "type": "preprocessing.normalize_images", "params": {}},
                {"id": "n3", "type": "pytorch_models.image_input", "params": {"random_state": 42}},
                {
                    "id": "n4",
                    "type": "pytorch_models.conv2d",
                    "params": {"out_channels": 4, "kernel_size": 3},
                },
                {"id": "n5", "type": "pytorch_models.batchnorm2d", "params": {}},
                {"id": "n6", "type": "pytorch_models.relu", "params": {}},
                {"id": "n7", "type": "pytorch_models.maxpool2d", "params": {"pool_size": 2}},
                {"id": "n8", "type": "pytorch_models.flatten", "params": {}},
                {"id": "n9", "type": "pytorch_models.dropout", "params": {"p": 0.5}},
                {"id": "n10", "type": "pytorch_models.linear", "params": {"out_features": 2}},
                {
                    "id": "n11",
                    "type": "pytorch_models.train_image_classifier",
                    "params": {
                        "loss_fn": "CrossEntropyLoss",
                        "optimizer": "Adam",
                        "learning_rate": 0.01,
                        "epochs": 2,
                        "batch_size": 4,
                    },
                },
            ],
            "edges": [
                {"from": "n1.train", "to": "n2.train_images"},
                {"from": "n1.test", "to": "n2.test_images"},
                {"from": "n2.train", "to": "n3.train_images"},
                {"from": "n3.architecture", "to": "n4.architecture"},
                {"from": "n4.architecture", "to": "n5.architecture"},
                {"from": "n5.architecture", "to": "n6.architecture"},
                {"from": "n6.architecture", "to": "n7.architecture"},
                {"from": "n7.architecture", "to": "n8.architecture"},
                {"from": "n8.architecture", "to": "n9.architecture"},
                {"from": "n9.architecture", "to": "n10.architecture"},
                {"from": "n2.train", "to": "n11.train_images"},
                {"from": "n2.test", "to": "n11.test_images"},
                {"from": "n10.architecture", "to": "n11.architecture"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_metrics = context["n11.metrics"]
    executor_accuracy = executor_metrics["final_val_accuracy"]
    executor_train_loss = executor_metrics["final_train_loss"]
    executor_val_loss = executor_metrics["final_val_loss"]

    code = generate_code(ir, registry)
    script_path = tmp_path / "exported_cnn.py"
    script_path.write_text(code)

    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    match = re.search(r"'final_val_accuracy':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no final_val_accuracy found in script output:\n{result.stdout}"
    script_accuracy = float(match.group(1))

    train_loss_match = re.search(r"'final_train_loss':\s*([0-9.eE+-]+)", result.stdout)
    assert train_loss_match is not None, f"no final_train_loss found in script output:\n{result.stdout}"
    script_train_loss = float(train_loss_match.group(1))

    val_loss_match = re.search(r"'final_val_loss':\s*([0-9.eE+-]+)", result.stdout)
    assert val_loss_match is not None, f"no final_val_loss found in script output:\n{result.stdout}"
    script_val_loss = float(val_loss_match.group(1))

    assert executor_accuracy == pytest.approx(script_accuracy, abs=1e-6)
    assert executor_train_loss == pytest.approx(script_train_loss, abs=1e-6)
    assert executor_val_loss == pytest.approx(script_val_loss, abs=1e-6)


def test_executor_and_exported_script_agree_with_roc_auc_node(tmp_path, registry):
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
                    "type": "sklearn_models.logistic_regression",
                    "params": {"target_column": "label", "max_iter": 1000, "random_state": 42},
                },
                {
                    "id": "n4",
                    "type": "evaluation.roc_auc",
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
    executor_auc = context["n4.metrics"]["roc_auc"]

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

    match = re.search(r"'roc_auc':\s*([0-9.]+)", result.stdout)
    assert match is not None, f"no roc_auc found in script output:\n{result.stdout}"
    script_auc = float(match.group(1))

    assert executor_auc == pytest.approx(script_auc, abs=1e-9)


def test_executor_and_exported_script_agree_on_model_summary_intercept(tmp_path, registry):
    csv_path = tmp_path / "d.csv"
    csv_path.write_text("a,b,label\n" + "\n".join(f"{i},{i * 2},{i * 3.1}" for i in range(60)))

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
                    "type": "sklearn_models.linear_regression",
                    "params": {"target_column": "label"},
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_intercept = context["n3.model_summary"]["intercept"]

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

    match = re.search(r"'intercept':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no intercept found in script output:\n{result.stdout}"
    script_intercept = float(match.group(1))

    assert executor_intercept == pytest.approx(script_intercept, abs=1e-9)


def test_executor_and_exported_script_agree_with_random_forest_tuning(tmp_path, registry):
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
                    "type": "sklearn_models.random_forest_tuning",
                    "params": {
                        "target_column": "label",
                        "n_estimators_options": "10,20",
                        "max_depth_options": "3,None",
                        "cv": 3,
                        "scoring": "accuracy",
                        "random_state": 42,
                    },
                },
            ],
            "edges": [
                {"from": "n1.table", "to": "n2.table"},
                {"from": "n2.train", "to": "n3.train_table"},
            ],
        }
    )

    context = execute_pipeline(ir, registry)
    executor_best_score = context["n3.metrics"]["best_score"]

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

    match = re.search(r"'best_score':\s*([0-9.eE+-]+)", result.stdout)
    assert match is not None, f"no best_score found in script output:\n{result.stdout}"
    script_best_score = float(match.group(1))

    assert executor_best_score == pytest.approx(script_best_score, abs=1e-9)
