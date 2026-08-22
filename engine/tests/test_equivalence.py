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
