IMPORTS = ["from sklearn.metrics import accuracy_score"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.metrics import accuracy_score

    target = params["target_column"]
    df = inputs["test_table"]
    model = inputs["model"]

    X = df[model["feature_columns"]]
    y = df[target]
    preds = model["estimator"].predict(X)

    return {"metrics": {"accuracy": float(accuracy_score(y, preds))}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    model_var = inputs["model"]
    test_var = inputs["test_table"]
    out_var = var_names["metrics"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {test_var}.drop(columns=[{target!r}])",
        f"{out_var}_y = {test_var}[{target!r}]",
        f"{out_var}_preds = {model_var}.predict({out_var}_X)",
        f"{out_var} = {{'accuracy': float(accuracy_score({out_var}_y, {out_var}_preds))}}",
        f"print({out_var})",
    ]
