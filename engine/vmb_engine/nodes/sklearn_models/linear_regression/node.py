IMPORTS = ["from sklearn.linear_model import LinearRegression"]


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.linear_model import LinearRegression

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    model = LinearRegression()
    model.fit(X, y)

    return {"model": {"estimator": model, "feature_columns": list(X.columns)}}


def codegen(inputs: dict, params: dict, var_names: dict) -> list[str]:
    in_var = inputs["train_table"]
    out_var = var_names["model"]
    target = params["target_column"]
    return [
        f"{out_var}_X = {in_var}.drop(columns=[{target!r}])",
        f"{out_var}_y = {in_var}[{target!r}]",
        f"{out_var} = LinearRegression()",
        f"{out_var}.fit({out_var}_X, {out_var}_y)",
    ]
