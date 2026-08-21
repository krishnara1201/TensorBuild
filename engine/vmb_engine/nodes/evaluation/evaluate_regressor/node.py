IMPORTS = ["from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    target = params["target_column"]
    df = inputs["test_table"]
    model = inputs["model"]

    X = df[model["feature_columns"]]
    y = df[target]
    preds = model["estimator"].predict(X)

    mse = float(mean_squared_error(y, preds))
    return {
        "metrics": {
            "mse": mse,
            "rmse": mse**0.5,
            "mae": float(mean_absolute_error(y, preds)),
            "r2": float(r2_score(y, preds)),
        }
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    model_var = inputs["model"]
    test_var = inputs["test_table"]
    out_var = var_names["metrics"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {test_var}[{model_var}_X.columns]",
        f"{out_var}_y = {test_var}[{target!r}]",
        f"{out_var}_preds = {model_var}.predict({out_var}_X)",
        f"{out_var}_mse = float(mean_squared_error({out_var}_y, {out_var}_preds))",
        f"{out_var} = {{"
        f"'mse': {out_var}_mse, "
        f"'rmse': {out_var}_mse ** 0.5, "
        f"'mae': float(mean_absolute_error({out_var}_y, {out_var}_preds)), "
        f"'r2': float(r2_score({out_var}_y, {out_var}_preds))}}",
        f"print({out_var})",
    ]
