IMPORTS = ["from sklearn.metrics import confusion_matrix"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.metrics import confusion_matrix

    target = params["target_column"]
    df = inputs["test_table"]
    model = inputs["model"]

    X = df[model["feature_columns"]]
    y = df[target]
    preds = model["estimator"].predict(X)

    labels = sorted(set(y.tolist()) | set(preds.tolist()))
    matrix = confusion_matrix(y, preds, labels=labels)

    return {"metrics": {"confusion_matrix": matrix.tolist(), "labels": labels}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    model_var = inputs["model"]
    test_var = inputs["test_table"]
    out_var = var_names["metrics"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {test_var}[{model_var}_X.columns]",
        f"{out_var}_y = {test_var}[{target!r}]",
        f"{out_var}_preds = {model_var}.predict({out_var}_X)",
        f"{out_var}_labels = sorted(set({out_var}_y.tolist()) | set({out_var}_preds.tolist()))",
        f"{out_var} = {{'confusion_matrix': confusion_matrix({out_var}_y, {out_var}_preds, "
        f"labels={out_var}_labels).tolist(), 'labels': {out_var}_labels}}",
        f"print({out_var})",
    ]
