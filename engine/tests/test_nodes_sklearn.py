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


def _toy_frame_multiclass(n: int = 60) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "x1": [i % 5 for i in range(n)],
            "x2": [(i * 3) % 7 for i in range(n)],
            "label": [i % 3 for i in range(n)],
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


def test_evaluate_classifier_execute_returns_accuracy_precision_recall_f1():
    rf = _load_node_module("sklearn_models/random_forest")
    evaluator = _load_node_module("evaluation/evaluate_classifier")

    train_df = _toy_frame()
    model_outputs = rf.execute(
        {"train_table": train_df},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
    )

    metrics_outputs = evaluator.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label", "average": "weighted"},
    )

    metrics = metrics_outputs["metrics"]
    for key in ("accuracy", "precision", "recall", "f1"):
        assert 0.0 <= metrics[key] <= 1.0


def test_evaluate_classifier_codegen_emits_all_classifier_metrics():
    evaluator = _load_node_module("evaluation/evaluate_classifier")
    lines = evaluator.codegen(
        {"model": "n3_model", "test_table": "n2_test"},
        {"target_column": "label", "average": "weighted"},
        {"metrics": "n4_metrics"},
    )
    assert lines == [
        "n4_metrics_X = n2_test[n3_model_X.columns]",
        "n4_metrics_y = n2_test['label']",
        "n4_metrics_preds = n3_model.predict(n4_metrics_X)",
        "n4_metrics = {"
        "'accuracy': float(accuracy_score(n4_metrics_y, n4_metrics_preds)), "
        "'precision': float(precision_score(n4_metrics_y, n4_metrics_preds, average='weighted')), "
        "'recall': float(recall_score(n4_metrics_y, n4_metrics_preds, average='weighted')), "
        "'f1': float(f1_score(n4_metrics_y, n4_metrics_preds, average='weighted'))}",
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


def test_confusion_matrix_execute_returns_matrix_and_labels():
    rf = _load_node_module("sklearn_models/random_forest")
    cm_node = _load_node_module("evaluation/confusion_matrix")

    train_df = _toy_frame()
    model_outputs = rf.execute(
        {"train_table": train_df},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
    )

    outputs = cm_node.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label"},
    )

    metrics = outputs["metrics"]
    matrix = metrics["confusion_matrix"]
    labels = metrics["labels"]
    assert labels == [0, 1]
    assert len(matrix) == len(labels)
    assert all(len(row) == len(labels) for row in matrix)
    assert sum(sum(row) for row in matrix) == len(train_df)


def test_confusion_matrix_codegen_emits_confusion_matrix_call():
    cm_node = _load_node_module("evaluation/confusion_matrix")
    lines = cm_node.codegen(
        {"model": "n3_model", "test_table": "n2_test"},
        {"target_column": "label"},
        {"metrics": "n4_metrics"},
    )
    assert lines == [
        "n4_metrics_X = n2_test[n3_model_X.columns]",
        "n4_metrics_y = n2_test['label']",
        "n4_metrics_preds = n3_model.predict(n4_metrics_X)",
        "n4_metrics_labels = sorted(set(n4_metrics_y.tolist()) | set(n4_metrics_preds.tolist()))",
        "n4_metrics = {'confusion_matrix': confusion_matrix(n4_metrics_y, n4_metrics_preds, "
        "labels=n4_metrics_labels).tolist(), 'labels': n4_metrics_labels}",
        "print(n4_metrics)",
    ]


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


def test_roc_auc_execute_binary_uses_predict_proba():
    rf = _load_node_module("sklearn_models/random_forest")
    roc_node = _load_node_module("evaluation/roc_auc")

    train_df = _toy_frame()
    model_outputs = rf.execute(
        {"train_table": train_df},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
    )

    outputs = roc_node.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label"},
    )

    metrics = outputs["metrics"]
    assert 0.0 <= metrics["roc_auc"] <= 1.0
    assert len(metrics["fpr"]) == len(metrics["tpr"])
    assert len(metrics["fpr"]) >= 2


def test_roc_auc_execute_binary_falls_back_to_decision_function():
    svm = _load_node_module("sklearn_models/svm")
    roc_node = _load_node_module("evaluation/roc_auc")

    train_df = _toy_frame()
    model_outputs = svm.execute(
        {"train_table": train_df},
        {"target_column": "label", "C": 1.0, "random_state": 42},
    )

    assert not hasattr(model_outputs["model"]["estimator"], "predict_proba") or not (
        model_outputs["model"]["estimator"].__dict__.get("probability", False)
    )

    outputs = roc_node.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label"},
    )

    metrics = outputs["metrics"]
    assert 0.0 <= metrics["roc_auc"] <= 1.0
    assert len(metrics["fpr"]) == len(metrics["tpr"])


def test_roc_auc_execute_multiclass_returns_macro_average():
    rf = _load_node_module("sklearn_models/random_forest")
    roc_node = _load_node_module("evaluation/roc_auc")

    train_df = _toy_frame_multiclass()
    model_outputs = rf.execute(
        {"train_table": train_df},
        {"target_column": "label", "n_estimators": 10, "random_state": 42},
    )

    outputs = roc_node.execute(
        {"model": model_outputs["model"], "test_table": train_df},
        {"target_column": "label"},
    )

    metrics = outputs["metrics"]
    assert 0.0 <= metrics["macro_roc_auc"] <= 1.0
    assert "fpr" not in metrics
    assert "tpr" not in metrics


