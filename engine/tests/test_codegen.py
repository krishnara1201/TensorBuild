from pathlib import Path

import pytest

from vmb_engine.codegen import generate_code
from vmb_engine.executor import ExecutorError
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


def test_generate_code_uses_readable_variable_names(registry):
    code = generate_code(_pipeline(), registry)

    assert "n1_table" not in code
    assert "n2_train" not in code
    assert "n3_model" not in code
    assert "csv_loader_table = pd.read_csv" in code
    assert "random_forest_model = RandomForestClassifier" in code


def test_generate_code_adds_node_header_comments(registry):
    code = generate_code(_pipeline(), registry)

    assert "# --- CSV Loader (n1) ---" in code
    assert "# --- Train/Test Split (n2) ---" in code
    assert "# --- Random Forest (n3) ---" in code
    assert "# --- Evaluate Classifier (n4) ---" in code
    # Headers precede their node's code
    assert code.index("# --- CSV Loader (n1) ---") < code.index("pd.read_csv")
    assert code.index("# --- Random Forest (n3) ---") < code.index("RandomForestClassifier(")


def test_generate_code_disambiguates_colliding_slugs_with_node_id(registry):
    ir = PipelineIR.model_validate(
        {
            "nodes": [
                {"id": "n1", "type": "data.csv_loader", "params": {"path": "a.csv"}},
                {"id": "n5", "type": "data.csv_loader", "params": {"path": "b.csv"}},
            ],
            "edges": [],
        }
    )
    code = generate_code(ir, registry)

    assert "csv_loader_n1_table = pd.read_csv" in code
    assert "csv_loader_n5_table = pd.read_csv" in code


def _pipeline_with_malformed_tuning_grid() -> PipelineIR:
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
                    "type": "sklearn_models.random_forest_tuning",
                    "params": {
                        "target_column": "label",
                        # Trailing comma yields an empty piece, which
                        # int("") raises ValueError on inside _parse_grid.
                        "n_estimators_options": "10,",
                        "max_depth_options": "5,10,None",
                        "cv": 5,
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


def test_generate_code_wraps_codegen_failure_as_executor_error(registry):
    with pytest.raises(ExecutorError, match="n3"):
        generate_code(_pipeline_with_malformed_tuning_grid(), registry)
