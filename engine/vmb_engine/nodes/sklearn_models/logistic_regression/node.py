IMPORTS = ["from sklearn.linear_model import LogisticRegression"]


def _coefficients_summary(model, columns):
    coef = model.coef_
    if coef.shape[0] == 1:
        return {
            "coefficients": dict(zip(columns, coef[0].tolist())),
            "intercept": float(model.intercept_[0]),
        }
    classes = list(model.classes_)[-coef.shape[0] :]
    return {
        "coefficients": {
            str(c): dict(zip(columns, row.tolist())) for c, row in zip(classes, coef)
        },
        "intercept": {str(c): v for c, v in zip(classes, model.intercept_.tolist())},
    }


def execute(inputs: dict, params: dict) -> dict:
    from sklearn.linear_model import LogisticRegression

    target = params["target_column"]
    df = inputs["train_table"]
    X = df.drop(columns=[target])
    y = df[target]

    model = LogisticRegression(
        max_iter=params["max_iter"], random_state=params["random_state"]
    )
    model.fit(X, y)

    summary = _coefficients_summary(model, X.columns)

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
        f"{out_var} = LogisticRegression("
        f"max_iter={params['max_iter']!r}, random_state={params['random_state']!r})",
        f"{out_var}.fit({out_var}_X, {out_var}_y)",
        f"{summary_var}_coef = {out_var}.coef_",
        f"if {summary_var}_coef.shape[0] == 1:",
        f"    {summary_var} = {{'coefficients': "
        f"dict(zip({out_var}_X.columns, {summary_var}_coef[0].tolist())), "
        f"'intercept': float({out_var}.intercept_[0])}}",
        f"else:",
        f"    {summary_var}_classes = list({out_var}.classes_)[-{summary_var}_coef.shape[0]:]",
        f"    {summary_var} = {{'coefficients': {{str(c): "
        f"dict(zip({out_var}_X.columns, row.tolist())) "
        f"for c, row in zip({summary_var}_classes, {summary_var}_coef)}}, "
        f"'intercept': {{str(c): v for c, v in "
        f"zip({summary_var}_classes, {out_var}.intercept_.tolist())}}}}",
        f"print({summary_var})",
    ]
