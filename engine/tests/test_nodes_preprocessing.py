import importlib.util
from pathlib import Path

import pandas as pd

NODES_DIR = Path(__file__).resolve().parents[1] / "vmb_engine" / "nodes"


def _load_node_module(rel_path: str):
    node_path = NODES_DIR / rel_path / "node.py"
    spec = importlib.util.spec_from_file_location(rel_path.replace("/", "_"), node_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _train_test_frames():
    train_df = pd.DataFrame(
        {
            "x1": [1.0, 2.0, 3.0, 4.0],
            "cat": ["a", "b", "a", "b"],
            "label": [0, 1, 0, 1],
        }
    )
    test_df = pd.DataFrame(
        {
            "x1": [5.0, 6.0],
            "cat": ["a", "c"],
            "label": [1, 0],
        }
    )
    return train_df, test_df


def test_standardize_execute_scales_numeric_columns_excluding_target():
    standardize = _load_node_module("preprocessing/standardize")
    train_df, test_df = _train_test_frames()

    outputs = standardize.execute(
        {"train_table": train_df, "test_table": test_df},
        {"target_column": "label"},
    )

    train_out = outputs["train"]
    test_out = outputs["test"]

    assert train_out["x1"].mean() == 0.0
    assert train_out["x1"].std(ddof=0) == 1.0
    # target column and non-numeric column pass through untouched
    assert list(train_out["label"]) == [0, 1, 0, 1]
    assert list(train_out["cat"]) == ["a", "b", "a", "b"]
    # test is transformed using train's fitted stats, not refit on its own
    assert list(test_out["cat"]) == ["a", "c"]


def test_standardize_codegen_emits_scaler_fit_transform():
    standardize = _load_node_module("preprocessing/standardize")
    lines = standardize.codegen(
        {"train_table": "n2_train", "test_table": "n2_test"},
        {"target_column": "label"},
        {"train": "n3_train", "test": "n3_test"},
    )
    assert lines == [
        "n3_train_scaler = StandardScaler()",
        "n3_train_numeric_cols = [c for c in n2_train.select_dtypes(include='number').columns if c != 'label']",
        "n3_train = n2_train.copy()",
        "n3_test = n2_test.copy()",
        "n3_train[n3_train_numeric_cols] = n3_train_scaler.fit_transform(n2_train[n3_train_numeric_cols])",
        "n3_test[n3_train_numeric_cols] = n3_train_scaler.transform(n2_test[n3_train_numeric_cols])",
    ]


def test_one_hot_encode_execute_encodes_categoricals_excluding_target():
    ohe = _load_node_module("preprocessing/one_hot_encode")
    train_df, test_df = _train_test_frames()

    outputs = ohe.execute(
        {"train_table": train_df, "test_table": test_df},
        {"target_column": "label"},
    )

    train_out = outputs["train"]
    test_out = outputs["test"]

    assert "cat" not in train_out.columns
    assert set(train_out.columns) == {"x1", "label", "cat_a", "cat_b"}
    assert list(train_out["cat_a"]) == [1.0, 0.0, 1.0, 0.0]
    assert list(train_out["cat_b"]) == [0.0, 1.0, 0.0, 1.0]
    # unseen test category ("c") is handled via handle_unknown, all-zero row
    assert list(test_out["cat_a"]) == [1.0, 0.0]
    assert list(test_out["cat_b"]) == [0.0, 0.0]


def test_one_hot_encode_codegen_emits_encoder_fit_transform():
    ohe = _load_node_module("preprocessing/one_hot_encode")
    lines = ohe.codegen(
        {"train_table": "n2_train", "test_table": "n2_test"},
        {"target_column": "label"},
        {"train": "n3_train", "test": "n3_test"},
    )
    assert lines == [
        "n3_train_cat_cols = [c for c in n2_train.select_dtypes("
        "include=['object', 'string']).columns if c != 'label']",
        "n3_train_encoder = OneHotEncoder(handle_unknown='ignore', sparse_output=False)",
        "n3_train_encoder.fit(n2_train[n3_train_cat_cols])",
        "n3_train_encoded = pd.DataFrame(",
        "    n3_train_encoder.transform(n2_train[n3_train_cat_cols]),",
        "    columns=n3_train_encoder.get_feature_names_out(n3_train_cat_cols),",
        "    index=n2_train.index,",
        ")",
        "n3_train = pd.concat([n2_train.drop(columns=n3_train_cat_cols), n3_train_encoded], axis=1)",
        "n3_test_encoded = pd.DataFrame(",
        "    n3_train_encoder.transform(n2_test[n3_train_cat_cols]),",
        "    columns=n3_train_encoder.get_feature_names_out(n3_train_cat_cols),",
        "    index=n2_test.index,",
        ")",
        "n3_test = pd.concat([n2_test.drop(columns=n3_train_cat_cols), n3_test_encoded], axis=1)",
    ]
