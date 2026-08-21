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
        "n4_metrics_X = n2_test[n3_model_X.columns]",
        "n4_metrics_y = n2_test['label']",
        "n4_metrics_preds = n3_model.predict(n4_metrics_X)",
        "n4_metrics = {'accuracy': float(accuracy_score(n4_metrics_y, n4_metrics_preds))}",
        "print(n4_metrics)",
    ]


def test_logistic_regression_execute_fits_model():
    lr = _load_node_module("sklearn_models/logistic_regression")
    train_df = _toy_frame()

    outputs = lr.execute(
        {"train_table": train_df},
        {"target_column": "label", "max_iter": 1000, "random_state": 42},
    )

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")


def test_logistic_regression_codegen_emits_fit_call():
    lr = _load_node_module("sklearn_models/logistic_regression")
    lines = lr.codegen(
        {"train_table": "n2_train"},
        {"target_column": "label", "max_iter": 1000, "random_state": 42},
        {"model": "n3_model"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model = LogisticRegression(max_iter=1000, random_state=42)",
        "n3_model.fit(n3_model_X, n3_model_y)",
    ]


def test_linear_regression_execute_fits_model():
    lr = _load_node_module("sklearn_models/linear_regression")
    train_df = _toy_frame()

    outputs = lr.execute({"train_table": train_df}, {"target_column": "label"})

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")


def test_linear_regression_codegen_emits_fit_call():
    lr = _load_node_module("sklearn_models/linear_regression")
    lines = lr.codegen(
        {"train_table": "n2_train"},
        {"target_column": "label"},
        {"model": "n3_model"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model = LinearRegression()",
        "n3_model.fit(n3_model_X, n3_model_y)",
    ]


def test_svm_execute_fits_model():
    svm = _load_node_module("sklearn_models/svm")
    train_df = _toy_frame()

    outputs = svm.execute(
        {"train_table": train_df},
        {"target_column": "label", "C": 1.0, "random_state": 42},
    )

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")


def test_svm_codegen_emits_fit_call():
    svm = _load_node_module("sklearn_models/svm")
    lines = svm.codegen(
        {"train_table": "n2_train"},
        {"target_column": "label", "C": 1.0, "random_state": 42},
        {"model": "n3_model"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model = SVC(C=1.0, random_state=42)",
        "n3_model.fit(n3_model_X, n3_model_y)",
    ]


def test_kmeans_execute_fits_model():
    km = _load_node_module("sklearn_models/kmeans")
    train_df = _toy_frame()

    outputs = km.execute(
        {"train_table": train_df}, {"n_clusters": 2, "random_state": 42}
    )

    model = outputs["model"]
    assert model["feature_columns"] == ["x1", "x2", "label"]
    assert hasattr(model["estimator"], "predict")


def test_kmeans_codegen_emits_fit_call():
    km = _load_node_module("sklearn_models/kmeans")
    lines = km.codegen(
        {"train_table": "n2_train"},
        {"n_clusters": 2, "random_state": 42},
        {"model": "n3_model"},
    )
    assert lines == [
        "n3_model = KMeans(n_clusters=2, random_state=42)",
        "n3_model.fit(n2_train)",
    ]


def test_evaluate_regressor_execute_returns_regression_metrics():
    lr = _load_node_module("sklearn_models/linear_regression")
    evaluator = _load_node_module("evaluation/evaluate_regressor")

    train_df = _toy_frame()
    model_outputs = lr.execute({"train_table": train_df}, {"target_column": "label"})

    metrics_outputs = evaluator.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label"},
    )

    metrics = metrics_outputs["metrics"]
    assert metrics["mse"] >= 0.0
    assert metrics["rmse"] == pytest.approx(metrics["mse"] ** 0.5)
    assert metrics["mae"] >= 0.0
    assert metrics["r2"] <= 1.0


def test_evaluate_regressor_codegen_emits_regression_metrics():
    evaluator = _load_node_module("evaluation/evaluate_regressor")
    lines = evaluator.codegen(
        {"model": "n3_model", "test_table": "n2_test"},
        {"target_column": "label"},
        {"metrics": "n4_metrics"},
    )
    assert lines == [
        "n4_metrics_X = n2_test[n3_model_X.columns]",
        "n4_metrics_y = n2_test['label']",
        "n4_metrics_preds = n3_model.predict(n4_metrics_X)",
        "n4_metrics_mse = float(mean_squared_error(n4_metrics_y, n4_metrics_preds))",
        "n4_metrics = {"
        "'mse': n4_metrics_mse, "
        "'rmse': n4_metrics_mse ** 0.5, "
        "'mae': float(mean_absolute_error(n4_metrics_y, n4_metrics_preds)), "
        "'r2': float(r2_score(n4_metrics_y, n4_metrics_preds))}",
        "print(n4_metrics)",
    ]