def test_roc_auc_execute_raises_when_model_has_no_score_method():
    roc_node = _load_node_module("evaluation/roc_auc")

    class _NoScoreEstimator:
        classes_ = [0, 1]

        def predict(self, X):
            return [0] * len(X)

    train_df = _toy_frame()
    model = {"estimator": _NoScoreEstimator(), "feature_columns": ["x1", "x2"]}

    with pytest.raises(ValueError, match="predict_proba or decision_function"):
        roc_node.execute({"model": model, "test_table": train_df}, {"target_column": "label"})


def test_roc_auc_codegen_emits_expected_lines():
    roc_node = _load_node_module("evaluation/roc_auc")
    lines = roc_node.codegen(
        {"model": "n3_model", "test_table": "n2_test"},
        {"target_column": "label"},
        {"metrics": "n4_metrics"},
    )
    assert lines == [
        "n4_metrics_X = n2_test[n3_model_X.columns]",
        "n4_metrics_y = n2_test['label']",
        "n4_metrics_classes = list(n3_model.classes_)",
        "if len(n4_metrics_classes) == 2:",
        "    if hasattr(n3_model, 'predict_proba'):",
        "        n4_metrics_score = n3_model.predict_proba(n4_metrics_X)[:, 1]",
        "    elif hasattr(n3_model, 'decision_function'):",
        "        n4_metrics_score = n3_model.decision_function(n4_metrics_X)",
        "    else:",
        "        raise ValueError("
        "'Model does not support predict_proba or decision_function, required for ROC AUC')",
        "    n4_metrics_fpr, n4_metrics_tpr, _ = roc_curve("
        "n4_metrics_y, n4_metrics_score, pos_label=n4_metrics_classes[1])",
        "    n4_metrics = {'roc_auc': float(roc_auc_score(n4_metrics_y, n4_metrics_score)), "
        "'fpr': n4_metrics_fpr.tolist(), 'tpr': n4_metrics_tpr.tolist()}",
        "else:",
        "    if not hasattr(n3_model, 'predict_proba'):",
        "        raise ValueError('Model must support predict_proba for multiclass ROC AUC')",
        "    n4_metrics_score = n3_model.predict_proba(n4_metrics_X)",
        "    n4_metrics = {'macro_roc_auc': float(roc_auc_score("
        "n4_metrics_y, n4_metrics_score, multi_class='ovr', average='macro'))}",
        "print(n4_metrics)",
    ]


def test_random_forest_tuning_execute_fits_best_model():
    node = _load_node_module("sklearn_models/random_forest_tuning")
    train_df = _toy_frame()

    outputs = node.execute(
        {"train_table": train_df},
        {
            "target_column": "label",
            "n_estimators_options": "10,20",
            "max_depth_options": "3,None",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
    )

    model = outputs["model"]
    metrics = outputs["metrics"]
    assert model["feature_columns"] == ["x1", "x2"]
    assert hasattr(model["estimator"], "predict")
    assert metrics["best_params"]["n_estimators"] in (10, 20)
    assert metrics["best_params"]["max_depth"] in (3, None)
    assert isinstance(metrics["best_score"], float)
    assert 0.0 <= metrics["best_score"] <= 1.0


def test_random_forest_tuning_execute_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/random_forest_tuning")
    train_df = _toy_frame()

    with pytest.raises(ValueError):
        node.execute(
            {"train_table": train_df},
            {
                "target_column": "label",
                "n_estimators_options": "abc,20",
                "max_depth_options": "3,None",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
        )


def test_random_forest_tuning_codegen_emits_grid_search_call():
    node = _load_node_module("sklearn_models/random_forest_tuning")
    lines = node.codegen(
        {"train_table": "n2_train"},
        {
            "target_column": "label",
            "n_estimators_options": "10,20",
            "max_depth_options": "3,None",
            "cv": 2,
            "scoring": "accuracy",
            "random_state": 42,
        },
        {"model": "n3_model", "metrics": "n3_metrics"},
    )
    assert lines == [
        "n3_model_X = n2_train.drop(columns=['label'])",
        "n3_model_y = n2_train['label']",
        "n3_model_param_grid = {'n_estimators': [10, 20], 'max_depth': [3, None]}",
        "n3_model_search = GridSearchCV(RandomForestClassifier(random_state=42), "
        "n3_model_param_grid, cv=2, scoring='accuracy')",
        "n3_model_search.fit(n3_model_X, n3_model_y)",
        "n3_model = n3_model_search.best_estimator_",
        "n3_metrics = {'best_params': n3_model_search.best_params_, "
        "'best_score': float(n3_model_search.best_score_)}",
        "print(n3_metrics)",
    ]


def test_random_forest_tuning_codegen_raises_on_malformed_grid_value():
    node = _load_node_module("sklearn_models/random_forest_tuning")

    with pytest.raises(ValueError):
        node.codegen(
            {"train_table": "n2_train"},
            {
                "target_column": "label",
                "n_estimators_options": "abc,20",
                "max_depth_options": "3,None",
                "cv": 2,
                "scoring": "accuracy",
                "random_state": 42,
            },
            {"model": "n3_model", "metrics": "n3_metrics"},
        )
