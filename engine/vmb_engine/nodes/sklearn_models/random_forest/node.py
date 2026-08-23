IMPORTS = ["from sklearn.ensemble import RandomForestClassifier"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.ensemble import RandomForestClassifier

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    model = RandomForestClassifier(
        n_estimators=params["n_estimators"], random_state=params["random_state"]
    )
    model.fit(X, y)

    summary = {"feature_importances": dict(zip(X.columns, model.feature_importances_.tolist()))}

    return {
        "model": {"estimator": model, "feature_columns": list(X.columns)},
        "model_summary": summary,
    }


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    out_var = var_names["model"]
    summary_var = var_names["model_summary"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {in_var}.drop(columns=[{target!r}])",
        f"{out_var}_y = {in_var}[{target!r}]",
        f"{out_var} = RandomForestClassifier("
        f"n_estimators={params['n_estimators']!r}, random_state={params['random_state']!r})",
        f"{out_var}.fit({out_var}_X, {out_var}_y)",
        f"{summary_var} = {{'feature_importances': "
        f"dict(zip({out_var}_X.columns, {out_var}.feature_importances_.tolist()))}}",
        f"print({summary_var})",
    ]
