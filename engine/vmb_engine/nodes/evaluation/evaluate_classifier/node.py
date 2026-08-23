IMPORTS = [
    "from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score"
]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

    target = params["target_column"]
    average = params.get("average", "weighted")
    df = inputs["test_table"]
    model = inputs["model"]

    X = df[model["feature_columns"]]
    y = df[target]
    preds = model["estimator"].predict(X)

    return {
        "metrics": {
            "accuracy": float(accuracy_score(y, preds)),
            "precision": float(precision_score(y, preds, average=average)),
            "recall": float(recall_score(y, preds, average=average)),
            "f1": float(f1_score(y, preds, average=average)),
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    model_var = inputs["model"]
    test_var = inputs["test_table"]
    out_var = var_names["metrics"]
    target = params["target_column"]
    average = params.get("average", "weighted")
    return [
        f"{out_var}_X = {test_var}[{model_var}_X.columns]",
        f"{out_var}_y = {test_var}[{target!r}]",
        f"{out_var}_preds = {model_var}.predict({out_var}_X)",
        f"{out_var} = {{"
        f"'accuracy': float(accuracy_score({out_var}_y, {out_var}_preds)), "
        f"'precision': float(precision_score({out_var}_y, {out_var}_preds, average={average!r})), "
        f"'recall': float(recall_score({out_var}_y, {out_var}_preds, average={average!r})), "
        f"'f1': float(f1_score({out_var}_y, {out_var}_preds, average={average!r}))}}",
        f"print({out_var})",
    ]
