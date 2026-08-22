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


def test_clean_data_execute_drops_specified_columns():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"a": [1, 2], "id": [10, 20]})

    out = clean_data.execute({"table": df}, {"drop_columns": "id"})

    assert list(out["table"].columns) == ["a"]


def test_clean_data_execute_strips_whitespace_from_string_columns():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"cat": [" x ", "y "]})

    out = clean_data.execute({"table": df}, {"strip_whitespace": True})

    assert list(out["table"]["cat"]) == ["x", "y"]


def test_clean_data_execute_fixes_numeric_dtypes():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"b": ["1", "2", "3"]})

    out = clean_data.execute({"table": df}, {"fix_dtypes": True})

    assert out["table"]["b"].tolist() == [1, 2, 3]
    assert pd.api.types.is_numeric_dtype(out["table"]["b"])


def test_clean_data_execute_fix_dtypes_leaves_non_numeric_column_untouched():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"b": ["1", "2", "x"]})

    out = clean_data.execute({"table": df}, {"fix_dtypes": True})

    assert out["table"]["b"].tolist() == ["1", "2", "x"]


def test_clean_data_execute_drops_rows_missing_selected_columns():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"a": [1.0, None, 3.0], "b": [1, 2, 3]})

    out = clean_data.execute(
        {"table": df},
        {"missing_value_strategy": "drop_rows", "missing_value_columns": "a"},
    )

    assert out["table"]["a"].tolist() == [1.0, 3.0]


def test_clean_data_execute_fill_mean_only_applies_to_numeric_columns():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"a": [1.0, None, 3.0], "cat": ["x", None, "y"]})

    out = clean_data.execute(
        {"table": df},
        {"missing_value_strategy": "fill_mean", "missing_value_columns": "a,cat"},
    )

    assert out["table"]["a"].tolist() == [1.0, 2.0, 3.0]
    assert out["table"]["cat"].isna().sum() == 1


def test_clean_data_execute_fill_median_fills_with_column_median():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"a": [1.0, None, 3.0, 100.0]})

    out = clean_data.execute(
        {"table": df},
        {"missing_value_strategy": "fill_median", "missing_value_columns": "a"},
    )

    assert out["table"]["a"].tolist() == [1.0, 3.0, 3.0, 100.0]


def test_clean_data_execute_fill_mode_fills_with_most_frequent_value():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"cat": ["x", "x", "y", None]})

    out = clean_data.execute(
        {"table": df},
        {"missing_value_strategy": "fill_mode", "missing_value_columns": "cat"},
    )

    assert out["table"]["cat"].tolist() == ["x", "x", "y", "x"]


def test_clean_data_execute_missing_value_columns_blank_means_all_columns():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"cat1": ["x", None], "cat2": [None, "y"]})

    out = clean_data.execute(
        {"table": df},
        {"missing_value_strategy": "fill_constant", "fill_constant_value": "unknown"},
    )

    assert out["table"]["cat1"].tolist() == ["x", "unknown"]
    assert out["table"]["cat2"].tolist() == ["unknown", "y"]


def test_clean_data_execute_drops_duplicate_rows():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"a": [1, 1, 2], "b": [1, 1, 2]})

    out = clean_data.execute({"table": df}, {"drop_duplicates": True})

    assert len(out["table"]) == 2


def test_clean_data_execute_no_ops_returns_unchanged_copy():
    clean_data = _load_node_module("preprocessing/clean_data")
    df = pd.DataFrame({"a": [1, 2]})

    out = clean_data.execute({"table": df}, {})

    assert out["table"].equals(df)
    assert out["table"] is not df


def test_clean_data_codegen_emits_operations_in_order():
    clean_data = _load_node_module("preprocessing/clean_data")

    lines = clean_data.codegen(
        {"table": "n1_table"},
        {
            "drop_columns": "id",
            "missing_value_strategy": "fill_constant",
            "missing_value_columns": "cat",
            "fill_constant_value": "unknown",
            "drop_duplicates": True,
        },
        {"table": "n2_table"},
    )

    assert lines == [
        "n2_table = n1_table.copy()",
        "n2_table = n2_table.drop(columns=['id'])",
        "n2_table_cols = ['cat']",
        "for _col in n2_table_cols:",
        "    n2_table[_col] = n2_table[_col].fillna('unknown')",
        "n2_table = n2_table.drop_duplicates()",
    ]
