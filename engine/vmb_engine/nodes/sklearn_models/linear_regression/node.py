IMPORTS = ["from sklearn.linear_model import LinearRegression"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.linear_model import LinearRegression

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    model = LinearRegression()
    model.fit(X, y)

    summary = {
        "coefficients": dict(zip(X.columns, model.coef_.tolist())),
        "intercept": float(model.intercept_),
    }

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
        f"{out_var} = LinearRegression()",
        f"{out_var}.fit({out_var}_X, {out_var}_y)",
        f"{summary_var} = {{'coefficients': "
        f"dict(zip({out_var}_X.columns, {out_var}.coef_.tolist())), "
        f"'intercept': float({out_var}.intercept_)}}",
        f"print({summary_var})",
    ]
